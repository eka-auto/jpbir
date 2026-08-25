"""Model Exporter component for persisting trained models.

This module implements the ``ModelExporter`` interface, responsible for
saving a trained model to local storage, generating a ``model_metadata.json``
file describing the training session, and (in a later task) uploading the
artifacts to Google Drive.

Requirements addressed:
- 4.1: Save the trained model to the local file system at the configured
       output directory when training completed successfully AND files > 0
       AND tokens > 0.
- 4.2: Include metadata about training data (file count, total tokens,
       folder list), hyperparameters (epochs, learning_rate, batch_size),
       and performance metrics (final_loss, training_duration_seconds) in a
       JSON file named ``model_metadata.json``.
- 4.5: Serialize the model using pickle protocol version 4 or higher.

The versioned archive creation (Requirement 4.4) and Google Drive upload
(Requirement 4.3) are handled in later tasks (10.2 and 10.3 respectively).
"""

import json
import logging
import os
import pickle
from pathlib import Path
from typing import Any, Dict, List, Optional

from personal_folder_agent.interfaces import ModelExporter as ModelExporterBase
from personal_folder_agent.models import (
    ExportResult,
    TrainingMetadata,
    UploadResult,
)

logger = logging.getLogger(__name__)

# Pickle protocol used for model serialization (Requirement 4.5: >= 4).
PICKLE_PROTOCOL = 4

# Filename for the serialized model within the output directory.
MODEL_FILENAME = "model.pkl"

# Filename for the training metadata JSON (Requirement 4.2).
METADATA_FILENAME = "model_metadata.json"

# Keys (in priority order) that may hold the folder list within the
# training hyperparameters dictionary. The TrainingMetadata model does not
# carry an explicit folder list, so the exporter inspects the
# hyperparameters for folder information when available.
_FOLDER_LIST_KEYS = ("folders", "folder_paths", "folder_list", "paths")


