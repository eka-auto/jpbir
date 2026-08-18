"""Configuration Manager for the Personal Folder Trained Agent system.

Implements YAML-based configuration loading, validation, and persistence.
Handles folder paths, file filters, exclusion patterns, and training hyperparameters.
"""

import fnmatch
import logging
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from personal_folder_agent.interfaces import ConfigurationManager
from personal_folder_agent.models import ChunkingStrategy

logger = logging.getLogger(__name__)

# Maximum total character length for all folder paths combined
MAX_TOTAL_PATH_LENGTH = 1000

# Maximum number of distinct folder paths allowed
MAX_FOLDER_COUNT = 100

# Valid base model architectures for fine-tuning (Requirement 7.3).
# Bare names are the canonical architecture identifiers referenced in the
# requirements; "-Instruct" variants are the actual Hugging Face model IDs
# used by the Training Pipeline (see design.md), so both forms are accepted.
VALID_MODEL_ARCHITECTURES: List[str] = [
    "Qwen2.5-3B",
    "Qwen2.5-3B-Instruct",
    "Qwen2.5-7B",
    "Qwen2.5-7B-Instruct",
    "Qwen2.5-14B",
    "Qwen2.5-14B-Instruct",
]

# Default configuration values
DEFAULT_CONFIG: Dict[str, Any] = {
    "folders": {
        "paths": [],
        "max_depth": 10,
        "exclude_patterns": [],
    },
    "processing": {
        "file_filters": ["*.txt", "*.md", "*.pdf", "*.docx", "*.xlsx", "*.pptx", "*.csv", "*.json", "*.xml"],
        "chunking": {
            "strategy": "sentence_aware",
            "max_tokens": 1024,
            "min_tokens": 512,
        },
    },
    "training": {
        "model": "Qwen2.5-3B-Instruct",
        "epochs": 3,
        "batch_size": 2,
        "learning_rate": 2e-5,
        "gradient_accumulation_steps": 4,
        "max_length": 1024,
        "bf16": True,
        "checkpoint_dir": "./checkpoints",
    },
    "storage": {
        "local_output": "./output",
        "google_drive": {
            "enabled": False,
            "folder_id": None,
            "encryption_passphrase": None,
        },
    },
    "security": {
        "local_only": False,
        "verify_permissions": True,
        "temp_dir_encryption": True,
    },
    "system": {
        "mode": "local_only",
        "max_folders": MAX_FOLDER_COUNT,
        "max_path_length": MAX_TOTAL_PATH_LENGTH,
    },
}


class ConfigValidationError(Exception):
    """Raised when configuration validation fails.

    Attributes:
        errors: List of validation error messages.
    """

    def __init__(self, errors: List[str]):
        self.errors = errors
        message = "Configuration validation failed:\n" + "\n".join(f"  - {e}" for e in errors)
        super().__init__(message)


