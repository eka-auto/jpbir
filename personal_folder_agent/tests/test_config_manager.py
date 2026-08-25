"""Unit tests for the YAMLConfigurationManager (task 7.4).

Covers YAML parsing (valid + malformed), hyperparameter boundary values,
error message clarity, defaults, save/load round-trip, chunking strategy
validation, and model architecture validation.

These are unit-level specifics that complement the property-based tests in
test_config_validation_property.py (task 7.3), which already cover the
accept/reject behavior across broad value ranges. Here we focus on exact
boundaries, aggregated error text, file I/O, and defaults.

Validates Requirements 7.1 and 7.4.
"""

import math

import pytest
import yaml

from personal_folder_agent.components.config_manager import (
    ConfigValidationError,
    DEFAULT_CONFIG,
    VALID_MODEL_ARCHITECTURES,
    YAMLConfigurationManager,
)
from personal_folder_agent.models import ChunkingStrategy


def _write_yaml(tmp_path, text):
    path = tmp_path / "config.yaml"
    path.write_text(text, encoding="utf-8")
    return str(path)


def _make_folder(tmp_path, name):
    folder = tmp_path / name
    folder.mkdir(exist_ok=True)
    return str(folder).replace("\\", "/")


def _valid_config_dict(tmp_path):
    """Return a complete, valid config dict with existing folder paths."""
    folder = _make_folder(tmp_path, "data")
    return {
        "folders": {
            "paths": [folder],
            "max_depth": 5,
            "exclude_patterns": ["*.log", "node_modules/**"],
        },
        "processing": {
            "file_filters": ["*.txt", "*.md"],
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
        },
    }


# --- 1. Valid YAML parsing -------------------------------------------------


def test_load_valid_yaml_parses_all_sections(tmp_path):
    folder = _make_folder(tmp_path, "data")
    yaml_text = f"""
folders:
  paths:
    - "{folder}"
  max_depth: 7
  exclude_patterns:
    - "*.log"
    - "*.tmp"
processing:
  file_filters:
    - "*.txt"
    - "*.md"
    - "*.pdf"
  chunking:
    strategy: "paragraph_aware"
    max_tokens: 2048
    min_tokens: 256
training:
  model: "Qwen2.5-7B-Instruct"
  epochs: 5
  batch_size: 4
  learning_rate: 0.0001
  gradient_accumulation_steps: 8
  max_length: 2048
"""
    path = _write_yaml(tmp_path, yaml_text)
    manager = YAMLConfigurationManager(path)
    config = manager.load_configuration()

    assert config["folders"]["paths"] == [folder]
    assert config["folders"]["max_depth"] == 7
    assert config["folders"]["exclude_patterns"] == ["*.log", "*.tmp"]
    assert config["processing"]["file_filters"] == ["*.txt", "*.md", "*.pdf"]
    assert config["processing"]["chunking"]["strategy"] == "paragraph_aware"
    assert config["processing"]["chunking"]["max_tokens"] == 2048
    assert config["processing"]["chunking"]["min_tokens"] == 256
    assert config["training"]["model"] == "Qwen2.5-7B-Instruct"
    assert config["training"]["epochs"] == 5
    assert config["training"]["batch_size"] == 4
    assert config["training"]["learning_rate"] == 0.0001
    assert config["training"]["gradient_accumulation_steps"] == 8
    assert config["training"]["max_length"] == 2048


# --- 2. Malformed YAML -----------------------------------------------------


def test_malformed_yaml_raises_yaml_error(tmp_path):
    path = _write_yaml(tmp_path, "folders:\n  paths: [unclosed\n  - bad")
    manager = YAMLConfigurationManager(path)
    with pytest.raises(yaml.YAMLError):
        manager.load_configuration()


# --- 3. Missing file -------------------------------------------------------


def test_load_missing_file_raises_file_not_found(tmp_path):
    manager = YAMLConfigurationManager(str(tmp_path / "does_not_exist.yaml"))
    with pytest.raises(FileNotFoundError):
        manager.load_configuration()


