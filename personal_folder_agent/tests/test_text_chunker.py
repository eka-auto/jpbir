"""Unit tests for the TextChunker component.

Tests cover:
- Initialization and configuration validation
- Token counting with tiktoken cl100k_base
- Sentence-aware chunking behavior
- Chunk size validation (512-1024 token range)
- Force-splitting of oversized sentences
- Chunk ID format and byte offset tracking
- Lazy-loaded Qwen 2.5 tokenizer integration (mocked; no network access)
"""

import sys

import pytest

from personal_folder_agent.components.text_chunker import TextChunkerImpl
from personal_folder_agent.models import TextChunk


class _FakeQwenTokenizer:
    """Deterministic stand-in for a Hugging Face tokenizer used in tests.

    Tokenizes by splitting on whitespace so that behavior is predictable
    without downloading a real model.
    """

    def __init__(self):
        self.encode_calls = 0

    def encode(self, text: str):
        self.encode_calls += 1
        return text.split()

    def decode(self, token_ids):
        return " ".join(token_ids)


class TestTextChunkerInit:
    """Tests for TextChunker initialization and configuration."""

    def test_default_initialization(self):
        """Chunker initializes with default 512-1024 token range."""
        chunker = TextChunkerImpl()
        assert chunker.min_chunk_tokens == 512
        assert chunker.max_chunk_tokens == 1024

    def test_custom_chunk_sizes(self):
        """Chunker accepts custom min/max chunk sizes."""
        chunker = TextChunkerImpl(max_chunk_size=2048, min_chunk_size=256)
        assert chunker.min_chunk_tokens == 256
        assert chunker.max_chunk_tokens == 2048

    def test_invalid_max_chunk_size_raises(self):
        """Raises ValueError for max_chunk_size < 1."""
        with pytest.raises(ValueError, match="max_chunk_size must be >= 1"):
            TextChunkerImpl(max_chunk_size=0)

    def test_invalid_min_chunk_size_raises(self):
        """Raises ValueError for min_chunk_size < 1."""
        with pytest.raises(ValueError, match="min_chunk_size must be >= 1"):
            TextChunkerImpl(min_chunk_size=0)

    def test_min_greater_than_max_raises(self):
        """Raises ValueError when min_chunk_size > max_chunk_size."""
        with pytest.raises(ValueError, match="min_chunk_size.*must be <= max_chunk_size"):
            TextChunkerImpl(max_chunk_size=100, min_chunk_size=200)


class TestCountTokens:
    """Tests for token counting functionality."""

    def test_empty_string_returns_zero(self):
        """Empty string has zero tokens."""
        chunker = TextChunkerImpl()
        assert chunker.count_tokens("") == 0

    def test_single_word(self):
        """Single word returns at least 1 token."""
        chunker = TextChunkerImpl()
        count = chunker.count_tokens("hello")
        assert count >= 1

    def test_sentence_token_count(self):
        """A typical sentence produces a reasonable token count."""
        chunker = TextChunkerImpl()
        text = "The quick brown fox jumps over the lazy dog."
        count = chunker.count_tokens(text)
        # cl100k_base should produce roughly 9-11 tokens for this
        assert 5 <= count <= 15

    def test_longer_text_more_tokens(self):
        """Longer text produces more tokens than shorter text."""
        chunker = TextChunkerImpl()
        short = "Hello world."
        long_text = "Hello world. " * 100
        assert chunker.count_tokens(long_text) > chunker.count_tokens(short)

    def test_whitespace_only_returns_tokens(self):
        """Whitespace-only text still produces tokens."""
        chunker = TextChunkerImpl()
        # Spaces do count as tokens in tiktoken
        count = chunker.count_tokens("   ")
        assert count >= 1


