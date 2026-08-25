# Inference Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `personal_folder_agent/components/inference_engine.py` so a user can query their trained agent and get responses grounded in the top-3 most relevant chunks of their own files.

**Architecture:** A concrete `QwenInferenceEngine` implementing the existing `InferenceEngine` ABC in `personal_folder_agent/interfaces.py`. Every heavy dependency (`torch`, `transformers`, `sentence_transformers`) is imported lazily inside the one function that uses it, behind two injectable seams — `_execute_generation` (the only torch-touching code) and `embedder_factory` (the only sentence-transformers-touching code). Cosine similarity is computed directly with numpy, which IS installed locally. Consequence: every task in this plan is fully testable on the user's laptop with no GPU and no torch.

**Tech Stack:** Python 3.8+, numpy (installed), pytest + hypothesis (installed), stdlib `hashlib`/`pickle`/`json`/`concurrent.futures`. Lazily: `sentence-transformers>=3.0`, `transformers>=4.45`, `torch` (Colab only).

**Spec:** `.kiro/specs/personal-folder-trained-agent/requirements.md` (Requirement 5) and `.kiro/specs/personal-folder-trained-agent/design.md` (section 6, "Inference Engine"). Task checkboxes to tick live in `.kiro/specs/personal-folder-trained-agent/tasks.md` items 12.1–12.5.

## Global Constraints

- **Never import `torch`, `transformers`, or `sentence_transformers` at module level.** The package must stay importable on a machine with none of them. Follow the existing pattern in `components/training_pipeline.py` (`import torch` inside `_gpu_available`, `from transformers import ...` inside `load_model`).
- **Local machine has no GPU and no torch.** `sentence_transformers` and `torch` are NOT in `venv`. `numpy`, `transformers`, `tiktoken`, `datasets`, `pytest`, `hypothesis` ARE. No test in this plan may require torch or sentence-transformers.
- Generation params are fixed by spec: `temperature=0.7`, `max_new_tokens=512`, **30-second** response timeout.
- Query limit is **2000 characters**; an over-length or invalid query must **stop all processing immediately** (Requirement 5.5) — not truncate, not best-effort.
- Semantic search returns **top 3** chunks by **cosine similarity** (Requirement 5.4).
- Type hints on every public method; `[tool.mypy]` in `pyproject.toml` sets `disallow_untyped_defs = true`.
- Test command is always `venv/Scripts/python.exe -m pytest <path> -v`. `pyproject.toml` `addopts` adds coverage automatically; do not fight it.
- Reuse the existing dataclasses in `personal_folder_agent/models.py` (`InferenceResult`, `SearchResult`). Do not redefine them.
- Commit after every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `personal_folder_agent/components/inference_engine.py` | **Create.** All inference logic: artifact loading, query validation, file index + search, context resolution, response generation. One module — one component with one public class, whose parts are only meaningful together. |
| `personal_folder_agent/tests/test_inference_engine.py` | **Create.** Unit + integration tests for the above. |
| `personal_folder_agent/components/__init__.py` | **Modify.** Export the new public names alongside the existing components. |
| `.kiro/specs/personal-folder-trained-agent/tasks.md` | **Modify.** Tick items 12.1–12.5 in the final task. |

---

### Task 1: Model artifact loading with checksum verification

Requirement 5.1: load the trained model by deserializing the pickle file and verifying integrity via checksum validation.

**Files:**
- Create: `personal_folder_agent/components/inference_engine.py`
- Test: `personal_folder_agent/tests/test_inference_engine.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces:
  - `class ModelIntegrityError(RuntimeError)`
  - `def compute_sha256(path: str, chunk_size: int = 1048576) -> str`
  - `@dataclass ModelArtifact` with fields `model: Any`, `tokenizer: Any`, `checksum: str`, `source_path: str`
  - `def load_model_artifact(model_path: str, expected_checksum: Optional[str] = None) -> ModelArtifact`

- [ ] **Step 1: Write the failing tests**

Create `personal_folder_agent/tests/test_inference_engine.py`:

```python
"""Tests for the Inference Engine component (Requirement 5)."""

import hashlib
import os
import pickle
from pathlib import Path

import pytest

from personal_folder_agent.components.inference_engine import (
    ModelArtifact,
    ModelIntegrityError,
    compute_sha256,
    load_model_artifact,
)


class _FakeModel:
    """Stand-in for a trained model; picklable, no torch required."""

    def __init__(self, name: str = "qwen-fake") -> None:
        self.name = name

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _FakeModel) and other.name == self.name


class _FakeTokenizer:
    def __init__(self, name: str = "tok-fake") -> None:
        self.name = name

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _FakeTokenizer) and other.name == self.name


def _write_pickle(path: Path, payload: object) -> str:
    path.write_bytes(pickle.dumps(payload, protocol=4))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_compute_sha256_matches_hashlib(tmp_path):
    target = tmp_path / "blob.bin"
    target.write_bytes(b"personal folder agent")
    expected = hashlib.sha256(b"personal folder agent").hexdigest()
    assert compute_sha256(str(target)) == expected


def test_compute_sha256_is_chunk_size_independent(tmp_path):
    target = tmp_path / "blob.bin"
    target.write_bytes(b"x" * 5000)
    assert compute_sha256(str(target), chunk_size=7) == compute_sha256(str(target))


def test_load_model_artifact_returns_model_and_tokenizer(tmp_path):
    model_file = tmp_path / "model.pkl"
    checksum = _write_pickle(model_file, {"model": _FakeModel(), "tokenizer": _FakeTokenizer()})

    artifact = load_model_artifact(str(model_file))

    assert isinstance(artifact, ModelArtifact)
    assert artifact.model == _FakeModel()
    assert artifact.tokenizer == _FakeTokenizer()
    assert artifact.checksum == checksum
    assert artifact.source_path == str(model_file)


def test_load_model_artifact_accepts_matching_expected_checksum(tmp_path):
    model_file = tmp_path / "model.pkl"
    checksum = _write_pickle(model_file, {"model": _FakeModel(), "tokenizer": None})

    artifact = load_model_artifact(str(model_file), expected_checksum=checksum)

    assert artifact.checksum == checksum


def test_load_model_artifact_rejects_mismatched_checksum(tmp_path):
    model_file = tmp_path / "model.pkl"
    _write_pickle(model_file, {"model": _FakeModel(), "tokenizer": None})

    with pytest.raises(ModelIntegrityError) as excinfo:
        load_model_artifact(str(model_file), expected_checksum="deadbeef")

    assert "checksum" in str(excinfo.value).lower()