# --- 4. Hyperparameter boundary values -------------------------------------


@pytest.mark.parametrize(
    "param,min_val,max_val",
    [
        ("learning_rate", 1e-6, 1e-3),
        ("batch_size", 1, 16),
        ("epochs", 1, 10),
        ("gradient_accumulation_steps", 1, 16),
    ],
)
def test_hyperparameter_boundaries_accepted(tmp_path, param, min_val, max_val):
    for value in (min_val, max_val):
        config = _valid_config_dict(tmp_path)
        config["training"][param] = value
        manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
        manager.save_configuration(config)  # should not raise


@pytest.mark.parametrize(
    "param,min_val,max_val",
    [
        ("learning_rate", 1e-6, 1e-3),
        ("batch_size", 1, 16),
        ("epochs", 1, 10),
        ("gradient_accumulation_steps", 1, 16),
    ],
)
def test_hyperparameter_boundaries_rejected(tmp_path, param, min_val, max_val):
    # Below minimum
    below = min_val - 1 if isinstance(min_val, int) else min_val / 10
    # Above maximum
    above = max_val + 1 if isinstance(max_val, int) else max_val * 10

    for value in (below, above):
        config = _valid_config_dict(tmp_path)
        config["training"][param] = value
        manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
        with pytest.raises(ConfigValidationError) as exc_info:
            manager.save_configuration(config)
        message = str(exc_info.value)
        assert f"training.{param}" in message
        assert "got" in message


def test_learning_rate_nan_rejected(tmp_path):
    config = _valid_config_dict(tmp_path)
    config["training"]["learning_rate"] = float("nan")
    manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
    with pytest.raises(ConfigValidationError) as exc_info:
        manager.save_configuration(config)
    assert "training.learning_rate" in str(exc_info.value)


def test_bool_rejected_for_int_param(tmp_path):
    config = _valid_config_dict(tmp_path)
    config["training"]["batch_size"] = True
    manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
    with pytest.raises(ConfigValidationError) as exc_info:
        manager.save_configuration(config)
    assert "training.batch_size" in str(exc_info.value)


# --- 5. Error message clarity ----------------------------------------------


def test_multiple_invalid_params_listed_individually(tmp_path):
    config = _valid_config_dict(tmp_path)
    config["training"]["learning_rate"] = 5.0
    config["training"]["batch_size"] = 99
    config["training"]["epochs"] = 0
    config["training"]["gradient_accumulation_steps"] = -3
    config["training"]["model"] = "GPT-4"

    manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
    with pytest.raises(ConfigValidationError) as exc_info:
        manager.save_configuration(config)

    message = str(exc_info.value)
    errors = exc_info.value.errors

    # Each invalid parameter appears with its own error entry
    assert "training.learning_rate" in message
    assert "training.batch_size" in message
    assert "training.epochs" in message
    assert "training.gradient_accumulation_steps" in message
    assert "training.model" in message

    # Each error names the parameter, states the range, and echoes the value
    assert any("training.learning_rate" in e and "1e-6" in e and "1e-3" in e and "5.0" in e for e in errors)
    assert any("training.batch_size" in e and "1 and 16" in e and "99" in e for e in errors)
    assert any("training.epochs" in e and "1 and 10" in e and "0" in e for e in errors)
    assert any("training.gradient_accumulation_steps" in e and "1 and 16" in e and "-3" in e for e in errors)
    assert any("training.model" in e and "GPT-4" in e for e in errors)

    # Exactly five errors, one per invalid parameter
    assert len(errors) == 5


# --- 6. Defaults -----------------------------------------------------------


def test_missing_training_section_gets_defaults(tmp_path):
    folder = _make_folder(tmp_path, "data")
    yaml_text = f"""
folders:
  paths:
    - "{folder}"
"""
    path = _write_yaml(tmp_path, yaml_text)
    manager = YAMLConfigurationManager(path)
    config = manager.load_configuration()

    assert config["training"] == DEFAULT_CONFIG["training"]
    assert config["processing"] == DEFAULT_CONFIG["processing"]
    assert config["storage"] == DEFAULT_CONFIG["storage"]