class YAMLConfigurationManager(ConfigurationManager):
    """YAML-based configuration manager implementing the ConfigurationManager interface.

    Loads, validates, and saves system configuration from/to YAML files.
    Enforces constraints on folder paths, file filters, and training hyperparameters.

    Args:
        config_path: Path to the YAML configuration file.
    """

    def __init__(self, config_path: str):
        self._config_path = Path(config_path)
        self._config: Optional[Dict[str, Any]] = None

    @property
    def config_path(self) -> Path:
        """Return the path to the configuration file."""
        return self._config_path

    def load_configuration(self) -> Dict[str, Any]:
        """Load and validate the system configuration from a YAML file.

        Parses the configuration file, validates all parameters against
        their expected ranges and types, and applies defaults for missing values.

        Returns:
            Dictionary containing the validated system configuration.

        Raises:
            FileNotFoundError: If the configuration file does not exist.
            ConfigValidationError: If configuration contains invalid parameters.
        """
        if not self._config_path.exists():
            raise FileNotFoundError(
                f"Configuration file not found: {self._config_path}. "
                f"Create one based on the example configuration or use "
                f"save_configuration() with a default config dictionary."
            )

        with open(self._config_path, "r", encoding="utf-8") as f:
            raw_config = yaml.safe_load(f)

        if raw_config is None:
            raw_config = {}

        # Merge with defaults so missing keys get sensible values
        config = self._merge_with_defaults(raw_config)

        # Validate the merged configuration
        errors = self._validate_config(config)
        if errors:
            raise ConfigValidationError(errors)

        self._config = config
        return config

    def save_configuration(self, config: Dict[str, Any]) -> bool:
        """Save the current configuration to the YAML file.

        Validates the configuration before saving.

        Args:
            config: Configuration dictionary to save.

        Returns:
            True if the configuration was saved successfully, False otherwise.

        Raises:
            ConfigValidationError: If the configuration is invalid.
        """
        errors = self._validate_config(config)
        if errors:
            raise ConfigValidationError(errors)

        # Ensure parent directory exists
        self._config_path.parent.mkdir(parents=True, exist_ok=True)

        with open(self._config_path, "w", encoding="utf-8") as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

        self._config = config
        return True

    def get_default_config(self) -> Dict[str, Any]:
        """Return a copy of the default configuration with sensible defaults.

        Returns:
            Dictionary with default configuration values.
        """
        import copy

        return copy.deepcopy(DEFAULT_CONFIG)

    def _merge_with_defaults(self, user_config: Dict[str, Any]) -> Dict[str, Any]:
        """Deep-merge user config over the default config.

        User-provided values override defaults. Missing keys are filled
        with default values.

        Args:
            user_config: User-provided configuration dictionary.

        Returns:
            Merged configuration dictionary.
        """
        import copy

        merged = copy.deepcopy(DEFAULT_CONFIG)
        self._deep_merge(merged, user_config)
        return merged

    def _deep_merge(self, base: Dict[str, Any], override: Dict[str, Any]) -> None:
        """Recursively merge override into base, mutating base in place."""
        for key, value in override.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._deep_merge(base[key], value)
            else:
                base[key] = value

    def _validate_config(self, config: Dict[str, Any]) -> List[str]:
        """Validate the entire configuration and return a list of error messages.

        Args:
            config: Configuration dictionary to validate.

        Returns:
            List of validation error strings. Empty if config is valid.
        """
        errors: List[str] = []

        # Validate folders section
        errors.extend(self._validate_folders(config.get("folders", {})))

        # Validate processing section
        errors.extend(self._validate_processing(config.get("processing", {})))

        # Validate training section
        errors.extend(self._validate_training(config.get("training", {})))

        return errors

    def _validate_folders(self, folders_config: Dict[str, Any]) -> List[str]:
        """Validate the folders configuration section.

        Checks:
        - Folder paths exist and are accessible
        - Total path length <= 1000 chars
        - Max 100 distinct folders
        - Max depth is within range

        Args:
            folders_config: The 'folders' section of the config.

        Returns:
            List of validation error messages.
        """
        errors: List[str] = []
        paths = folders_config.get("paths", [])

        if not isinstance(paths, list):
            errors.append("folders.paths: Must be a list of directory paths.")
            return errors

        # Check max folder count (system safety limit, see MAX_FOLDER_COUNT)
        if len(paths) > MAX_FOLDER_COUNT:
            errors.append(
                f"folders.paths: Exceeds maximum of {MAX_FOLDER_COUNT} distinct folders "
                f"(found {len(paths)}). Reduce the number of folder paths."
            )

        # Check total path length (system safety limit, see MAX_TOTAL_PATH_LENGTH)
        total_length = sum(len(str(p)) for p in paths)
        if total_length > MAX_TOTAL_PATH_LENGTH:
            errors.append(
                f"folders.paths: Total path length ({total_length} chars) exceeds "
                f"maximum of {MAX_TOTAL_PATH_LENGTH} chars. Use shorter paths or fewer folders."
            )

        # Validate each folder path exists and is accessible (Requirement 7.4)
        for path in paths:
            path_str = str(path)
            if not path_str:
                errors.append("folders.paths: Empty path is not allowed.")
                continue

            resolved = Path(path_str).resolve()
            if not resolved.exists():
                errors.append(
                    f"folders.paths: Path does not exist: '{path_str}'. "
                    f"Provide an existing directory path."
                )
            elif not resolved.is_dir():
                errors.append(
                    f"folders.paths: Path is not a directory: '{path_str}'. "
                    f"Provide a directory path, not a file."
                )

        # Validate max_depth
        max_depth = folders_config.get("max_depth", 10)
        if not isinstance(max_depth, int) or max_depth < 1 or max_depth > 50:
            errors.append(
                f"folders.max_depth: Must be an integer between 1 and 50 "
                f"(got {max_depth!r})."
            )

        # Validate exclusion patterns
        exclude_patterns = folders_config.get("exclude_patterns", [])
        if not isinstance(exclude_patterns, list):
            errors.append("folders.exclude_patterns: Must be a list of glob patterns.")
        else:
            for pattern in exclude_patterns:
                if not isinstance(pattern, str) or not pattern:
                    errors.append(
                        f"folders.exclude_patterns: Each pattern must be a non-empty string "
                        f"(got {pattern!r})."
                    )

        return errors

    def _validate_processing(self, processing_config: Dict[str, Any]) -> List[str]:
        """Validate the processing configuration section.

        Checks:
        - File filters are valid glob patterns
        - Chunking strategy is recognized
        - Token limits are within range

        Args:
            processing_config: The 'processing' section of the config.

        Returns:
            List of validation error messages.
        """
        errors: List[str] = []

        # Validate file_filters (Requirement 7.1)
        file_filters = processing_config.get("file_filters", [])
        if not isinstance(file_filters, list):
            errors.append("processing.file_filters: Must be a list of glob patterns.")
        else:
            for pattern in file_filters:
                if not isinstance(pattern, str) or not pattern:
                    errors.append(
                        f"processing.file_filters: Each filter must be a non-empty string "
                        f"(got {pattern!r})."
                    )
                    continue
                # Validate as a glob pattern by attempting to use it
                if not self._is_valid_glob(pattern):
                    errors.append(
                        f"processing.file_filters: Invalid glob pattern: '{pattern}'. "
                        f"Use patterns like '*.txt', '*.pdf', or '**/*.md'."
                    )

        # Validate chunking configuration
        chunking = processing_config.get("chunking", {})
        if isinstance(chunking, dict):
            strategy = chunking.get("strategy", "sentence_aware")
            valid_strategies = [s.value for s in ChunkingStrategy]
            if strategy not in valid_strategies:
                errors.append(
                    f"processing.chunking.strategy: Must be one of {valid_strategies} "
                    f"(got '{strategy}')."
                )

            max_tokens = chunking.get("max_tokens", 1024)
            if not isinstance(max_tokens, int) or max_tokens < 128 or max_tokens > 4096:
                errors.append(
                    f"processing.chunking.max_tokens: Must be an integer between 128 and 4096 "
                    f"(got {max_tokens!r})."
                )

            min_tokens = chunking.get("min_tokens", 512)
            if not isinstance(min_tokens, int) or min_tokens < 1 or min_tokens > 2048:
                errors.append(
                    f"processing.chunking.min_tokens: Must be an integer between 1 and 2048 "
                    f"(got {min_tokens!r})."
                )

            if (
                isinstance(max_tokens, int)
                and isinstance(min_tokens, int)
                and min_tokens >= max_tokens
            ):
                errors.append(
                    f"processing.chunking: min_tokens ({min_tokens}) must be less than "
                    f"max_tokens ({max_tokens})."
                )

        return errors

    def _validate_training(self, training_config: Dict[str, Any]) -> List[str]:
        """Validate the training configuration section.

        Checks the model architecture selection per Requirement 7.3 and
        hyperparameter ranges per Requirement 7.2.

        Args:
            training_config: The 'training' section of the config.

        Returns:
            List of validation error messages.
        """
        errors: List[str] = []

        # Validate model architecture (Requirement 7.3)
        model = training_config.get("model", "Qwen2.5-3B-Instruct")
        if not isinstance(model, str) or model not in VALID_MODEL_ARCHITECTURES:
            errors.append(
                f"training.model: Must be one of {VALID_MODEL_ARCHITECTURES} "
                f"(got {model!r})."
            )

        # Validate learning_rate (Requirement 7.2: 1e-6 to 1e-3)
        lr = training_config.get("learning_rate", 2e-5)
        if (
            not isinstance(lr, (int, float))
            or isinstance(lr, bool)
            or math.isnan(lr)
            or lr < 1e-6
            or lr > 1e-3
        ):
            errors.append(
                f"training.learning_rate: Must be a float between 1e-6 and 1e-3 "
                f"(got {lr!r}). Typical values: 1e-5, 2e-5, 5e-5."
            )

        # Validate batch_size (Requirement 7.2: 1 to 16)
        batch_size = training_config.get("batch_size", 2)
        if not self._is_valid_int(batch_size) or batch_size < 1 or batch_size > 16:
            errors.append(
                f"training.batch_size: Must be an integer between 1 and 16 "
                f"(got {batch_size!r}). Use smaller values for limited GPU memory."
            )

        # Validate epochs (Requirement 7.2: 1 to 10)
        epochs = training_config.get("epochs", 3)
        if not self._is_valid_int(epochs) or epochs < 1 or epochs > 10:
            errors.append(
                f"training.epochs: Must be an integer between 1 and 10 "
                f"(got {epochs!r})."
            )

        # Validate gradient_accumulation_steps (Requirement 7.2: 1 to 16)
        grad_accum = training_config.get("gradient_accumulation_steps", 4)
        if not self._is_valid_int(grad_accum) or grad_accum < 1 or grad_accum > 16:
            errors.append(
                f"training.gradient_accumulation_steps: Must be an integer between 1 and 16 "
                f"(got {grad_accum!r})."
            )

        # Validate max_length
        max_length = training_config.get("max_length", 1024)
        if not self._is_valid_int(max_length) or max_length < 128 or max_length > 4096:
            errors.append(
                f"training.max_length: Must be an integer between 128 and 4096 "
                f"(got {max_length!r})."
            )

        return errors

    @staticmethod
    def _is_valid_int(value: Any) -> bool:
        """Check that a value is a genuine integer, rejecting bool (int subclass).

        Python's `bool` is a subclass of `int`, so `isinstance(True, int)` is
        True. Hyperparameters like batch_size are semantically integers, not
        booleans, so `True`/`False` must be rejected even though they would
        otherwise pass an `isinstance(x, int)` check.

        Args:
            value: The value to check.

        Returns:
            True if value is an int and not a bool.
        """
        return isinstance(value, int) and not isinstance(value, bool)

    @staticmethod
    def _is_valid_glob(pattern: str) -> bool:
        """Check if a string is a valid glob pattern.

        Attempts to use the pattern with fnmatch. Most strings are valid
        glob patterns, but we reject patterns with unbalanced brackets.

        Args:
            pattern: The glob pattern string to validate.

        Returns:
            True if the pattern is valid, False otherwise.
        """
        try:
            # fnmatch.translate converts a glob to a regex; if it raises, the glob is invalid
            fnmatch.translate(pattern)
            return True
        except Exception:
            return False
