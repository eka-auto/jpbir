"""Unit tests for TextChunker chunking strategies and source references.

Companion to ``test_text_chunker.py`` (which covers init validation, token
counting basics, and Qwen tokenizer mocking). This file focuses on:

- Token counting accuracy against known cl100k_base counts
- Sentence-aware, paragraph-aware, and fixed-size chunking strategies
- The 100 KB chunking threshold (Requirement 2.3)
- Source reference preservation (Requirement 2.5)
- Strategy selection (constructor + per-call override) (Requirement 7.3)
- Force-splitting of oversized sentences (Requirement 2.4)
"""

import json

import pytest
import tiktoken

from personal_folder_agent.components.text_chunker import TextChunkerImpl
from personal_folder_agent.models import ChunkingStrategy, TextChunk


def _make_sentence_doc(sentence_count: int) -> str:
    """Build a document of distinct sentences, each ending with a period."""
    sentences = []
    for i in range(sentence_count):
        sentences.append(
            f"This is sentence number {i} with a few words to fill it out."
        )
    return " ".join(sentences)


def _make_paragraph_doc(paragraph_count: int) -> str:
    """Build a document of distinct paragraphs separated by blank lines."""
    paragraphs = []
    for i in range(paragraph_count):
        paragraphs.append(
            f"Paragraph {i} contains several sentences. "
            f"It has enough words to be meaningful. "
            f"This is the closing sentence of paragraph {i}."
        )
    return "\n\n".join(paragraphs)


class TestTokenCountingAccuracy:
    """Token counting must match tiktoken cl100k_base exactly."""

    def test_known_single_token(self):
        chunker = TextChunkerImpl()
        assert chunker.count_tokens("hello") == 1

    def test_known_two_tokens(self):
        chunker = TextChunkerImpl()
        assert chunker.count_tokens("hello world") == 2

    def test_empty_string_zero_tokens(self):
        chunker = TextChunkerImpl()
        assert chunker.count_tokens("") == 0

    def test_known_sentence_count(self):
        chunker = TextChunkerImpl()
        text = "The quick brown fox jumps over the lazy dog."
        assert chunker.count_tokens(text) == 10

    def test_matches_tiktoken_directly(self):
        chunker = TextChunkerImpl()
        encoding = tiktoken.get_encoding("cl100k_base")
        samples = [
            "hello",
            "hello world",
            "The quick brown fox jumps over the lazy dog.",
            "Tokenization, with punctuation! And more words.",
            "a" * 100,
        ]
        for text in samples:
            assert chunker.count_tokens(text) == len(encoding.encode(text))


class TestSentenceAwareChunker:
    """Sentence-aware chunking preserves sentence boundaries."""

    def test_chunks_do_not_break_sentences(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "sentences.txt")

        assert len(result) > 1
        for chunk in result:
            if "force_split" not in chunk.metadata:
                stripped = chunk.text.strip()
                assert stripped.endswith((".", "!", "?")), (
                    f"Non-force-split chunk does not end at a sentence boundary: "
                    f"'{stripped[-40:]}'"
                )

    def test_all_chunks_within_max_tokens(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "sentences.txt")

        for chunk in result:
            assert chunk.token_count <= chunker.max_chunk_tokens

    def test_chunk_ids_sequential(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "sentences.txt")

        for i, chunk in enumerate(result):
            assert chunk.chunk_index == i
            assert chunk.chunk_id == f"sentences.txt:{i}"

    def test_reconstructs_original_text(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "sentences.txt")

        assert "".join(c.text for c in result) == text