def test_missing_individual_keys_get_defaults(tmp_path):
    folder = _make_folder(tmp_path, "data")
    yaml_text = f"""
folders:
  paths:
    - "{folder}"
training:
  epochs: 7
"""
    path = _write_yaml(tmp_path, yaml_text)
    manager = YAMLConfigurationManager(path)
    config = manager.load_configuration()

    # Provided value is preserved
    assert config["training"]["epochs"] == 7
    # Missing keys fall back to defaults
    assert config["training"]["batch_size"] == DEFAULT_CONFIG["training"]["batch_size"]
    assert config["training"]["learning_rate"] == DEFAULT_CONFIG["training"]["learning_rate"]
    assert config["training"]["model"] == DEFAULT_CONFIG["training"]["model"]


# --- 7. save_configuration round-trip --------------------------------------


def test_save_then_load_round_trip(tmp_path):
    config = _valid_config_dict(tmp_path)
    path = str(tmp_path / "config.yaml")
    manager = YAMLConfigurationManager(path)

    assert manager.save_configuration(config) is True

    loaded = YAMLConfigurationManager(path).load_configuration()

    assert loaded["folders"]["paths"] == config["folders"]["paths"]
    assert loaded["folders"]["max_depth"] == config["folders"]["max_depth"]
    assert loaded["folders"]["exclude_patterns"] == config["folders"]["exclude_patterns"]
    assert loaded["processing"]["file_filters"] == config["processing"]["file_filters"]
    assert loaded["processing"]["chunking"]["strategy"] == config["processing"]["chunking"]["strategy"]
    assert loaded["training"]["model"] == config["training"]["model"]
    assert loaded["training"]["epochs"] == config["training"]["epochs"]
    assert loaded["training"]["batch_size"] == config["training"]["batch_size"]
    assert loaded["training"]["learning_rate"] == config["training"]["learning_rate"]
    assert loaded["training"]["gradient_accumulation_steps"] == config["training"]["gradient_accumulation_steps"]


def test_save_invalid_config_raises_before_writing(tmp_path):
    config = _valid_config_dict(tmp_path)
    config["training"]["epochs"] = 999
    path = str(tmp_path / "config.yaml")
    manager = YAMLConfigurationManager(path)

    with pytest.raises(ConfigValidationError):
        manager.save_configuration(config)

    # File must not have been written
    import os

    assert not os.path.exists(path)


# --- 8. Chunking strategy --------------------------------------------------


@pytest.mark.parametrize("strategy", [s.value for s in ChunkingStrategy])
def test_valid_chunking_strategies_accepted(tmp_path, strategy):
    config = _valid_config_dict(tmp_path)
    config["processing"]["chunking"]["strategy"] = strategy
    manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
    manager.save_configuration(config)  # should not raise


def test_invalid_chunking_strategy_rejected(tmp_path):
    config = _valid_config_dict(tmp_path)
    config["processing"]["chunking"]["strategy"] = "word_by_word"
    manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
    with pytest.raises(ConfigValidationError) as exc_info:
        manager.save_configuration(config)
    message = str(exc_info.value)
    assert "processing.chunking.strategy" in message
    assert "word_by_word" in message


# --- 9. Model architecture -------------------------------------------------


@pytest.mark.parametrize("model", VALID_MODEL_ARCHITECTURES)
def test_valid_model_architectures_accepted(tmp_path, model):
    config = _valid_config_dict(tmp_path)
    config["training"]["model"] = model
    manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
    manager.save_configuration(config)  # should not raise


def test_invalid_model_architecture_rejected(tmp_path):
    config = _valid_config_dict(tmp_path)
    config["training"]["model"] = "Llama-3-8B"
    manager = YAMLConfigurationManager(str(tmp_path / "config.yaml"))
    with pytest.raises(ConfigValidationError) as exc_info:
        manager.save_configuration(config)
    message = str(exc_info.value)
    assert "training.model" in message
    assert "Llama-3-8B" in message