class ModelExporter(ModelExporterBase):
    """Concrete implementation of the model exporter.

    Saves a trained model to a local output directory (created if missing)
    and writes a ``model_metadata.json`` describing the training session.

    Attributes:
        output_dir: Path to the local output directory where the model and
            metadata are written.
    """

    def __init__(self, output_dir: str) -> None:
        """Initialize the exporter with a local output directory.

        The directory is created (including parents) if it does not already
        exist.

        Args:
            output_dir: Path to the local output directory.
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Export (Requirements 4.1, 4.2, 4.5)
    # ------------------------------------------------------------------

    def export_model(
        self, model: Any, training_metadata: TrainingMetadata
    ) -> ExportResult:
        """Save the trained model and metadata to the output directory.

        Performs a precondition check before writing anything: training must
        have completed successfully (``end_time`` is not None), and the
        training data must have processed files (``total_files > 0``) and
        tokens (``total_tokens > 0``). If any precondition fails, an
        ``ExportResult`` with ``success=False`` and a descriptive
        ``error_message`` is returned and nothing is written.

        On success, the model is serialized with pickle protocol 4+ to
        ``model.pkl`` and a ``model_metadata.json`` is written containing the
        file count, total tokens, folder list, hyperparameters, and
        performance metrics.

        Args:
            model: The trained model object to export.
            training_metadata: Metadata about the training session.

        Returns:
            ExportResult with the local model path, metadata path, and status.
        """
        error = self._check_preconditions(training_metadata)
        if error is not None:
            logger.warning("Model export skipped: %s", error)
            return ExportResult(
                local_path="",
                archive_name="",
                metadata_path="",
                success=False,
                error_message=error,
            )

        model_path = self.output_dir / MODEL_FILENAME
        metadata_path = self.output_dir / METADATA_FILENAME

        try:
            self._save_model(model, model_path)
            self._save_metadata(training_metadata, metadata_path)
        except Exception as exc:  # noqa: BLE001 - surface any save failure
            logger.exception("Model export failed: %s", exc)
            return ExportResult(
                local_path=str(model_path),
                archive_name="",
                metadata_path=str(metadata_path),
                success=False,
                error_message=f"Failed to save model: {exc}",
            )

        logger.info("Model exported to %s", model_path)
        return ExportResult(
            local_path=str(model_path),
            archive_name="",
            metadata_path=str(metadata_path),
            success=True,
            error_message=None,
        )

    def _check_preconditions(self, training_metadata: TrainingMetadata) -> Optional[str]:
        """Validate export preconditions and return an error message if any fail.

        Preconditions (Requirement 4.1):
        - Training completed successfully (``end_time`` is not None).
        - Files processed > 0 (``data_statistics.total_files > 0``).
        - Tokens processed > 0 (``data_statistics.total_tokens > 0``).

        Args:
            training_metadata: Metadata about the training session.

        Returns:
            A descriptive error message if a precondition fails, otherwise
            None.
        """
        if training_metadata.end_time is None:
            return (
                "Training has not completed successfully (end_time is None); "
                "cannot export an incomplete model."
            )

        data_statistics = training_metadata.data_statistics
        if data_statistics.total_files <= 0:
            return (
                "No training data was processed (total_files is 0); "
                "cannot export a model trained on no files."
            )

        if data_statistics.total_tokens <= 0:
            return (
                "No training data was processed (total_tokens is 0); "
                "cannot export a model trained on no tokens."
            )

        return None

    def _save_model(self, model: Any, model_path: Path) -> None:
        """Serialize the model to disk using pickle protocol 4+.

        Args:
            model: The trained model object to serialize.
            model_path: Destination path for the serialized model.
        """
        with open(model_path, "wb") as f:
            pickle.dump(model, f, protocol=PICKLE_PROTOCOL)

    def _save_metadata(
        self, training_metadata: TrainingMetadata, metadata_path: Path
    ) -> None:
        """Write the training metadata JSON file.

        The JSON contains the file count, total tokens, folder list,
        hyperparameters, and performance metrics (Requirement 4.2).

        Args:
            training_metadata: Metadata about the training session.
            metadata_path: Destination path for the metadata JSON.
        """
        metadata = self._build_metadata(training_metadata)
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, default=str)

    def _build_metadata(self, training_metadata: TrainingMetadata) -> Dict[str, Any]:
        """Build the metadata dictionary for ``model_metadata.json``.

        Args:
            training_metadata: Metadata about the training session.

        Returns:
            A JSON-serializable dictionary with file count, total tokens,
            folder list, hyperparameters, and performance metrics.
        """
        data_statistics = training_metadata.data_statistics
        performance_metrics = training_metadata.performance_metrics
        hyperparameters = dict(training_metadata.hyperparameters)

        return {
            "file_count": data_statistics.total_files,
            "total_tokens": data_statistics.total_tokens,
            "folder_list": self._extract_folder_list(hyperparameters),
            "hyperparameters": hyperparameters,
            "performance_metrics": {
                "final_loss": performance_metrics.final_loss,
                "final_validation_loss": performance_metrics.final_validation_loss,
                "training_duration_seconds": performance_metrics.training_duration_seconds,
                "tokens_per_second": performance_metrics.tokens_per_second,
                "peak_memory_mb": performance_metrics.peak_memory_mb,
            },
        }

    @staticmethod
    def _extract_folder_list(hyperparameters: Dict[str, Any]) -> List[str]:
        """Extract the folder list from the hyperparameters dictionary.

        The ``TrainingMetadata`` model does not carry an explicit folder
        list, so the exporter inspects the hyperparameters for folder
        information under common keys (``folders``, ``folder_paths``,
        ``folder_list``, ``paths``). If none is found, an empty list is
        returned.

        Args:
            hyperparameters: The training hyperparameters dictionary.

        Returns:
            A list of folder path strings (possibly empty).
        """
        for key in _FOLDER_LIST_KEYS:
            value = hyperparameters.get(key)
            if isinstance(value, list):
                return [str(item) for item in value]
            if isinstance(value, str):
                return [value]
        return []

    # ------------------------------------------------------------------
    # Google Drive upload (Requirement 4.3) — implemented in task 10.3
    # ------------------------------------------------------------------

    def upload_to_google_drive(
        self, local_path: str, drive_folder_id: str
    ) -> UploadResult:
        """Upload model artifacts to Google Drive.

        Not yet implemented; the Google Drive integration (OAuth2
        authentication and upload) is handled in task 10.3.

        Args:
            local_path: Path to the local model archive to upload.
            drive_folder_id: Google Drive folder ID for the upload destination.

        Returns:
            UploadResult with ``success=False`` and a descriptive error
            message indicating the feature is not yet implemented.
        """
        return UploadResult(
            drive_file_id="",
            drive_url="",
            encrypted=False,
            success=False,
            error_message="Google Drive upload is not yet implemented (task 10.3).",
        )
