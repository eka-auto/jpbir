"""Training Pipeline component for fine-tuning a Qwen 2.5-3B model.

This module implements the TrainingPipeline interface, responsible for
dependency management, training environment detection, preparing training
data (80/20 train/validation split with a deterministic seed), building
Hugging Face ``datasets`` objects, and (in later tasks) executing the
actual fine-tuning loop.

Requirements addressed:
- 3.1: Automatic dependency installation via pip with version constraints
       (datasets, transformers, accelerate, trl, langchain-text-splitters).
- 3.2: Prepare an 80/20 training/validation split using a deterministic
       random seed (42) to ensure reproducibility.
- 3.3: Fine-tune Qwen 2.5-3B with the configured hyperparameters (handled
       by the training loop in a later task).
- 10.2: Training environment detection (Colab vs local).

Design Property 5 (Deterministic Training Split): for any dataset of text
chunks, applying the 80/20 split with seed 42 SHALL produce identical
splits across multiple invocations. The training set SHALL contain exactly
80% of the data (rounded) and the validation set SHALL contain the
remainder.
"""

import importlib.util
import logging
import os
import random
import subprocess
import sys
from typing import Any, Callable, Dict, List, Optional, Tuple

from personal_folder_agent.interfaces import TrainingPipeline as TrainingPipelineBase
from personal_folder_agent.models import (
    DataStatistics,
    PerformanceMetrics,
    TextChunk,
    TrainingMetadata,
)

logger = logging.getLogger(__name__)

# Deterministic seed used for the train/validation split (Requirement 3.2).
DEFAULT_SPLIT_SEED = 42

# Fraction of data reserved for training (Requirement 3.2: 80/20 split).
TRAIN_FRACTION = 0.8

# Required training dependencies with version constraints (Requirement 3.1).
# Keys are importable module names; values are pip specifiers.
REQUIRED_DEPENDENCIES: Dict[str, str] = {
    "datasets": "datasets>=2.18.0",
    "transformers": "transformers>=4.45.0",
    "accelerate": "accelerate>=0.30.0",
    "trl": "trl>=0.10.0",
    "langchain_text_splitters": "langchain-text-splitters>=0.2.0",
}

# Default training hyperparameters (Requirement 3.3).
DEFAULT_HYPERPARAMETERS: Dict[str, Any] = {
    "model": "Qwen2.5-3B-Instruct",
    "epochs": 3,
    "batch_size": 2,
    "learning_rate": 2e-5,
    "gradient_accumulation_steps": 4,
    "bf16": True,
    "max_length": 1024,
    "checkpoint_dir": "./checkpoints",
}


