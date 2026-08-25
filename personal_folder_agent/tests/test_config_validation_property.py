"""Property-based tests for configuration validation (Property 4).

Validates Requirements 7.2 and 7.4: for any hyperparameter value, the
Configuration Manager accepts values within the valid range and rejects
values outside it with a clear error naming the parameter.

Hyperparameter ranges (inclusive boundaries):
- learning_rate: 1e-6 to 1e-3 (NaN rejected, bool rejected)
- batch_size: 1 to 16 (bool rejected)
- epochs: 1 to 10 (bool rejected)
- gradient_accumulation_steps: 1 to 16 (bool rejected)

Also covers chunking strategy validation (fixed_size, sentence_aware,
paragraph_aware).
"""

import math
import tempfile

from hypothesis import given, settings, strategies as st

from personal_folder_agent.components.config_manager import (
    ConfigValidationError,
    YAMLConfigurationManager,
)

VALID_STRATEGIES = ["fixed_size", "sentence_aware", "paragraph_aware"]


def _validate(config_dict):
    """Run validation on a config dict and return the raised error, if any."""
    with tempfile.TemporaryDirectory() as tmp:
        manager = YAMLConfigurationManager(str(tmp + "/config.yaml"))
        try:
            manager.save_configuration(config_dict)
            return None
        except ConfigValidationError as exc:
            return exc


def _inject(config_dict, param, value):
    """Return a copy of config_dict with the training param set to value."""
    config_dict["training"][param] = value
    return config_dict


def _lr_is_valid(lr):
    if isinstance(lr, bool):
        return False
    if not isinstance(lr, (int, float)):
        return False
    if math.isnan(lr):
        return False
    return 1e-6 <= lr <= 1e-3


def _int_is_valid(value, lo, hi):
    if isinstance(value, bool):
        return False
    if not isinstance(value, int):
        return False
    return lo <= value <= hi


# --- learning_rate ---------------------------------------------------------

lr_strategy = st.one_of(
    st.floats(min_value=1e-6, max_value=1e-3),
    st.floats(allow_nan=True, allow_infinity=False),
    st.floats(min_value=1e-3, exclude_min=True),
    st.floats(max_value=1e-6, exclude_max=True),
)


@given(lr=lr_strategy)
@settings(max_examples=200, deadline=None)
def test_learning_rate_validation(lr):
    config = YAMLConfigurationManager("unused.yaml").get_default_config()
    _inject(config, "learning_rate", lr)

    error = _validate(config)

    if _lr_is_valid(lr):
        assert error is None, f"valid learning_rate {lr!r} was rejected: {error}"
    else:
        assert error is not None, f"invalid learning_rate {lr!r} was accepted"
        assert "training.learning_rate" in str(error)


# --- batch_size ------------------------------------------------------------

batch_size_strategy = st.one_of(
    st.integers(min_value=1, max_value=16),
    st.integers(max_value=0),
    st.integers(min_value=17),
    st.booleans(),
)


@given(batch_size=batch_size_strategy)
@settings(max_examples=200, deadline=None)
def test_batch_size_validation(batch_size):
    config = YAMLConfigurationManager("unused.yaml").get_default_config()
    _inject(config, "batch_size", batch_size)

    error = _validate(config)

    if _int_is_valid(batch_size, 1, 16):
        assert error is None, f"valid batch_size {batch_size!r} was rejected: {error}"
    else:
        assert error is not None, f"invalid batch_size {batch_size!r} was accepted"
        assert "training.batch_size" in str(error)


# --- epochs ----------------------------------------------------------------

epochs_strategy = st.one_of(
    st.integers(min_value=1, max_value=10),
    st.integers(max_value=0),
    st.integers(min_value=11),
    st.booleans(),
)


@given(epochs=epochs_strategy)
@settings(max_examples=200, deadline=None)
def test_epochs_validation(epochs):
    config = YAMLConfigurationManager("unused.yaml").get_default_config()
    _inject(config, "epochs", epochs)

    error = _validate(config)

    if _int_is_valid(epochs, 1, 10):
        assert error is None, f"valid epochs {epochs!r} was rejected: {error}"
    else:
        assert error is not None, f"invalid epochs {epochs!r} was accepted"
        assert "training.epochs" in str(error)


# --- gradient_accumulation_steps -------------------------------------------

grad_accum_strategy = st.one_of(
    st.integers(min_value=1, max_value=16),
    st.integers(max_value=0),
    st.integers(min_value=17),
    st.booleans(),
)


@given(grad_accum=grad_accum_strategy)
@settings(max_examples=200, deadline=None)
def test_gradient_accumulation_steps_validation(grad_accum):
    config = YAMLConfigurationManager("unused.yaml").get_default_config()
    _inject(config, "gradient_accumulation_steps", grad_accum)

    error = _validate(config)

    if _int_is_valid(grad_accum, 1, 16):
        assert error is None, f"valid gradient_accumulation_steps {grad_accum!r} was rejected: {error}"
    else:
        assert error is not None, f"invalid gradient_accumulation_steps {grad_accum!r} was accepted"
        assert "training.gradient_accumulation_steps" in str(error)


# --- chunking strategy -----------------------------------------------------

strategy_strategy = st.one_of(
    st.sampled_from(VALID_STRATEGIES),
    st.text(),
)


@given(strategy=strategy_strategy)
@settings(max_examples=200, deadline=None)
def test_chunking_strategy_validation(strategy):
    config = YAMLConfigurationManager("unused.yaml").get_default_config()
    config["processing"]["chunking"]["strategy"] = strategy

    error = _validate(config)

    if strategy in VALID_STRATEGIES:
        assert error is None, f"valid strategy {strategy!r} was rejected: {error}"
    else:
        assert error is not None, f"invalid strategy {strategy!r} was accepted"
        assert "processing.chunking.strategy" in str(error)
