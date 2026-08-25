"""Property tests for the TextChunker component.

Tests cover:
- Property 2 (Chunk Token Count Bounds): for any document >100KB, all
  chunks have 512-1024 tokens (Requirements 2.3, 2.4).
- Property 3 (Chunk Metadata Completeness): for any chunk, metadata
  contains file path (non-empty), chunk index (>=0), byte offset (>=0),
  and token count (>0 matching actual) (Requirement 2.5).
"""

from hypothesis import given, settings, strategies as st

from personal_folder_agent.components.text_chunker import TextChunkerImpl
from personal_folder_agent.models import ChunkingStrategy

# Sentence fragments used to build arbitrary documents. Repeated enough
# times, they produce documents larger than 100 KB.
_SENTENCE = (
    "This is a reasonably long sentence about personal folder organization "
    "and document management systems. "
)
_PARAGRAPH = (
    "This paragraph discusses the structure of the personal folder agent "
    "and how it crawls directories to collect metadata. "
    "It contains several sentences about file processing. "
    "Each paragraph is separated by a blank line from the next one. "
)


@st.composite
def large_document_strategy(draw):
    """Generate documents guaranteed to exceed 100 KB (Requirement 2.3)."""
    n_sentences = draw(st.integers(min_value=1200, max_value=2000))
    return _SENTENCE * n_sentences


@st.composite
def any_document_strategy(draw):
    """Generate documents of arbitrary size (small and large)."""
    n_sentences = draw(st.integers(min_value=1, max_value=1500))
    return _SENTENCE * n_sentences


@st.composite
def paragraph_document_strategy(draw):
    """Generate paragraph-structured documents of arbitrary size."""
    n_paragraphs = draw(st.integers(min_value=1, max_value=500))
    return (_PARAGRAPH + "\n\n") * n_paragraphs


ALL_STRATEGIES = [
    ChunkingStrategy.SENTENCE_AWARE,
    ChunkingStrategy.PARAGRAPH_AWARE,
    ChunkingStrategy.FIXED_SIZE,
]


@settings(max_examples=20, deadline=None)
@given(document=large_document_strategy(), strategy=st.sampled_from(ALL_STRATEGIES))
def test_chunk_token_bounds_for_large_documents(document, strategy):
    """Property 2: every chunk of a >100KB document is within 512-1024 tokens.

    Validates Requirements 2.3 and 2.4.
    """
    chunker = TextChunkerImpl()
    assert chunker.should_chunk(document), "generated document must exceed 100 KB"

    chunks = chunker.chunk_document(document, "large_doc.txt", strategy=strategy)

    assert len(chunks) > 1, "a >100KB document must be split into multiple chunks"
    for chunk in chunks:
        assert chunk.token_count <= 1024, (
            f"chunk {chunk.chunk_id} has {chunk.token_count} tokens, exceeds 1024"
        )
        assert chunk.token_count >= 512, (
            f"chunk {chunk.chunk_id} has {chunk.token_count} tokens, below 512"
        )
        # Recorded token count must match the actual count (Requirement 2.4)
        actual = chunker.count_tokens(chunk.text)
        assert chunk.token_count == actual, (
            f"chunk {chunk.chunk_id} records {chunk.token_count} tokens, "
            f"actual count is {actual}"
        )


@settings(max_examples=20, deadline=None)
@given(document=any_document_strategy(), strategy=st.sampled_from(ALL_STRATEGIES))
def test_chunk_metadata_completeness(document, strategy):
    """Property 3: every chunk carries complete, consistent source metadata.

    Validates Requirement 2.5.
    """
    chunker = TextChunkerImpl()
    source_file = "/personal/folder/sample.txt"

    chunks = chunker.chunk_document(document, source_file, strategy=strategy)

    for index, chunk in enumerate(chunks):
        # File path: non-empty string
        assert isinstance(chunk.source_file, str) and chunk.source_file, (
            "chunk source_file must be a non-empty string"
        )
        assert chunk.source_file == source_file

        # Chunk index: non-negative and sequential
        assert chunk.chunk_index >= 0
        assert chunk.chunk_index == index

        # Byte offset: non-negative
        assert chunk.byte_offset >= 0

        # Token count: positive and matching the actual count
        assert chunk.token_count > 0
        assert chunk.token_count == chunker.count_tokens(chunk.text)

        # Chunk ID format: {file_path}:{chunk_index}
        assert chunk.chunk_id == f"{source_file}:{index}"

        # JSON-serializable metadata (Requirement 2.5)
        as_dict = chunk.to_dict()
        assert as_dict["file_path"] == source_file
        assert as_dict["chunk_index"] == index
        assert as_dict["byte_offset"] == chunk.byte_offset
        assert as_dict["token_count"] == chunk.token_count
        assert as_dict["chunk_id"] == chunk.chunk_id


@settings(max_examples=20, deadline=None)
@given(document=paragraph_document_strategy())
def test_paragraph_aware_chunk_metadata_completeness(document):
    """Property 3 for paragraph-aware chunking on paragraph-structured text."""
    chunker = TextChunkerImpl()
    source_file = "/personal/folder/notes.txt"

    chunks = chunker.chunk_document(
        document, source_file, strategy=ChunkingStrategy.PARAGRAPH_AWARE
    )

    for index, chunk in enumerate(chunks):
        assert chunk.source_file == source_file
        assert chunk.chunk_index == index
        assert chunk.byte_offset >= 0
        assert chunk.token_count > 0
        assert chunk.token_count == chunker.count_tokens(chunk.text)
        assert chunk.chunk_id == f"{source_file}:{index}"


@settings(max_examples=20, deadline=None)
@given(document=large_document_strategy())
def test_fixed_size_chunks_overlap(document):
    """Property: fixed-size chunks of a >100KB document overlap consecutively."""
    chunker = TextChunkerImpl()

    chunks = chunker.chunk_document(
        document, "fixed_doc.txt", strategy=ChunkingStrategy.FIXED_SIZE
    )

    assert len(chunks) > 1
    for i in range(len(chunks) - 1):
        prev_tokens = set(chunker._encode(chunks[i].text))
        next_tokens = set(chunker._encode(chunks[i + 1].text))
        assert prev_tokens & next_tokens, (
            f"chunks {i} and {i + 1} do not overlap"
        )