def test_load_model_artifact_reads_sidecar_checksum_file(tmp_path):
    model_file = tmp_path / "model.pkl"
    checksum = _write_pickle(model_file, {"model": _FakeModel(), "tokenizer": None})
    (tmp_path / "model.pkl.sha256").write_text(checksum, encoding="utf-8")

    artifact = load_model_artifact(str(model_file))

    assert artifact.checksum == checksum


def test_load_model_artifact_rejects_bad_sidecar_checksum(tmp_path):
    model_file = tmp_path / "model.pkl"
    _write_pickle(model_file, {"model": _FakeModel(), "tokenizer": None})
    (tmp_path / "model.pkl.sha256").write_text("0" * 64, encoding="utf-8")

    with pytest.raises(ModelIntegrityError):
        load_model_artifact(str(model_file))


def test_load_model_artifact_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_model_artifact(str(tmp_path / "nope.pkl"))


def test_load_model_artifact_rejects_payload_without_model_key(tmp_path):
    model_file = tmp_path / "model.pkl"
    _write_pickle(model_file, {"tokenizer": _FakeTokenizer()})

    with pytest.raises(ModelIntegrityError) as excinfo:
        load_model_artifact(str(model_file))

    assert "model" in str(excinfo.value).lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v`

Expected: collection error — `ModuleNotFoundError: No module named 'personal_folder_agent.components.inference_engine'`.

- [ ] **Step 3: Write minimal implementation**

Create `personal_folder_agent/components/inference_engine.py`:

```python
"""Inference Engine component for querying a trained personal-folder agent.

This module implements the InferenceEngine interface: it loads a trained
model artifact, validates user queries, performs semantic search over the
user's own file chunks, and generates grounded responses.

Requirements addressed:
- 5.1: Load the trained model by deserializing the pickle file and verifying
       model integrity via checksum validation.
- 5.2: Generate a response within 30 seconds using temperature=0.7 and
       max_new_tokens=512.
- 5.3: Support file-location, content-understanding and organizational-pattern
       questions.
- 5.4: Retrieve the top 3 most relevant chunks by cosine similarity.
- 5.5: Reject queries that are invalid or exceed 2000 characters, and stop all
       processing for that query immediately.
- 5.6: Notify the user which referenced files were inaccessible and continue
       with the files that are available.

Heavy dependencies (torch, transformers, sentence-transformers) are imported
lazily inside the functions that need them so this module stays importable --
and testable -- on a machine with none of them installed.
"""

import hashlib
import json
import logging
import os
import pickle
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from personal_folder_agent.interfaces import InferenceEngine as InferenceEngineBase
from personal_folder_agent.models import InferenceResult, SearchResult

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_SIZE = 1024 * 1024


class ModelIntegrityError(RuntimeError):
    """Raised when a model artifact fails checksum or structure validation."""


@dataclass
class ModelArtifact:
    """A deserialized, integrity-checked trained model.

    Attributes:
        model: The trained model object.
        tokenizer: The tokenizer paired with the model (may be None).
        checksum: SHA-256 hex digest of the on-disk artifact.
        source_path: Path the artifact was loaded from.
    """

    model: Any
    tokenizer: Any
    checksum: str
    source_path: str