class TrainingPipeline(TrainingPipelineBase):
    """Concrete implementation of the model training pipeline.

    Manages training dependencies (automatic pip installation with version
    constraints), detects the training environment (Colab vs local),
    prepares an 80/20 train/validation split of the collected text chunks
    using a deterministic seed (42), builds Hugging Face ``datasets``
    objects with a ``text`` field, and exposes batched tokenization helpers.

    The actual fine-tuning loop is implemented in a later task; ``train``
    currently performs data preparation and returns a ``TrainingMetadata``
    populated with ``DataStatistics``.

    Attributes:
        config: The training configuration dictionary (hyperparameters,
            model name, etc.).
        seed: Random seed used for the deterministic split (default 42).
        train_fraction: Fraction of chunks assigned to the training set
            (default 0.8).
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        seed: int = DEFAULT_SPLIT_SEED,
        train_fraction: float = TRAIN_FRACTION,
        installer: Optional[Callable[[List[str]], None]] = None,
    ) -> None:
        """Initialize the training pipeline.

        Args:
            config: Optional training configuration dictionary (hyperparameters,
                model name, etc.). Missing keys fall back to
                ``DEFAULT_HYPERPARAMETERS``.
            seed: Random seed for the deterministic split. Defaults to 42.
            train_fraction: Fraction of data assigned to training. Defaults
                to 0.8 (80/20 split).
            installer: Optional callable that installs a list of pip
                specifiers (e.g. ``["datasets>=2.18.0"]``). Defaults to a
                subprocess-based ``pip install``. Injectable for testing.

        Raises:
            ValueError: If ``train_fraction`` is not in the open interval
                (0, 1).
        """
        if not 0.0 < train_fraction < 1.0:
            raise ValueError(
                f"train_fraction must be between 0 and 1 (exclusive), got {train_fraction}"
            )

        self.config = dict(DEFAULT_HYPERPARAMETERS)
        if config:
            self.config.update(config)
        self.seed = seed
        self.train_fraction = train_fraction
        self._installer = installer

    @property
    def hyperparameters(self) -> Dict[str, Any]:
        """Return the effective training hyperparameters (with defaults applied)."""
        return dict(self.config)

    # ------------------------------------------------------------------
    # Dependency management (Requirement 3.1)
    # ------------------------------------------------------------------

    @staticmethod
    def _is_installed(module_name: str) -> bool:
        """Check whether a Python module is importable without importing it.

        Args:
            module_name: The importable module name (e.g. 'datasets').

        Returns:
            True if the module can be found on sys.path, False otherwise.
        """
        return importlib.util.find_spec(module_name) is not None

    def missing_dependencies(self) -> List[str]:
        """Return the pip specifiers of required dependencies that are missing.

        Returns:
            List of pip specifiers (e.g. ``['datasets>=2.18.0']``) for
            required packages that are not currently importable.
        """
        return [
            specifier
            for module_name, specifier in REQUIRED_DEPENDENCIES.items()
            if not self._is_installed(module_name)
        ]

    @staticmethod
    def _default_installer(specifiers: List[str]) -> None:
        """Install packages via ``pip install`` in a subprocess.

        Args:
            specifiers: List of pip specifiers to install.

        Raises:
            RuntimeError: If the pip subprocess exits with a non-zero code.
        """
        if not specifiers:
            return
        command = [sys.executable, "-m", "pip", "install", *specifiers]
        logger.info("Installing training dependencies: %s", " ".join(specifiers))
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                f"Failed to install dependencies: {result.stderr.strip()}"
            )

    def ensure_dependencies(self, install: bool = True) -> List[str]:
        """Check for missing training dependencies and optionally install them.

        Args:
            install: If True (default), missing packages are installed via
                the configured installer. If False, only the list of missing
                specifiers is returned.

        Returns:
            List of pip specifiers that were missing (and installed, when
            ``install=True``).
        """
        missing = self.missing_dependencies()
        if missing and install:
            installer = self._installer or self._default_installer
            installer(missing)
        return missing

    # ------------------------------------------------------------------
    # Environment detection (Requirement 10.2)
    # ------------------------------------------------------------------

    @staticmethod
    def is_colab() -> bool:
        """Return True if running inside Google Colab.

        Detects Colab via the ``COLAB_GPU`` or ``IN_COLAB`` environment
        variables (Requirement 10.2).

        Returns:
            True if the Colab environment is detected, False otherwise.
        """
        return bool(os.environ.get("COLAB_GPU") or os.environ.get("IN_COLAB"))

    @staticmethod
    def _gpu_available() -> bool:
        """Return True if a CUDA GPU is available via torch.

        The torch import is guarded so this works even when torch is not
        installed.

        Returns:
            True if torch reports CUDA availability, False otherwise.
        """
        try:
            import torch

            return bool(torch.cuda.is_available())
        except ImportError:
            return False

    def detect_environment(self) -> Dict[str, Any]:
        """Detect the current training environment (Colab vs local).

        Returns:
            A dict with keys: ``environment`` ('colab' or 'local'),
            ``gpu_available`` (bool), ``memory_optimization`` (bool, True in
            Colab), and ``checkpoint_interval`` (seconds; 1800 in Colab,
            None locally).
        """
        colab = self.is_colab()
        return {
            "environment": "colab" if colab else "local",
            "gpu_available": self._gpu_available(),
            "memory_optimization": colab,
            "checkpoint_interval": 1800 if colab else None,
        }

    # ------------------------------------------------------------------
    # Model loading and training configuration (Requirement 3.3)
    # ------------------------------------------------------------------

    def load_model(self) -> Tuple[Any, Any]:
        """Load the Qwen 2.5-3B-Instruct model and tokenizer from Hugging Face.

        Lazily imports ``transformers`` and downloads the configured model
        (``self.config['model']``) only when this method is called — never at
        import or construction time. The model is placed on CUDA when a GPU
        is available, otherwise on CPU.

        Returns:
            A tuple ``(model, tokenizer)`` where ``model`` is an
            ``AutoModelForCausalLM`` instance and ``tokenizer`` is an
            ``AutoTokenizer`` instance.

        Raises:
            ImportError: If the ``transformers`` package is not installed.
        """
        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer
        except ImportError as exc:
            raise ImportError(
                "The 'transformers' package is required to load the Qwen "
                "2.5-3B-Instruct model. Install it with: pip install transformers"
            ) from exc

        model_name = self.config.get("model", "Qwen2.5-3B-Instruct")
        device = "cuda" if self._gpu_available() else "cpu"

        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForCausalLM.from_pretrained(model_name)
        model.to(device)

        logger.info("Loaded model %s on device %s", model_name, device)
        return model, tokenizer

    def build_training_arguments(self) -> Dict[str, Any]:
        """Build the fine-tuning configuration for the Qwen 2.5-3B model.

        Returns a ``TrainingArguments``-compatible configuration dictionary
        with the keys required for fine-tuning. Precision follows Requirement
        3.3: ``bf16=True`` when a GPU is available, otherwise ``fp32``
        (``bf16=False`` and ``fp16=False``) on CPU.

        Returns:
            A dict with ``num_train_epochs``, ``per_device_train_batch_size``,
            ``learning_rate``, ``gradient_accumulation_steps``, ``bf16``,
            ``fp16``, ``max_length``, and ``output_dir``.
        """
        gpu = self._gpu_available()

        return {
            "num_train_epochs": self.config.get("epochs", 3),
            "per_device_train_batch_size": self.config.get("batch_size", 2),
            "learning_rate": self.config.get("learning_rate", 2e-5),
            "gradient_accumulation_steps": self.config.get(
                "gradient_accumulation_steps", 4
            ),
            "bf16": bool(self.config.get("bf16", True)) and gpu,
            "fp16": False,
            "max_length": self.config.get("max_length", 1024),
            "output_dir": self.config.get("checkpoint_dir", "./checkpoints"),
        }

    def split_data(
        self, text_chunks: List[TextChunk]
    ) -> Tuple[List[TextChunk], List[TextChunk]]:
        """Deterministically split chunks into train and validation sets.

        Uses ``random.Random(seed).shuffle`` on a copy of the input so the
        split is reproducible across invocations (Design Property 5). The
        training set contains exactly ``round(len * train_fraction)`` chunks
        and the validation set contains the remainder.

        Args:
            text_chunks: List of TextChunk objects to split.

        Returns:
            A tuple ``(train_chunks, validation_chunks)``.
        """
        chunks = list(text_chunks)
        rng = random.Random(self.seed)
        rng.shuffle(chunks)

        train_size = round(len(chunks) * self.train_fraction)
        train_chunks = chunks[:train_size]
        validation_chunks = chunks[train_size:]

        return train_chunks, validation_chunks

    def prepare_data(
        self, text_chunks: List[TextChunk]
    ) -> Tuple[Any, Any]:
        """Prepare Hugging Face ``datasets`` objects from text chunks.

        Splits the chunks into 80/20 train/validation sets (seed 42) and
        builds ``datasets.Dataset`` objects with a ``text`` field and an
        optional ``source_file`` field.

        Args:
            text_chunks: List of TextChunk objects to prepare.

        Returns:
            A tuple ``(train_dataset, validation_dataset)`` of Hugging Face
            ``Dataset`` objects.

        Raises:
            ImportError: If the ``datasets`` package is not installed.
        """
        try:
            from datasets import Dataset
        except ImportError as exc:
            raise ImportError(
                "The 'datasets' package is required to build Hugging Face "
                "dataset objects. Install it with: pip install datasets"
            ) from exc

        train_chunks, validation_chunks = self.split_data(text_chunks)

        train_dataset = self._build_dataset(train_chunks)
        validation_dataset = self._build_dataset(validation_chunks)

        return train_dataset, validation_dataset

    @staticmethod
    def _build_dataset(chunks: List[TextChunk]) -> Any:
        """Build a Hugging Face ``Dataset`` from a list of chunks.

        Each row contains a ``text`` field (the chunk text) and a
        ``source_file`` field (the originating file path).

        Args:
            chunks: List of TextChunk objects.

        Returns:
            A ``datasets.Dataset`` with ``text`` and ``source_file`` columns.
        """
        from datasets import Dataset

        records = [
            {"text": chunk.text, "source_file": chunk.source_file}
            for chunk in chunks
        ]
        return Dataset.from_list(records)

    def tokenize_function(self, tokenizer: Any, max_length: int = 1024):
        """Return a batched tokenization function for ``Dataset.map``.

        The returned callable is intended to be passed to
        ``Dataset.map(..., batched=True)`` for efficient batched data
        loading (Requirement 3.2). It tokenizes the ``text`` column and
        returns ``input_ids`` and ``attention_mask``.

        Args:
            tokenizer: A Hugging Face tokenizer with a ``__call__`` method
                accepting a list of strings.
            max_length: Maximum sequence length for truncation/padding.

        Returns:
            A callable ``fn(examples)`` suitable for ``Dataset.map`` with
            ``batched=True``.
        """

        def _tokenize(examples: Dict[str, Any]) -> Dict[str, Any]:
            return tokenizer(
                examples["text"],
                truncation=True,
                padding="max_length",
                max_length=max_length,
            )

        return _tokenize

    def _compute_statistics(self, text_chunks: List[TextChunk]) -> DataStatistics:
        """Compute DataStatistics from a list of text chunks.

        Args:
            text_chunks: List of TextChunk objects.

        Returns:
            A populated DataStatistics instance.
        """
        stats = DataStatistics()

        files_by_format: Dict[str, int] = {}
        total_tokens = 0
        source_files = set()

        for chunk in text_chunks:
            source_files.add(chunk.source_file)
            total_tokens += chunk.token_count

            # Derive a format key from the source file extension.
            ext = ""
            if chunk.source_file:
                dot = chunk.source_file.rfind(".")
                if dot != -1:
                    ext = chunk.source_file[dot:].lower()
            key = ext or "unknown"
            files_by_format[key] = files_by_format.get(key, 0) + 1

        stats.total_files = len(source_files)
        stats.total_chunks = len(text_chunks)
        stats.total_tokens = total_tokens
        stats.files_by_format = files_by_format
        if text_chunks:
            stats.avg_chunk_size = total_tokens / len(text_chunks)

        return stats

    def train(self, text_chunks: List[TextChunk]) -> TrainingMetadata:
        """Execute the training pipeline on prepared text chunks.

        Currently performs data preparation (80/20 split and dataset
        construction) and returns a ``TrainingMetadata`` populated with
        ``DataStatistics``. The actual fine-tuning loop is implemented in a
        later task.

        Args:
            text_chunks: List of TextChunk objects to train on.

        Returns:
            TrainingMetadata with data statistics populated.

        Raises:
            RuntimeError: If training fails and cannot be recovered.
        """
        from datetime import datetime

        train_dataset, validation_dataset = self.prepare_data(text_chunks)
        data_statistics = self._compute_statistics(text_chunks)

        metadata = TrainingMetadata(
            training_id=f"training_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            start_time=datetime.now(),
            hyperparameters=dict(self.config),
            data_statistics=data_statistics,
            performance_metrics=PerformanceMetrics(),
            checkpoint_paths=[],
        )

        logger.info(
            "Prepared data: %d train / %d validation chunks",
            len(train_dataset),
            len(validation_dataset),
        )

        return metadata

    def resume_from_checkpoint(self, checkpoint_path: str) -> TrainingMetadata:
        """Resume training from a previously saved checkpoint.

        Not yet implemented; the checkpoint/resume logic is handled in a
        later task (Requirement 9.2).

        Args:
            checkpoint_path: Path to the checkpoint directory or file.

        Returns:
            TrainingMetadata with updated session information.

        Raises:
            NotImplementedError: Always, until the training loop is
                implemented.
        """
        raise NotImplementedError(
            "resume_from_checkpoint is not yet implemented (task 9.4)."
        )