class TestChunkDocument:
    """Tests for document chunking behavior."""

    def test_empty_text_returns_empty_list(self):
        """Empty text produces no chunks."""
        chunker = TextChunkerImpl()
        result = chunker.chunk_document("", "test.txt")
        assert result == []

    def test_whitespace_only_returns_empty(self):
        """Whitespace-only text produces no chunks."""
        chunker = TextChunkerImpl()
        result = chunker.chunk_document("   \n\t  ", "test.txt")
        assert result == []

    def test_short_text_single_chunk(self):
        """Text under max_chunk_tokens returns a single chunk."""
        chunker = TextChunkerImpl(max_chunk_size=1024, min_chunk_size=1)
        text = "This is a short document. It should not be split."
        result = chunker.chunk_document(text, "doc.txt")

        assert len(result) == 1
        assert result[0].text == text
        assert result[0].source_file == "doc.txt"
        assert result[0].chunk_index == 0
        assert result[0].byte_offset == 0
        assert result[0].chunk_id == "doc.txt:0"
        assert result[0].token_count > 0

    def test_chunk_id_format(self):
        """Chunk IDs follow the {file_path}:{chunk_index} format."""
        chunker = TextChunkerImpl(max_chunk_size=10, min_chunk_size=1)
        # Create text that will be split into multiple chunks
        text = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth one here."
        result = chunker.chunk_document(text, "/path/to/file.txt")

        for i, chunk in enumerate(result):
            assert chunk.chunk_id == f"/path/to/file.txt:{i}"
            assert chunk.chunk_index == i

    def test_all_chunks_within_max_tokens(self):
        """All produced chunks must not exceed max_chunk_tokens."""
        chunker = TextChunkerImpl(max_chunk_size=50, min_chunk_size=1)
        # Generate text that requires splitting
        text = "This is a sentence. " * 200
        result = chunker.chunk_document(text, "large.txt")

        assert len(result) > 1
        for chunk in result:
            assert chunk.token_count <= chunker.max_chunk_tokens

    def test_byte_offsets_are_sequential(self):
        """Byte offsets should be non-decreasing across chunks."""
        chunker = TextChunkerImpl(max_chunk_size=20, min_chunk_size=1)
        text = "Hello world! " * 50
        result = chunker.chunk_document(text, "file.txt")

        assert len(result) > 1
        prev_offset = 0
        for chunk in result:
            assert chunk.byte_offset >= prev_offset
            prev_offset = chunk.byte_offset

    def test_sentence_boundary_preservation(self):
        """Chunker tries to split at sentence boundaries."""
        # Use a small max to force splitting, but sentences should stay intact
        chunker = TextChunkerImpl(max_chunk_size=30, min_chunk_size=1)
        text = (
            "First sentence here. "
            "Second sentence here. "
            "Third sentence here. "
            "Fourth sentence here. "
            "Fifth sentence here."
        )
        result = chunker.chunk_document(text, "test.txt")

        # Each chunk should contain complete sentences (ending with '. ' or '.')
        for chunk in result:
            stripped = chunk.text.strip()
            # Should not start with lowercase (would indicate mid-sentence split)
            # unless it's a force-split chunk
            if "force_split" not in chunk.metadata:
                assert stripped[0].isupper() or stripped[0].isdigit(), (
                    f"Chunk appears to start mid-sentence: '{stripped[:30]}...'"
                )

    def test_force_split_oversized_sentence(self):
        """Sentences exceeding max_chunk_tokens are force-split at token boundaries."""
        chunker = TextChunkerImpl(max_chunk_size=10, min_chunk_size=1)
        # A single long "sentence" with no boundary
        text = "word " * 100  # No sentence boundaries, ~100 tokens
        result = chunker.chunk_document(text, "big.txt")

        assert len(result) > 1
        for chunk in result:
            assert chunk.token_count <= 10

    def test_chunk_token_counts_are_positive(self):
        """All chunks have positive token counts."""
        chunker = TextChunkerImpl(max_chunk_size=50, min_chunk_size=1)
        text = "Sample text for chunking. " * 30
        result = chunker.chunk_document(text, "file.txt")

        for chunk in result:
            assert chunk.token_count > 0

    def test_returns_text_chunk_instances(self):
        """All returned objects are TextChunk dataclass instances."""
        chunker = TextChunkerImpl()
        text = "A sample document with some content."
        result = chunker.chunk_document(text, "sample.txt")

        for chunk in result:
            assert isinstance(chunk, TextChunk)

    def test_metadata_dict_present(self):
        """Each chunk has a metadata dictionary."""
        chunker = TextChunkerImpl()
        text = "Some text for testing metadata presence."
        result = chunker.chunk_document(text, "meta.txt")

        for chunk in result:
            assert isinstance(chunk.metadata, dict)


class TestChunkSizeValidation:
    """Tests for chunk size constraint enforcement (requirement 2.4)."""

    def test_no_chunk_exceeds_1024_tokens_default(self):
        """With default settings, no chunk exceeds 1024 tokens."""
        chunker = TextChunkerImpl()
        # Generate a large document
        text = "This is a moderately long sentence with various words. " * 500
        result = chunker.chunk_document(text, "large_doc.txt")

        for chunk in result:
            assert chunk.token_count <= 1024, (
                f"Chunk {chunk.chunk_id} has {chunk.token_count} tokens, exceeds 1024"
            )

    def test_custom_max_respected(self):
        """Custom max_chunk_size is enforced on all chunks."""
        max_size = 64
        chunker = TextChunkerImpl(max_chunk_size=max_size, min_chunk_size=1)
        text = "Testing custom limits with enough text to split. " * 100
        result = chunker.chunk_document(text, "custom.txt")

        for chunk in result:
            assert chunk.token_count <= max_size