def compute_sha256(path: str, chunk_size: int = DEFAULT_CHUNK_SIZE) -> str:
    """Return the SHA-256 hex digest of a file, read in bounded chunks."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk_size)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def load_model_artifact(
    model_path: str, expected_checksum: Optional[str] = None
) -> ModelArtifact:
    """Load a trained model from a pickle file, verifying its integrity.

    The checksum is taken from ``expected_checksum`` when given, otherwise
    from a ``<model_path>.sha256`` sidecar file when one exists. When neither
    is available the artifact is loaded and its computed digest recorded.

    Raises:
        FileNotFoundError: The model file does not exist.
        ModelIntegrityError: Checksum mismatch, or payload missing a model.
    """
    if not os.path.isfile(model_path):
        raise FileNotFoundError("Model artifact not found: %s" % model_path)

    actual = compute_sha256(model_path)

    sidecar = model_path + ".sha256"
    if expected_checksum is None and os.path.isfile(sidecar):
        with open(sidecar, "r", encoding="utf-8") as handle:
            expected_checksum = handle.read().strip()

    if expected_checksum and expected_checksum.strip().lower() != actual.lower():
        raise ModelIntegrityError(
            "Model checksum mismatch for %s: expected %s, got %s"
            % (model_path, expected_checksum, actual)
        )

    with open(model_path, "rb") as handle:
        payload = pickle.load(handle)

    if not isinstance(payload, dict) or "model" not in payload:
        raise ModelIntegrityError(
            "Model artifact %s does not contain a 'model' entry" % model_path
        )

    return ModelArtifact(
        model=payload["model"],
        tokenizer=payload.get("tokenizer"),
        checksum=actual,
        source_path=model_path,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v`

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add personal_folder_agent/components/inference_engine.py personal_folder_agent/tests/test_inference_engine.py
git commit -m "feat(inference): load trained model with checksum verification"
```

---

### Task 2: Query validation

Requirement 5.5: reject queries with invalid syntax or over 2000 characters, explain the issue, suggest a correction, and stop processing immediately.

**Files:**
- Modify: `personal_folder_agent/components/inference_engine.py`
- Test: `personal_folder_agent/tests/test_inference_engine.py`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces:
  - `class QueryValidationError(ValueError)`
  - `DEFAULT_MAX_QUERY_CHARS: int = 2000`
  - `def validate_query(query: Any, max_chars: int = DEFAULT_MAX_QUERY_CHARS) -> str` — returns the stripped query, raises `QueryValidationError` otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `personal_folder_agent/tests/test_inference_engine.py`:

```python
from hypothesis import given, settings
from hypothesis import strategies as st

from personal_folder_agent.components.inference_engine import (
    DEFAULT_MAX_QUERY_CHARS,
    QueryValidationError,
    validate_query,
)


def test_validate_query_returns_stripped_query():
    assert validate_query("  where are my invoices?  ") == "where are my invoices?"


def test_validate_query_rejects_over_limit_with_actionable_message():
    too_long = "a" * (DEFAULT_MAX_QUERY_CHARS + 1)

    with pytest.raises(QueryValidationError) as excinfo:
        validate_query(too_long)

    message = str(excinfo.value)
    assert "2000" in message
    assert str(DEFAULT_MAX_QUERY_CHARS + 1) in message
    assert "shorten" in message.lower()


def test_validate_query_accepts_exactly_the_limit():
    at_limit = "a" * DEFAULT_MAX_QUERY_CHARS
    assert validate_query(at_limit) == at_limit


def test_validate_query_rejects_empty_and_whitespace():
    for bad in ["", "   ", "\n\t "]:
        with pytest.raises(QueryValidationError) as excinfo:
            validate_query(bad)
        assert "empty" in str(excinfo.value).lower()


def test_validate_query_rejects_non_string():
    for bad in [None, 42, ["what"], {"q": "what"}]:
        with pytest.raises(QueryValidationError) as excinfo:
            validate_query(bad)
        assert "text" in str(excinfo.value).lower()


def test_validate_query_rejects_control_characters():
    with pytest.raises(QueryValidationError) as excinfo:
        validate_query("find my \x00 files")
    assert "control character" in str(excinfo.value).lower()


def test_validate_query_allows_newlines_and_tabs():
    assert validate_query("line one\nline two\tindented") == "line one\nline two\tindented"


@settings(max_examples=50, deadline=None)
@given(st.text(min_size=1, max_size=DEFAULT_MAX_QUERY_CHARS))
def test_validate_query_property_accepts_or_explains(text):
    """Any query is either accepted, or rejected with a non-empty explanation."""
    try:
        result = validate_query(text)
        assert result == text.strip()
        assert result
    except QueryValidationError as error:
        assert str(error)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v -k validate_query`

Expected: `ImportError: cannot import name 'validate_query'`.

- [ ] **Step 3: Write minimal implementation**

Add to `personal_folder_agent/components/inference_engine.py`, after `ModelIntegrityError`:

```python
DEFAULT_MAX_QUERY_CHARS = 2000

# Control characters are rejected; tab, newline and carriage return are allowed
# because users legitimately paste multi-line questions.
_ALLOWED_CONTROL_CHARS = {"\t", "\n", "\r"}


class QueryValidationError(ValueError):
    """Raised when a user query is invalid; processing must stop immediately."""


def validate_query(query: Any, max_chars: int = DEFAULT_MAX_QUERY_CHARS) -> str:
    """Validate a user query and return it stripped of surrounding whitespace.

    Raises:
        QueryValidationError: The query is not text, is empty, contains control
            characters, or exceeds ``max_chars``. The message explains the
            problem and suggests a correction (Requirement 5.5).
    """
    if not isinstance(query, str):
        raise QueryValidationError(
            "Query must be text, got %s. Send the question as a string."
            % type(query).__name__
        )

    if len(query) > max_chars:
        raise QueryValidationError(
            "Query is %d characters, which exceeds the %d character limit. "
            "Please shorten the question, or split it into several smaller ones."
            % (len(query), max_chars)
        )

    stripped = query.strip()
    if not stripped:
        raise QueryValidationError(
            "Query is empty. Please type a question, for example: "
            "'Which folder holds my 2025 invoices?'"
        )

    for char in stripped:
        if ord(char) < 32 and char not in _ALLOWED_CONTROL_CHARS:
            raise QueryValidationError(
                "Query contains a control character (U+%04X) that cannot be "
                "processed. Please remove it and try again." % ord(char)
            )

    return stripped
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v`

Expected: all Task 1 and Task 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add personal_folder_agent/components/inference_engine.py personal_folder_agent/tests/test_inference_engine.py
git commit -m "feat(inference): validate queries and stop on invalid input"
```

---

### Task 3: Cosine similarity and the file index

Requirements 5.3 and 5.4: search file content and return the top 3 chunks by cosine similarity.

**Files:**
- Modify: `personal_folder_agent/components/inference_engine.py`
- Test: `personal_folder_agent/tests/test_inference_engine.py`

**Interfaces:**
- Consumes: `SearchResult` from `personal_folder_agent.models`.
- Produces:
  - `@dataclass IndexedChunk` with `chunk_id: str`, `file_path: str`, `text: str`, `embedding: Optional[List[float]] = None`
  - `def cosine_similarity(query_vector: Sequence[float], matrix: Sequence[Sequence[float]]) -> List[float]`
  - `DEFAULT_TOP_K: int = 3`
  - `class FileIndex` with `__init__(self, chunks: List[IndexedChunk]) -> None`, classmethod `from_chunks_jsonl(cls, path: str) -> "FileIndex"`, `set_embeddings(self, embeddings: Sequence[Sequence[float]]) -> None`, `search(self, query_vector: Sequence[float], top_k: int = DEFAULT_TOP_K, file_filter: Optional[Sequence[str]] = None) -> List[SearchResult]`, properties `chunks -> List[IndexedChunk]` and `texts -> List[str]`, and `__len__`.

- [ ] **Step 1: Write the failing tests**

Append to `personal_folder_agent/tests/test_inference_engine.py`:

```python
import json
import math

from personal_folder_agent.components.inference_engine import (
    FileIndex,
    IndexedChunk,
    cosine_similarity,
)
from personal_folder_agent.models import SearchResult


def _index_with_embeddings():
    chunks = [
        IndexedChunk("c1", "/docs/invoices.md", "invoice totals for 2025", [1.0, 0.0]),
        IndexedChunk("c2", "/docs/recipes.md", "how to bake bread", [0.0, 1.0]),
        IndexedChunk("c3", "/docs/invoices.md", "invoice numbering rules", [0.9, 0.1]),
    ]
    return FileIndex(chunks)


def test_cosine_similarity_identical_vector_is_one():
    assert cosine_similarity([1.0, 0.0], [[1.0, 0.0]])[0] == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vector_is_zero():
    assert cosine_similarity([1.0, 0.0], [[0.0, 1.0]])[0] == pytest.approx(0.0)


def test_cosine_similarity_is_magnitude_invariant():
    small = cosine_similarity([1.0, 1.0], [[1.0, 0.0]])[0]
    large = cosine_similarity([50.0, 50.0], [[7.0, 0.0]])[0]
    assert small == pytest.approx(large)
    assert small == pytest.approx(1.0 / math.sqrt(2.0))


def test_cosine_similarity_handles_zero_vector_without_nan():
    assert cosine_similarity([0.0, 0.0], [[1.0, 0.0]]) == [0.0]


def test_search_returns_top_k_ranked_descending():
    results = _index_with_embeddings().search([1.0, 0.0], top_k=2)

    assert len(results) == 2
    assert all(isinstance(item, SearchResult) for item in results)
    assert [item.chunk_id for item in results] == ["c1", "c3"]
    assert results[0].similarity_score >= results[1].similarity_score
    assert results[0].file_path == "/docs/invoices.md"
    assert results[0].chunk_text == "invoice totals for 2025"


def test_search_defaults_to_top_3():
    assert len(_index_with_embeddings().search([1.0, 0.0])) == 3


def test_search_top_k_larger_than_index_returns_all():
    assert len(_index_with_embeddings().search([1.0, 0.0], top_k=99)) == 3


def test_search_file_filter_restricts_to_named_files():
    results = _index_with_embeddings().search([1.0, 0.0], file_filter=["/docs/recipes.md"])

    assert len(results) == 1
    assert results[0].chunk_id == "c2"


def test_search_without_embeddings_raises():
    index = FileIndex([IndexedChunk("c1", "/a.md", "text")])
    with pytest.raises(ValueError) as excinfo:
        index.search([1.0, 0.0])
    assert "embedding" in str(excinfo.value).lower()


def test_set_embeddings_assigns_in_order():
    index = FileIndex(
        [IndexedChunk("c1", "/a.md", "alpha"), IndexedChunk("c2", "/b.md", "beta")]
    )
    index.set_embeddings([[1.0, 0.0], [0.0, 1.0]])

    assert index.search([0.0, 1.0], top_k=1)[0].chunk_id == "c2"


def test_set_embeddings_length_mismatch_raises():
    index = FileIndex([IndexedChunk("c1", "/a.md", "alpha")])
    with pytest.raises(ValueError):
        index.set_embeddings([[1.0], [0.0]])


def test_from_chunks_jsonl_reads_chunk_records(tmp_path):
    jsonl = tmp_path / "chunks.jsonl"
    records = [
        {"chunk_id": "c1", "source_file": "/docs/a.md", "text": "alpha text"},
        {"chunk_id": "c2", "source_file": "/docs/b.md", "text": "beta text"},
    ]
    jsonl.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8"
    )

    index = FileIndex.from_chunks_jsonl(str(jsonl))

    assert index.texts == ["alpha text", "beta text"]
    assert len(index) == 2


def test_from_chunks_jsonl_skips_blank_lines(tmp_path):
    jsonl = tmp_path / "chunks.jsonl"
    jsonl.write_text(
        '{"chunk_id": "c1", "source_file": "/a.md", "text": "alpha"}\n\n\n',
        encoding="utf-8",
    )

    assert len(FileIndex.from_chunks_jsonl(str(jsonl))) == 1


def test_from_chunks_jsonl_reports_malformed_line(tmp_path):
    jsonl = tmp_path / "chunks.jsonl"
    jsonl.write_text('{"chunk_id": "c1"}\nnot json\n', encoding="utf-8")

    with pytest.raises(ValueError) as excinfo:
        FileIndex.from_chunks_jsonl(str(jsonl))

    assert "line 2" in str(excinfo.value)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v -k "cosine or search or jsonl or embeddings"`

Expected: `ImportError: cannot import name 'FileIndex'`.

- [ ] **Step 3: Write minimal implementation**

Append to `personal_folder_agent/components/inference_engine.py`:

```python
DEFAULT_TOP_K = 3


@dataclass
class IndexedChunk:
    """One searchable chunk of the user's own content.

    Attributes:
        chunk_id: Stable identifier for the chunk.
        file_path: Path of the file the chunk came from.
        text: The chunk text.
        embedding: Dense vector for the chunk, or None until embedded.
    """

    chunk_id: str
    file_path: str
    text: str
    embedding: Optional[List[float]] = None


def cosine_similarity(
    query_vector: Sequence[float], matrix: Sequence[Sequence[float]]
) -> List[float]:
    """Cosine similarity between one vector and each row of a matrix.

    A zero-magnitude vector scores 0.0 rather than producing NaN.
    """
    import numpy as np

    query = np.asarray(query_vector, dtype=np.float64)
    rows = np.asarray(matrix, dtype=np.float64)
    if rows.ndim == 1:
        rows = rows.reshape(1, -1)

    query_norm = float(np.linalg.norm(query))
    row_norms = np.linalg.norm(rows, axis=1)

    denominator = row_norms * query_norm
    numerator = rows.dot(query)

    scores = np.divide(
        numerator,
        denominator,
        out=np.zeros_like(numerator, dtype=np.float64),
        where=denominator > 0,
    )
    return [float(value) for value in scores]


class FileIndex:
    """An in-memory, searchable index over the user's file chunks."""

    def __init__(self, chunks: List[IndexedChunk]) -> None:
        self._chunks: List[IndexedChunk] = list(chunks)

    def __len__(self) -> int:
        return len(self._chunks)

    @property
    def chunks(self) -> List[IndexedChunk]:
        """The indexed chunks, in insertion order."""
        return list(self._chunks)

    @property
    def texts(self) -> List[str]:
        """Chunk texts, in insertion order -- the input to an embedder."""
        return [chunk.text for chunk in self._chunks]

    @classmethod
    def from_chunks_jsonl(cls, path: str) -> "FileIndex":
        """Build an index from the ``chunks.jsonl`` hand-off artifact.

        Each non-blank line is a JSON object with ``chunk_id``,
        ``source_file`` and ``text`` keys. Blank lines are skipped.
        """
        chunks: List[IndexedChunk] = []
        with open(path, "r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    record = json.loads(stripped)
                except ValueError as error:
                    raise ValueError(
                        "Malformed JSON on line %d of %s: %s"
                        % (line_number, path, error)
                    )
                chunks.append(
                    IndexedChunk(
                        chunk_id=str(record.get("chunk_id", "line-%d" % line_number)),
                        file_path=str(record.get("source_file", "")),
                        text=str(record.get("text", "")),
                        embedding=record.get("embedding"),
                    )
                )
        return cls(chunks)

    def set_embeddings(self, embeddings: Sequence[Sequence[float]]) -> None:
        """Attach embeddings to the indexed chunks, positionally."""
        if len(embeddings) != len(self._chunks):
            raise ValueError(
                "Got %d embeddings for %d chunks"
                % (len(embeddings), len(self._chunks))
            )
        for chunk, embedding in zip(self._chunks, embeddings):
            chunk.embedding = [float(value) for value in embedding]

    def search(
        self,
        query_vector: Sequence[float],
        top_k: int = DEFAULT_TOP_K,
        file_filter: Optional[Sequence[str]] = None,
    ) -> List[SearchResult]:
        """Return the ``top_k`` most similar chunks, highest score first."""
        candidates = self._chunks
        if file_filter is not None:
            wanted = set(file_filter)
            candidates = [chunk for chunk in candidates if chunk.file_path in wanted]

        if not candidates:
            return []

        missing = [chunk.chunk_id for chunk in candidates if chunk.embedding is None]
        if missing:
            raise ValueError(
                "Cannot search: %d chunk(s) have no embedding (e.g. %s). "
                "Call set_embeddings() first." % (len(missing), missing[0])
            )

        scores = cosine_similarity(
            query_vector, [chunk.embedding for chunk in candidates]
        )
        ranked = sorted(zip(candidates, scores), key=lambda pair: pair[1], reverse=True)

        return [
            SearchResult(
                file_path=chunk.file_path,
                chunk_text=chunk.text,
                similarity_score=score,
                chunk_id=chunk.chunk_id,
            )
            for chunk, score in ranked[: max(0, top_k)]
        ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add personal_folder_agent/components/inference_engine.py personal_folder_agent/tests/test_inference_engine.py
git commit -m "feat(inference): add file index with cosine-similarity top-k search"
```

---

### Task 4: Inaccessible file handling

Requirement 5.6: notify the user which referenced files could not be accessed, and continue with the files that are available.

**Files:**
- Modify: `personal_folder_agent/components/inference_engine.py`
- Test: `personal_folder_agent/tests/test_inference_engine.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `@dataclass ContextResolution` with `accessible: List[str]`, `inaccessible: List[Tuple[str, str]]`, and method `notice(self) -> str` returning `""` when nothing was inaccessible.
  - `def resolve_context_files(paths: Optional[Sequence[str]]) -> ContextResolution`

- [ ] **Step 1: Write the failing tests**

Append to `personal_folder_agent/tests/test_inference_engine.py`:

```python
from personal_folder_agent.components.inference_engine import (
    ContextResolution,
    resolve_context_files,
)


def test_resolve_context_files_none_is_empty():
    resolution = resolve_context_files(None)
    assert resolution.accessible == []
    assert resolution.inaccessible == []
    assert resolution.notice() == ""


def test_resolve_context_files_accepts_readable_file(tmp_path):
    readable = tmp_path / "notes.md"
    readable.write_text("hello", encoding="utf-8")

    resolution = resolve_context_files([str(readable)])

    assert resolution.accessible == [str(readable)]
    assert resolution.inaccessible == []


def test_resolve_context_files_reports_missing_file(tmp_path):
    missing = str(tmp_path / "gone.md")

    resolution = resolve_context_files([missing])

    assert resolution.accessible == []
    assert len(resolution.inaccessible) == 1
    path, reason = resolution.inaccessible[0]
    assert path == missing
    assert "not found" in reason.lower()


def test_resolve_context_files_continues_with_available_files(tmp_path):
    readable = tmp_path / "ok.md"
    readable.write_text("data", encoding="utf-8")
    missing = str(tmp_path / "gone.md")

    resolution = resolve_context_files([str(readable), missing])

    assert resolution.accessible == [str(readable)]
    assert [path for path, _ in resolution.inaccessible] == [missing]


def test_resolve_context_files_reports_directory_as_inaccessible(tmp_path):
    resolution = resolve_context_files([str(tmp_path)])

    assert resolution.accessible == []
    assert "not a file" in resolution.inaccessible[0][1].lower()


def test_notice_names_every_inaccessible_file(tmp_path):
    missing_a = str(tmp_path / "a.md")
    missing_b = str(tmp_path / "b.md")

    notice = resolve_context_files([missing_a, missing_b]).notice()

    assert missing_a in notice
    assert missing_b in notice
    assert "could not be accessed" in notice.lower()


def test_resolve_context_files_reports_unreadable_file(tmp_path, monkeypatch):
    unreadable = tmp_path / "locked.md"
    unreadable.write_text("secret", encoding="utf-8")

    real_access = os.access

    def fake_access(path, mode):
        if str(path) == str(unreadable) and mode == os.R_OK:
            return False
        return real_access(path, mode)

    monkeypatch.setattr(os, "access", fake_access)

    resolution = resolve_context_files([str(unreadable)])

    assert resolution.accessible == []
    assert "permission denied" in resolution.inaccessible[0][1].lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v -k "resolve_context or notice"`

Expected: `ImportError: cannot import name 'ContextResolution'`.

- [ ] **Step 3: Write minimal implementation**

Append to `personal_folder_agent/components/inference_engine.py`:

```python
@dataclass
class ContextResolution:
    """Which requested context files could be read, and which could not.

    Attributes:
        accessible: Paths that exist and are readable.
        inaccessible: (path, reason) pairs for paths that are not usable.
    """

    accessible: List[str] = field(default_factory=list)
    inaccessible: List[Tuple[str, str]] = field(default_factory=list)

    def notice(self) -> str:
        """A user-facing sentence naming every inaccessible file.

        Returns the empty string when every requested file was readable
        (Requirement 5.6).
        """
        if not self.inaccessible:
            return ""
        details = "; ".join(
            "%s (%s)" % (path, reason) for path, reason in self.inaccessible
        )
        return (
            "The following file(s) could not be accessed and were skipped: %s"
            % details
        )


def resolve_context_files(paths: Optional[Sequence[str]]) -> ContextResolution:
    """Partition requested context files into readable and unreadable.

    Never raises for an unusable path: the caller continues with whatever is
    available and surfaces ``ContextResolution.notice()`` to the user.
    """
    resolution = ContextResolution()
    if not paths:
        return resolution

    for path in paths:
        if not os.path.exists(path):
            resolution.inaccessible.append((path, "not found"))
        elif not os.path.isfile(path):
            resolution.inaccessible.append((path, "not a file"))
        elif not os.access(path, os.R_OK):
            resolution.inaccessible.append((path, "permission denied"))
        else:
            resolution.accessible.append(path)

    if resolution.inaccessible:
        logger.warning(
            "Skipping %d inaccessible context file(s)", len(resolution.inaccessible)
        )
    return resolution
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add personal_folder_agent/components/inference_engine.py personal_folder_agent/tests/test_inference_engine.py
git commit -m "feat(inference): report inaccessible context files and continue"
```

---

### Task 5: QwenInferenceEngine — search_files and the embedder seam

Requirements 5.3 and 5.4, wired into the public class.

**Files:**
- Modify: `personal_folder_agent/components/inference_engine.py`
- Test: `personal_folder_agent/tests/test_inference_engine.py`

**Interfaces:**
- Consumes: `ModelArtifact`, `load_model_artifact` (Task 1); `validate_query` (Task 2); `FileIndex`, `IndexedChunk`, `DEFAULT_TOP_K` (Task 3).
- Produces:
  - `DEFAULT_EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"`
  - `class QwenInferenceEngine(InferenceEngineBase)` with
    `__init__(self, model_path: str, file_index: Optional[FileIndex] = None, *, expected_checksum: Optional[str] = None, embedder_factory: Optional[Callable[[], Any]] = None, artifact_loader: Optional[Callable[..., ModelArtifact]] = None, embedding_model_name: str = DEFAULT_EMBEDDING_MODEL) -> None`
  - `def _load_embedder(self) -> Any` — the ONLY sentence-transformers-touching method
  - `def embed_texts(self, texts: Sequence[str]) -> List[List[float]]`
  - `def search_files(self, query: str, top_k: int = DEFAULT_TOP_K) -> List[SearchResult]`
  - properties `artifact -> ModelArtifact` and `file_index -> Optional[FileIndex]`

- [ ] **Step 1: Write the failing tests**

Append to `personal_folder_agent/tests/test_inference_engine.py`:

```python
from personal_folder_agent.components.inference_engine import QwenInferenceEngine


class _FakeEmbedder:
    """Deterministic 2-D embedder: no sentence-transformers, no torch."""

    def __init__(self):
        self.calls = 0

    def encode(self, texts, **kwargs):
        self.calls += 1
        vectors = []
        for text in texts:
            lowered = text.lower()
            vectors.append([float(lowered.count("invoice")), float(lowered.count("bread"))])
        return vectors


def _engine(tmp_path, index=None, embedder=None):
    model_file = tmp_path / "model.pkl"
    _write_pickle(model_file, {"model": _FakeModel(), "tokenizer": _FakeTokenizer()})
    return QwenInferenceEngine(
        str(model_file),
        file_index=index,
        embedder_factory=(lambda: embedder) if embedder else None,
    )


def _sample_index():
    return FileIndex(
        [
            IndexedChunk("c1", "/docs/invoices.md", "invoice invoice totals"),
            IndexedChunk("c2", "/docs/recipes.md", "bread bread bread"),
            IndexedChunk("c3", "/docs/mixed.md", "invoice and bread"),
        ]
    )


def test_engine_loads_artifact_on_construction(tmp_path):
    engine = _engine(tmp_path)
    assert engine.artifact.model == _FakeModel()
    assert len(engine.artifact.checksum) == 64


def test_search_files_returns_top_k_ranked(tmp_path):
    engine = _engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())

    results = engine.search_files("where are my invoices", top_k=2)

    assert [item.chunk_id for item in results] == ["c1", "c3"]
    assert results[0].similarity_score >= results[1].similarity_score


def test_search_files_defaults_to_three(tmp_path):
    engine = _engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())
    assert len(engine.search_files("invoice")) == 3


def test_search_files_embeds_corpus_only_once(tmp_path):
    embedder = _FakeEmbedder()
    engine = _engine(tmp_path, index=_sample_index(), embedder=embedder)

    engine.search_files("invoice")
    calls_after_first = embedder.calls
    engine.search_files("bread")

    # One corpus embed + one query embed on the first search; the second search
    # embeds only its query, so the corpus is not re-embedded.
    assert calls_after_first == 2
    assert embedder.calls == 3


def test_search_files_validates_the_query(tmp_path):
    engine = _engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())

    with pytest.raises(QueryValidationError):
        engine.search_files("a" * (DEFAULT_MAX_QUERY_CHARS + 1))


def test_search_files_without_index_returns_empty(tmp_path):
    engine = _engine(tmp_path, embedder=_FakeEmbedder())
    assert engine.search_files("invoice") == []


def test_engine_does_not_import_heavy_deps_at_module_level():
    import sys

    import personal_folder_agent.components.inference_engine as module

    assert module is not None
    assert "sentence_transformers" not in sys.modules
    assert "torch" not in sys.modules
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v -k "engine or search_files"`

Expected: `ImportError: cannot import name 'QwenInferenceEngine'`.

- [ ] **Step 3: Write minimal implementation**

Append to `personal_folder_agent/components/inference_engine.py`:

```python
DEFAULT_EMBEDDING_MODEL = "all-MiniLM-L6-v2"


class QwenInferenceEngine(InferenceEngineBase):
    """Queries a trained personal-folder agent, grounded in the user's chunks.

    All heavy dependencies sit behind injectable seams so this class can be
    constructed and exercised on a machine with no GPU, no torch and no
    sentence-transformers: pass ``embedder_factory`` and override
    ``_execute_generation``.
    """

    def __init__(
        self,
        model_path: str,
        file_index: Optional[FileIndex] = None,
        *,
        expected_checksum: Optional[str] = None,
        embedder_factory: Optional[Callable[[], Any]] = None,
        artifact_loader: Optional[Callable[..., ModelArtifact]] = None,
        embedding_model_name: str = DEFAULT_EMBEDDING_MODEL,
    ) -> None:
        loader = artifact_loader or load_model_artifact
        self._artifact: ModelArtifact = loader(
            model_path, expected_checksum=expected_checksum
        )
        self._file_index = file_index
        self._embedder_factory = embedder_factory
        self._embedding_model_name = embedding_model_name
        self._embedder: Optional[Any] = None
        self._corpus_embedded = False
        self.timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @property
    def artifact(self) -> ModelArtifact:
        """The loaded, integrity-checked model artifact."""
        return self._artifact

    @property
    def file_index(self) -> Optional[FileIndex]:
        """The index searched for grounding context, if one was supplied."""
        return self._file_index

    def _load_embedder(self) -> Any:
        """Return the sentence-transformers embedder, constructing it once.

        This is the only method that touches sentence-transformers; tests
        inject ``embedder_factory`` instead.
        """
        if self._embedder is None:
            if self._embedder_factory is not None:
                self._embedder = self._embedder_factory()
            else:
                from sentence_transformers import SentenceTransformer

                self._embedder = SentenceTransformer(self._embedding_model_name)
        return self._embedder

    def embed_texts(self, texts: Sequence[str]) -> List[List[float]]:
        """Embed a batch of texts into dense vectors."""
        if not texts:
            return []
        embedder = self._load_embedder()
        vectors = embedder.encode(list(texts))
        return [[float(value) for value in vector] for vector in vectors]

    def _ensure_corpus_embedded(self) -> None:
        """Embed the whole index once, lazily, on first search."""
        if self._file_index is None or self._corpus_embedded:
            return
        if len(self._file_index) == 0:
            self._corpus_embedded = True
            return
        self._file_index.set_embeddings(self.embed_texts(self._file_index.texts))
        self._corpus_embedded = True

    def search_files(
        self, query: str, top_k: int = DEFAULT_TOP_K
    ) -> List[SearchResult]:
        """Search indexed file content by cosine similarity (Requirement 5.4).

        Raises:
            QueryValidationError: The query is invalid (Requirement 5.5).
        """
        cleaned = validate_query(query)
        if self._file_index is None or len(self._file_index) == 0:
            return []

        self._ensure_corpus_embedded()
        query_vector = self.embed_texts([cleaned])[0]
        return self._file_index.search(query_vector, top_k=top_k)
```

Note: `DEFAULT_TIMEOUT_SECONDS` is referenced by `__init__` and is defined in Task 6. Add its definition now, alongside the other constants, so this task's tests run:

```python
DEFAULT_TIMEOUT_SECONDS = 30.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add personal_folder_agent/components/inference_engine.py personal_folder_agent/tests/test_inference_engine.py
git commit -m "feat(inference): add QwenInferenceEngine with semantic file search"
```

---

### Task 6: generate_response with the 30-second timeout, plus wiring

Requirement 5.2, and the integration tests that close out spec item 12.5.

**Files:**
- Modify: `personal_folder_agent/components/inference_engine.py`
- Modify: `personal_folder_agent/components/__init__.py`
- Modify: `.kiro/specs/personal-folder-trained-agent/tasks.md`
- Test: `personal_folder_agent/tests/test_inference_engine.py`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces:
  - `DEFAULT_TEMPERATURE: float = 0.7`, `DEFAULT_MAX_NEW_TOKENS: int = 512` (`DEFAULT_TIMEOUT_SECONDS` was added in Task 5)
  - `class InferenceTimeoutError(RuntimeError)`
  - `def build_prompt(self, query: str, results: Sequence[SearchResult], notice: str = "") -> str`
  - `def _execute_generation(self, prompt: str) -> Tuple[str, int]` — the ONLY torch/transformers-touching method; returns `(response_text, tokens_generated)`
  - `def generate_response(self, query: str, context_files: Optional[List[str]] = None) -> InferenceResult`

- [ ] **Step 1: Write the failing tests**

Append to `personal_folder_agent/tests/test_inference_engine.py`:

```python
import time

from personal_folder_agent.components.inference_engine import (
    DEFAULT_MAX_NEW_TOKENS,
    DEFAULT_TEMPERATURE,
    InferenceTimeoutError,
)
from personal_folder_agent.models import InferenceResult


class _StubEngine(QwenInferenceEngine):
    """Engine with the single torch-touching seam replaced."""

    def __init__(self, *args, **kwargs):
        self.delay = kwargs.pop("delay", 0.0)
        self.prompts = []
        super().__init__(*args, **kwargs)

    def _execute_generation(self, prompt):
        self.prompts.append(prompt)
        if self.delay:
            time.sleep(self.delay)
        return "stubbed answer", 7


def _stub_engine(tmp_path, index=None, embedder=None, **kwargs):
    model_file = tmp_path / "model.pkl"
    _write_pickle(model_file, {"model": _FakeModel(), "tokenizer": _FakeTokenizer()})
    return _StubEngine(
        str(model_file),
        file_index=index,
        embedder_factory=(lambda: embedder) if embedder else None,
        **kwargs,
    )


def test_generate_response_returns_inference_result(tmp_path):
    engine = _stub_engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())

    result = engine.generate_response("where are my invoices")

    assert isinstance(result, InferenceResult)
    assert result.query == "where are my invoices"
    assert result.response == "stubbed answer"
    assert result.tokens_generated == 7
    assert result.processing_time_ms >= 0


def test_generate_response_grounds_prompt_in_top_chunks(tmp_path):
    engine = _stub_engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())

    result = engine.generate_response("invoice")

    assert "invoice invoice totals" in engine.prompts[0]
    assert "/docs/invoices.md" in result.context_files


def test_generate_response_confidence_is_top_similarity(tmp_path):
    engine = _stub_engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())

    result = engine.generate_response("invoice")
    top = engine.search_files("invoice", top_k=1)[0]

    assert result.confidence_score == pytest.approx(top.similarity_score)


def test_generate_response_rejects_over_long_query_before_generating(tmp_path):
    engine = _stub_engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())

    with pytest.raises(QueryValidationError):
        engine.generate_response("a" * (DEFAULT_MAX_QUERY_CHARS + 1))

    assert engine.prompts == []


def test_generate_response_notes_inaccessible_context_file(tmp_path):
    engine = _stub_engine(tmp_path, index=_sample_index(), embedder=_FakeEmbedder())
    missing = str(tmp_path / "gone.md")

    result = engine.generate_response("invoice", context_files=[missing])

    assert missing in result.response
    assert "could not be accessed" in result.response.lower()
    assert missing not in result.context_files


def test_generate_response_continues_with_available_context_file(tmp_path):
    readable = tmp_path / "invoices.md"
    readable.write_text("invoice data", encoding="utf-8")
    index = FileIndex([IndexedChunk("c1", str(readable), "invoice invoice totals")])
    engine = _stub_engine(tmp_path, index=index, embedder=_FakeEmbedder())
    missing = str(tmp_path / "gone.md")

    result = engine.generate_response("invoice", context_files=[str(readable), missing])

    assert result.context_files == [str(readable)]


def test_generate_response_works_without_an_index(tmp_path):
    engine = _stub_engine(tmp_path)

    result = engine.generate_response("hello there")

    assert result.response == "stubbed answer"
    assert result.context_files == []
    assert result.confidence_score == 0.0


def test_generate_response_times_out(tmp_path):
    engine = _stub_engine(tmp_path, delay=0.4)
    engine.timeout_seconds = 0.05

    with pytest.raises(InferenceTimeoutError) as excinfo:
        engine.generate_response("slow question")

    assert "timed out" in str(excinfo.value).lower() or "exceeded" in str(excinfo.value).lower()


def test_generation_defaults_match_the_spec():
    assert DEFAULT_TEMPERATURE == 0.7
    assert DEFAULT_MAX_NEW_TOKENS == 512


def test_component_package_exports_the_engine():
    from personal_folder_agent.components import QwenInferenceEngine as Exported

    assert Exported is QwenInferenceEngine
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/test_inference_engine.py -v -k "generate_response or times_out or defaults_match or package_exports"`

Expected: `ImportError: cannot import name 'InferenceTimeoutError'`.

- [ ] **Step 3: Write minimal implementation**

Add alongside the other constants in `personal_folder_agent/components/inference_engine.py`:

```python
DEFAULT_TEMPERATURE = 0.7
DEFAULT_MAX_NEW_TOKENS = 512


class InferenceTimeoutError(RuntimeError):
    """Raised when response generation exceeds the configured timeout."""
```

Add these methods to `QwenInferenceEngine`:

```python
    def build_prompt(
        self, query: str, results: Sequence[SearchResult], notice: str = ""
    ) -> str:
        """Assemble the grounded prompt sent to the model."""
        sections: List[str] = [
            "You are a personal assistant trained on the user's own files. "
            "Answer using the context below. If the context does not contain "
            "the answer, say so plainly."
        ]
        if notice:
            sections.append("Note: " + notice)
        if results:
            context = "\n\n".join(
                "[%d] %s\n%s" % (position, item.file_path, item.chunk_text)
                for position, item in enumerate(results, start=1)
            )
            sections.append("Context:\n" + context)
        sections.append("Question: " + query)
        sections.append("Answer:")
        return "\n\n".join(sections)

    def _execute_generation(self, prompt: str) -> Tuple[str, int]:
        """Run the model. The ONLY method that touches torch/transformers.

        Returns:
            (response_text, tokens_generated)
        """
        import torch  # noqa: F401  (clear failure when torch is absent)

        tokenizer = self._artifact.tokenizer
        model = self._artifact.model

        inputs = tokenizer(prompt, return_tensors="pt")
        if hasattr(model, "device"):
            inputs = {key: value.to(model.device) for key, value in inputs.items()}

        outputs = model.generate(
            **inputs,
            temperature=DEFAULT_TEMPERATURE,
            max_new_tokens=DEFAULT_MAX_NEW_TOKENS,
            do_sample=True,
        )
        prompt_length = int(inputs["input_ids"].shape[-1])
        generated = outputs[0][prompt_length:]
        text = tokenizer.decode(generated, skip_special_tokens=True)
        return text.strip(), int(generated.shape[-1])

    def generate_response(
        self, query: str, context_files: Optional[List[str]] = None
    ) -> InferenceResult:
        """Answer a query, grounded in the user's own content.

        Raises:
            QueryValidationError: Invalid query; nothing is generated
                (Requirement 5.5).
            InferenceTimeoutError: Generation exceeded ``timeout_seconds``
                (Requirement 5.2).
        """
        import time as _time
        from concurrent.futures import ThreadPoolExecutor
        from concurrent.futures import TimeoutError as FuturesTimeoutError

        cleaned = validate_query(query)
        started = _time.time()

        resolution = resolve_context_files(context_files)
        notice = resolution.notice()

        results: List[SearchResult] = []
        if self._file_index is not None and len(self._file_index) > 0:
            self._ensure_corpus_embedded()
            query_vector = self.embed_texts([cleaned])[0]
            results = self._file_index.search(
                query_vector,
                top_k=DEFAULT_TOP_K,
                file_filter=resolution.accessible or None,
            )

        prompt = self.build_prompt(cleaned, results, notice)

        executor = ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(self._execute_generation, prompt)
            try:
                text, tokens = future.result(timeout=self.timeout_seconds)
            except FuturesTimeoutError:
                raise InferenceTimeoutError(
                    "Response generation exceeded %s seconds and timed out. "
                    "Try a shorter or more specific question."
                    % self.timeout_seconds
                )
        finally:
            executor.shutdown(wait=False)

        if notice:
            text = "%s\n\n%s" % (text, notice)

        return InferenceResult(
            query=cleaned,
            response=text,
            processing_time_ms=int((_time.time() - started) * 1000),
            context_files=sorted({item.file_path for item in results}),
            confidence_score=results[0].similarity_score if results else 0.0,
            tokens_generated=tokens,
        )
```

- [ ] **Step 4: Wire the component export**

Add to `personal_folder_agent/components/__init__.py`, matching the existing import/export style already in that file:

```python
from personal_folder_agent.components.inference_engine import (
    ContextResolution,
    FileIndex,
    IndexedChunk,
    InferenceTimeoutError,
    ModelArtifact,
    ModelIntegrityError,
    QueryValidationError,
    QwenInferenceEngine,
    load_model_artifact,
    resolve_context_files,
    validate_query,
)
```

If that file defines `__all__`, append each of those names to it.

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `venv/Scripts/python.exe -m pytest personal_folder_agent/tests/ -v`

Expected: every test in `test_inference_engine.py` passes and no pre-existing test regresses.

- [ ] **Step 6: Verify the no-heavy-imports constraint holds**

Run: `venv/Scripts/python.exe -c "import sys, personal_folder_agent.components.inference_engine; assert 'torch' not in sys.modules; assert 'sentence_transformers' not in sys.modules; print('lazy imports OK')"`

Expected: `lazy imports OK`

- [ ] **Step 7: Tick the spec checkboxes**

In `.kiro/specs/personal-folder-trained-agent/tasks.md`, change the parent item `12.` and children `12.1`, `12.2`, `12.3`, `12.4`, `12.5` from `- [ ]` / `- [~]` to `- [x]`.

- [ ] **Step 8: Commit**

```bash
git add personal_folder_agent/components/inference_engine.py personal_folder_agent/components/__init__.py personal_folder_agent/tests/test_inference_engine.py .kiro/specs/personal-folder-trained-agent/tasks.md
git commit -m "feat(inference): grounded response generation with 30s timeout"
```

---

## Notes for the executor

- **Do not install torch or sentence-transformers to make a test pass.** If a test needs them, the seam is in the wrong place — move the dependency behind `_execute_generation` or `embedder_factory`.
- `_execute_generation` is the one method with no local test coverage, by design; it runs on Colab. Keep it small enough to verify by eye.
- `test_engine_does_not_import_heavy_deps_at_module_level` guards the whole architecture. If it starts failing, a lazy import has leaked to module scope.
- Task 5 defines `DEFAULT_TIMEOUT_SECONDS` because `__init__` needs it; Task 6 adds the remaining generation constants. This is the one forward reference in the plan and it is deliberate.