class TestParagraphAwareChunker:
    """Paragraph-aware chunking preserves paragraph boundaries."""

    def test_chunks_preserve_paragraph_boundaries(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_paragraph_doc(100)
        result = chunker.chunk_document(
            text, "paragraphs.txt", strategy=ChunkingStrategy.PARAGRAPH_AWARE
        )

        assert len(result) > 1
        for chunk in result:
            if "force_split" not in chunk.metadata:
                stripped = chunk.text.strip()
                # A non-force-split chunk must end with a complete paragraph,
                # i.e. its final sentence ends with a period.
                assert stripped.endswith("."), (
                    f"Chunk ends mid-paragraph: '{stripped[-40:]}'"
                )

    def test_all_chunks_within_max_tokens(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_paragraph_doc(100)
        result = chunker.chunk_document(
            text, "paragraphs.txt", strategy="paragraph_aware"
        )

        for chunk in result:
            assert chunk.token_count <= chunker.max_chunk_tokens

    def test_reconstructs_original_text(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_paragraph_doc(100)
        result = chunker.chunk_document(
            text, "paragraphs.txt", strategy=ChunkingStrategy.PARAGRAPH_AWARE
        )

        assert "".join(c.text for c in result) == text


class TestFixedSizeChunker:
    """Fixed-size chunking produces ~target-size overlapping chunks."""

    def test_chunks_are_approximately_target_size(self):
        chunker = TextChunkerImpl(max_chunk_size=1024, min_chunk_size=512)
        text = _make_sentence_doc(500)
        result = chunker.chunk_document(
            text, "fixed.txt", strategy=ChunkingStrategy.FIXED_SIZE
        )

        assert len(result) > 1
        target = (chunker.min_chunk_tokens + chunker.max_chunk_tokens) // 2
        # All non-final chunks should be close to the target size.
        for chunk in result[:-1]:
            assert chunk.token_count <= chunker.max_chunk_tokens
            assert chunk.token_count >= chunker.min_chunk_tokens
            assert abs(chunk.token_count - target) <= target // 2

    def test_consecutive_chunks_overlap(self):
        chunker = TextChunkerImpl(max_chunk_size=1024, min_chunk_size=512)
        text = _make_sentence_doc(500)
        result = chunker.chunk_document(
            text, "fixed.txt", strategy=ChunkingStrategy.FIXED_SIZE
        )

        assert len(result) > 1
        for prev, curr in zip(result[:-1], result[1:]):
            # Overlap means the tail of prev shares tokens with the head of curr.
            assert prev.text[-20:] in curr.text or curr.text[:20] in prev.text

    def test_metadata_has_fixed_size_strategy(self):
        chunker = TextChunkerImpl(max_chunk_size=1024, min_chunk_size=512)
        text = _make_sentence_doc(500)
        result = chunker.chunk_document(
            text, "fixed.txt", strategy=ChunkingStrategy.FIXED_SIZE
        )

        assert len(result) > 1
        for chunk in result:
            assert chunk.metadata.get("strategy") == "fixed_size"
            assert "overlap_tokens" in chunk.metadata


class TestChunkingThreshold:
    """The 100 KB threshold controls whether documents are split (Req 2.3)."""

    def test_small_document_should_not_chunk(self):
        chunker = TextChunkerImpl()
        text = "A small document." * 10
        assert chunker.should_chunk(text) is False

    def test_large_document_should_chunk(self):
        chunker = TextChunkerImpl()
        text = "x" * (100 * 1024 + 1)
        assert chunker.should_chunk(text) is True

    def test_exactly_100kb_does_not_chunk(self):
        chunker = TextChunkerImpl()
        text = "x" * (100 * 1024)
        assert chunker.should_chunk(text) is False

    def test_small_document_returns_single_chunk(self):
        chunker = TextChunkerImpl()
        text = "A small document that fits in one chunk."
        result = chunker.chunk_document(text, "small.txt")
        assert len(result) == 1
        assert result[0].text == text


class TestSourceReferencePreservation:
    """Source references are preserved per Requirement 2.5."""

    def test_chunk_id_format(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "/data/docs/report.txt")

        for i, chunk in enumerate(result):
            assert chunk.chunk_id == f"/data/docs/report.txt:{i}"

    def test_source_file_preserved(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "source.txt")

        for chunk in result:
            assert chunk.source_file == "source.txt"

    def test_byte_offsets_non_decreasing(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "offsets.txt")

        prev = -1
        for chunk in result:
            assert chunk.byte_offset >= prev
            prev = chunk.byte_offset

    def test_token_count_matches_count_tokens(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "counts.txt")

        for chunk in result:
            assert chunk.token_count == chunker.count_tokens(chunk.text)

    def test_to_dict_round_trip(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "roundtrip.txt")

        for chunk in result:
            d = chunk.to_dict()
            assert d["file_path"] == chunk.source_file
            assert d["chunk_index"] == chunk.chunk_index
            assert d["byte_offset"] == chunk.byte_offset
            assert d["token_count"] == chunk.token_count
            assert d["chunk_id"] == chunk.chunk_id

    def test_to_json_round_trip(self):
        chunker = TextChunkerImpl(max_chunk_size=64, min_chunk_size=1)
        text = _make_sentence_doc(200)
        result = chunker.chunk_document(text, "json.txt")

        for chunk in result:
            parsed = json.loads(chunk.to_json())
            assert parsed == chunk.to_dict()


class TestStrategySelection:
    """Strategy selection via constructor and per-call override (Req 7.3)."""

    def test_constructor_accepts_string(self):
        chunker = TextChunkerImpl(strategy="paragraph_aware")
        assert chunker.strategy == ChunkingStrategy.PARAGRAPH_AWARE

    def test_constructor_accepts_enum(self):
        chunker = TextChunkerImpl(strategy=ChunkingStrategy.FIXED_SIZE)
        assert chunker.strategy == ChunkingStrategy.FIXED_SIZE

    def test_default_strategy_is_sentence_aware(self):
        chunker = TextChunkerImpl()
        assert chunker.strategy == ChunkingStrategy.SENTENCE_AWARE

    def test_per_call_override(self):
        chunker = TextChunkerImpl(strategy=ChunkingStrategy.SENTENCE_AWARE)
        text = _make_sentence_doc(500)
        result = chunker.chunk_document(
            text, "override.txt", strategy=ChunkingStrategy.FIXED_SIZE
        )
        assert len(result) > 1
        for chunk in result:
            assert chunk.metadata.get("strategy") == "fixed_size"

    def test_invalid_strategy_raises(self):
        with pytest.raises(ValueError, match="Unknown chunking strategy"):
            TextChunkerImpl(strategy="bogus_strategy")

    def test_invalid_per_call_strategy_raises(self):
        chunker = TextChunkerImpl()
        with pytest.raises(ValueError, match="Unknown chunking strategy"):
            chunker.chunk_document("some text", "f.txt", strategy="nope")


class TestForceSplit:
    """Oversized sentences are force-split within max tokens (Req 2.4)."""

    def test_oversized_sentence_force_split(self):
        chunker = TextChunkerImpl(max_chunk_size=32, min_chunk_size=1)
        # A single "sentence" with no boundary markers, larger than max.
        text = "word " * 200
        result = chunker.chunk_document(text, "big.txt")

        assert len(result) > 1
        for chunk in result:
            assert chunk.token_count <= chunker.max_chunk_tokens

    def test_force_split_metadata_marked(self):
        chunker = TextChunkerImpl(max_chunk_size=32, min_chunk_size=1)
        text = "word " * 200
        result = chunker.chunk_document(text, "big.txt")

        assert any(chunk.metadata.get("force_split") is True for chunk in result)

    def test_force_split_reconstructs_text(self):
        chunker = TextChunkerImpl(max_chunk_size=32, min_chunk_size=1)
        text = "word " * 200
        result = chunker.chunk_document(text, "big.txt")

        assert "".join(c.text for c in result) == text