class TestQwenTokenizerIntegration:
    """Tests for optional Qwen 2.5 tokenizer support (Requirement 2.4).

    These tests mock the Hugging Face tokenizer so they run offline and
    fast, without downloading the real Qwen 2.5-3B model. They verify the
    lazy-loading contract and API surface rather than the real tokenizer's
    output.
    """

    def test_defaults_to_tiktoken_only(self):
        """By default, use_qwen_tokenizer is False and no Qwen tokenizer is loaded."""
        chunker = TextChunkerImpl()
        assert chunker.use_qwen_tokenizer is False
        assert chunker._qwen_tokenizer is None

    def test_qwen_model_name_default(self):
        """Default Qwen model name matches the Qwen 2.5-3B-Instruct identifier."""
        chunker = TextChunkerImpl()
        assert chunker.qwen_model_name == "Qwen/Qwen2.5-3B-Instruct"

    def test_constructing_with_qwen_flag_does_not_load_tokenizer(self):
        """Enabling use_qwen_tokenizer at construction time does not eagerly load it.

        This verifies the tokenizer is truly lazy: no network access or
        'transformers' import happens until a counting/chunking call needs it.
        """
        chunker = TextChunkerImpl(use_qwen_tokenizer=True)
        assert chunker._qwen_tokenizer is None

    def test_count_tokens_with_qwen_uses_mocked_tokenizer(self, monkeypatch):
        """count_tokens(use_qwen=True) delegates to the lazily-loaded Qwen tokenizer."""
        chunker = TextChunkerImpl()
        fake_tokenizer = _FakeQwenTokenizer()
        monkeypatch.setattr(chunker, "_get_qwen_tokenizer", lambda: fake_tokenizer)

        count = chunker.count_tokens("hello world foo", use_qwen=True)

        assert count == 3
        assert fake_tokenizer.encode_calls == 1

    def test_count_tokens_default_ignores_qwen_when_not_requested(self, monkeypatch):
        """Without requesting Qwen, count_tokens never touches the Qwen tokenizer."""
        chunker = TextChunkerImpl()

        def _fail_if_called():
            raise AssertionError("Qwen tokenizer should not be loaded")

        monkeypatch.setattr(chunker, "_get_qwen_tokenizer", _fail_if_called)

        # Should use tiktoken and not raise
        count = chunker.count_tokens("hello world")
        assert count >= 1

    def test_instance_level_use_qwen_tokenizer_flag(self, monkeypatch):
        """Constructing with use_qwen_tokenizer=True routes count_tokens through Qwen by default."""
        fake_tokenizer = _FakeQwenTokenizer()
        chunker = TextChunkerImpl(use_qwen_tokenizer=True)
        monkeypatch.setattr(chunker, "_get_qwen_tokenizer", lambda: fake_tokenizer)

        count = chunker.count_tokens("one two three four")

        assert count == 4
        assert fake_tokenizer.encode_calls == 1

    def test_per_call_override_takes_precedence_over_instance_default(self, monkeypatch):
        """use_qwen=False on a call overrides an instance default of True."""
        fake_tokenizer = _FakeQwenTokenizer()
        chunker = TextChunkerImpl(use_qwen_tokenizer=True)
        monkeypatch.setattr(chunker, "_get_qwen_tokenizer", lambda: fake_tokenizer)

        chunker.count_tokens("one two three four", use_qwen=False)

        assert fake_tokenizer.encode_calls == 0

    def test_chunk_document_with_qwen_stays_within_bounds(self, monkeypatch):
        """chunk_document() honors max_chunk_tokens when Qwen tokenizer is active.

        Uses a mocked whitespace tokenizer so the force-split path (which
        relies on encode/decode round-tripping) can be exercised
        deterministically offline.
        """
        chunker = TextChunkerImpl(
            max_chunk_size=10, min_chunk_size=1, use_qwen_tokenizer=True
        )
        fake_tokenizer = _FakeQwenTokenizer()
        monkeypatch.setattr(chunker, "_get_qwen_tokenizer", lambda: fake_tokenizer)

        text = "word " * 50  # No sentence boundaries; forces token-boundary splitting
        result = chunker.chunk_document(text, "qwen_test.txt")

        assert len(result) > 1
        for chunk in result:
            assert chunk.token_count <= 10

    def test_get_qwen_tokenizer_raises_import_error_when_transformers_missing(
        self, monkeypatch
    ):
        """_get_qwen_tokenizer surfaces a clear ImportError if transformers is unavailable.

        Simulates a missing 'transformers' package by forcing the import to fail,
        without requiring the package to actually be uninstalled.
        """
        chunker = TextChunkerImpl()
        monkeypatch.setitem(sys.modules, "transformers", None)

        with pytest.raises(ImportError, match="transformers"):
            chunker._get_qwen_tokenizer()

    def test_get_qwen_tokenizer_caches_instance(self, monkeypatch):
        """The Qwen tokenizer is only instantiated once and then cached."""
        chunker = TextChunkerImpl()
        load_calls = {"count": 0}

        class _FakeAutoTokenizer:
            @staticmethod
            def from_pretrained(model_name):
                load_calls["count"] += 1
                return _FakeQwenTokenizer()

        fake_module = type(sys)("transformers")
        fake_module.AutoTokenizer = _FakeAutoTokenizer
        monkeypatch.setitem(sys.modules, "transformers", fake_module)

        first = chunker._get_qwen_tokenizer()
        second = chunker._get_qwen_tokenizer()

        assert first is second
        assert load_calls["count"] == 1
