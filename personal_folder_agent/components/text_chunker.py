"""TextChunker component for splitting documents into training-ready chunks.

This module implements the TextChunker interface, splitting text into
512-1024 token chunks. By default, all token counting (and therefore chunk
boundary decisions) uses tiktoken's cl100k_base encoding, which is fast and
requires no network access or model download.

Optionally, the real Qwen 2.5-3B tokenizer (via Hugging Face
``transformers``) can be enabled (``use_qwen_tokenizer=True``) to get
authoritative token counts per Requirement 2.4. When enabled, the Qwen
tokenizer is used consistently for both splitting decisions and final counts
(lazy-loaded on first use) so the 512-1024 token bound is guaranteed
regardless of which tokenizer is active.

Requirements addressed:
- 2.3: Split documents larger than 100 KB into chunks of 512-1024 tokens
       using tiktoken with cl100k_base tokenizer, preserving sentence boundaries
- 2.4: Count tokens using Qwen 2.5-3B tokenizer, reject chunks exceeding
       1024 tokens for splitting
"""

import logging
import re
from typing import Any, List, Optional

import tiktoken

from personal_folder_agent.interfaces import TextChunker as TextChunkerBase
from personal_folder_agent.models import TextChunk

logger = logging.getLogger(__name__)


# Sentence boundary pattern: matches '.', '?', or '!' followed by whitespace
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")

# Default Hugging Face model identifier for the Qwen 2.5 tokenizer
DEFAULT_QWEN_MODEL_NAME = "Qwen/Qwen2.5-3B-Instruct"


class TextChunkerImpl(TextChunkerBase):
    """Concrete implementation of TextChunker using tiktoken for token counting.

    Splits documents into chunks of 512-1024 tokens, preserving sentence
    boundaries. By default, both boundary decisions and token counts use the
    fast tiktoken cl100k_base encoding, which closely approximates Qwen
    2.5-3B tokenizer behavior without requiring a model download or network
    access.

    Optionally, the real Qwen 2.5-3B tokenizer (Hugging Face ``transformers``
    ``AutoTokenizer``) can be enabled via ``use_qwen_tokenizer=True`` for
    authoritative token counts per Requirement 2.4. It is lazy-loaded on
    first use so that constructing a chunker never requires network access
    or the ``transformers`` package to be installed unless the Qwen
    tokenizer path is actually exercised.

    Attributes:
        min_chunk_tokens: Minimum tokens per chunk (default 512).
        max_chunk_tokens: Maximum tokens per chunk (default 1024).
        use_qwen_tokenizer: Whether the Qwen tokenizer is used for counting
            and chunk boundary decisions.
    """

    def __init__(
        self,
        max_chunk_size: int = 1024,
        min_chunk_size: int = 512,
        use_qwen_tokenizer: bool = False,
        qwen_model_name: str = DEFAULT_QWEN_MODEL_NAME,
    ) -> None:
        """Initialize TextChunker with tiktoken cl100k_base encoding.

        Args:
            max_chunk_size: Maximum tokens per chunk. Must be >= 1.
                            Defaults to 1024.
            min_chunk_size: Minimum tokens per chunk. Must be >= 1
                           and <= max_chunk_size. Defaults to 512.
            use_qwen_tokenizer: If True, the Qwen 2.5-3B tokenizer is used
                (lazily, on first call that needs it) to compute the
                authoritative token count for finished chunks, per
                Requirement 2.4. Chunk *boundaries* are still decided using
                tiktoken for speed. Defaults to False so that constructing
                a chunker never triggers a network call or requires
                ``transformers`` to be installed.
            qwen_model_name: Hugging Face model identifier for the Qwen
                tokenizer. Defaults to "Qwen/Qwen2.5-3B-Instruct".

        Raises:
            ValueError: If chunk size parameters are invalid.
        """
        if max_chunk_size < 1:
            raise ValueError(f"max_chunk_size must be >= 1, got {max_chunk_size}")
        if min_chunk_size < 1:
            raise ValueError(f"min_chunk_size must be >= 1, got {min_chunk_size}")
        if min_chunk_size > max_chunk_size:
            raise ValueError(
                f"min_chunk_size ({min_chunk_size}) must be <= max_chunk_size ({max_chunk_size})"
            )

        self.min_chunk_tokens = min_chunk_size
        self.max_chunk_tokens = max_chunk_size
        self._encoding = tiktoken.get_encoding("cl100k_base")

        self.use_qwen_tokenizer = use_qwen_tokenizer
        self.qwen_model_name = qwen_model_name
        self._qwen_tokenizer: Optional[Any] = None

    def _get_qwen_tokenizer(self) -> Any:
        """Lazily load and cache the Qwen 2.5 tokenizer via transformers.

        The tokenizer is only downloaded/instantiated the first time it is
        actually needed, so simply enabling ``use_qwen_tokenizer`` at
        construction time has no cost until a counting call occurs.

        Returns:
            A Hugging Face ``PreTrainedTokenizerBase`` instance for
            ``self.qwen_model_name``.

        Raises:
            ImportError: If the ``transformers`` package is not installed.
            OSError: If the tokenizer cannot be fetched (e.g. no network
                access, invalid model name, or Hugging Face Hub is
                unreachable).
        """
        if self._qwen_tokenizer is None:
            try:
                from transformers import AutoTokenizer
            except ImportError as exc:
                raise ImportError(
                    "The 'transformers' package is required to use the Qwen "
                    "2.5 tokenizer. Install it with: pip install transformers"
                ) from exc

            logger.info("Loading Qwen tokenizer '%s' (first use)...", self.qwen_model_name)
            self._qwen_tokenizer = AutoTokenizer.from_pretrained(self.qwen_model_name)

        return self._qwen_tokenizer

    def count_tokens(self, text: str, use_qwen: Optional[bool] = None) -> int:
        """Count the number of tokens in a text string.

        By default, uses the fast tiktoken cl100k_base encoding, which
        requires no network access and closely approximates Qwen tokenizer
        behavior. Set ``use_qwen=True`` (or construct the chunker with
        ``use_qwen_tokenizer=True``) to get the authoritative count from the
        real Qwen 2.5-3B tokenizer instead (Requirement 2.4). The Qwen
        tokenizer is lazy-loaded on first use.

        Args:
            text: The text to count tokens for.
            use_qwen: Override this call to use (True) or skip (False) the
                Qwen tokenizer, regardless of the instance default. If not
                given, falls back to ``self.use_qwen_tokenizer``.

        Returns:
            Number of tokens in the text.
        """
        if not text:
            return 0

        should_use_qwen = self.use_qwen_tokenizer if use_qwen is None else use_qwen
        if should_use_qwen:
            tokenizer = self._get_qwen_tokenizer()
            return len(tokenizer.encode(text))

        return len(self._encoding.encode(text))

    def _encode(self, text: str) -> List[int]:
        """Encode text into token ids using the currently active tokenizer.

        Uses the Qwen tokenizer when ``use_qwen_tokenizer`` is enabled,
        otherwise uses tiktoken cl100k_base. Kept consistent with
        :meth:`_decode` and :meth:`count_tokens` so that a single tokenizer
        is used for both splitting decisions and final counts within one
        chunking pass, which guarantees the 512-1024 token bound holds
        regardless of which tokenizer is active.

        Args:
            text: Text to encode.

        Returns:
            List of token ids.
        """
        if self.use_qwen_tokenizer:
            return self._get_qwen_tokenizer().encode(text)
        return self._encoding.encode(text)

    def _decode(self, token_ids: List[int]) -> str:
        """Decode token ids back into text using the currently active tokenizer.

        Args:
            token_ids: List of token ids to decode.

        Returns:
            Decoded text string.
        """
        if self.use_qwen_tokenizer:
            return self._get_qwen_tokenizer().decode(token_ids)
        return self._encoding.decode(token_ids)

    def chunk_document(self, text: str, source_file: str) -> List[TextChunk]:
        """Split a document's text into 512-1024 token chunks.

        Uses sentence-aware splitting: tries to break at sentence boundaries
        ('. ', '? ', '! ') while keeping chunks within the configured token
        range. If a single sentence exceeds max_chunk_tokens, it is force-split
        at the token boundary.

        For documents whose total token count fits within max_chunk_tokens,
        a single chunk is returned without splitting.

        Args:
            text: The full text content to chunk.
            source_file: Path to the source file for reference tracking.

        Returns:
            List of TextChunk objects with source references and token counts.
        """
        if not text or not text.strip():
            return []

        total_tokens = self.count_tokens(text)

        # If the entire text fits within max tokens, return as single chunk
        if total_tokens <= self.max_chunk_tokens:
            return [
                TextChunk(
                    text=text,
                    source_file=source_file,
                    chunk_index=0,
                    byte_offset=0,
                    token_count=total_tokens,
                    chunk_id=f"{source_file}:0",
                    metadata={},
                )
            ]

        # Split text into sentences for sentence-aware chunking
        sentences = self._split_into_sentences(text)
        chunks: List[TextChunk] = []
        current_sentences: List[str] = []
        current_token_count = 0
        byte_offset = 0

        for sentence in sentences:
            sentence_tokens = self.count_tokens(sentence)

            # Handle sentences that exceed max_chunk_tokens on their own
            if sentence_tokens > self.max_chunk_tokens:
                # First, flush any accumulated sentences as a chunk
                if current_sentences:
                    chunk_text = "".join(current_sentences)
                    chunks.append(
                        self._create_chunk(
                            chunk_text, source_file, len(chunks), byte_offset
                        )
                    )
                    byte_offset += len(chunk_text.encode("utf-8"))
                    current_sentences = []
                    current_token_count = 0

                # Force-split the oversized sentence
                force_chunks = self._force_split(sentence, source_file, len(chunks), byte_offset)
                for fc in force_chunks:
                    chunks.append(fc)
                    byte_offset += len(fc.text.encode("utf-8"))
                continue

            # Check if adding this sentence would exceed max tokens
            if current_token_count + sentence_tokens > self.max_chunk_tokens:
                # Emit current chunk
                if current_sentences:
                    chunk_text = "".join(current_sentences)
                    chunks.append(
                        self._create_chunk(
                            chunk_text, source_file, len(chunks), byte_offset
                        )
                    )
                    byte_offset += len(chunk_text.encode("utf-8"))
                    current_sentences = []
                    current_token_count = 0

            current_sentences.append(sentence)
            current_token_count += sentence_tokens

        # Flush remaining sentences
        if current_sentences:
            chunk_text = "".join(current_sentences)
            chunk_token_count = self.count_tokens(chunk_text)

            # If the remaining chunk exceeds max, force split it
            if chunk_token_count > self.max_chunk_tokens:
                force_chunks = self._force_split(
                    chunk_text, source_file, len(chunks), byte_offset
                )
                chunks.extend(force_chunks)
            else:
                chunks.append(
                    self._create_chunk(
                        chunk_text, source_file, len(chunks), byte_offset
                    )
                )

        return chunks

    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences at boundary markers.

        Preserves the trailing whitespace with each sentence so that
        joining them reconstructs the original text.

        Args:
            text: Text to split into sentences.

        Returns:
            List of sentence strings (including trailing whitespace).
        """
        # Split at sentence boundaries but keep delimiters
        parts = _SENTENCE_BOUNDARY_RE.split(text)
        if not parts:
            return [text]

        # Re-attach trailing whitespace by finding boundaries in original text
        sentences: List[str] = []
        remaining = text
        for part in parts:
            if not part:
                continue
            # Find where this part ends in the remaining text
            idx = remaining.find(part)
            if idx == -1:
                # Fallback: append as-is
                sentences.append(part)
                continue

            end_of_part = idx + len(part)
            # Include any whitespace that follows (up to next non-whitespace)
            while end_of_part < len(remaining) and remaining[end_of_part] in (" ", "\t", "\n", "\r"):
                end_of_part += 1

            sentences.append(remaining[:end_of_part])
            remaining = remaining[end_of_part:]

        if remaining:
            sentences.append(remaining)

        return sentences

    def _force_split(
        self, text: str, source_file: str, start_index: int, byte_offset: int
    ) -> List[TextChunk]:
        """Force-split text that exceeds max_chunk_tokens at token boundaries.

        This handles the case where a single sentence or text block is
        larger than the maximum allowed chunk size.

        Args:
            text: The oversized text to split.
            source_file: Source file path for chunk IDs.
            start_index: Starting chunk index for numbering.
            byte_offset: Starting byte offset in the source file.

        Returns:
            List of TextChunk objects, each within max_chunk_tokens.
        """
        tokens = self._encode(text)
        chunks: List[TextChunk] = []
        offset = byte_offset
        idx = start_index

        pos = 0
        while pos < len(tokens):
            end = min(pos + self.max_chunk_tokens, len(tokens))
            chunk_tokens = tokens[pos:end]
            chunk_text = self._decode(chunk_tokens)
            token_count = len(chunk_tokens)

            chunks.append(
                TextChunk(
                    text=chunk_text,
                    source_file=source_file,
                    chunk_index=idx,
                    byte_offset=offset,
                    token_count=token_count,
                    chunk_id=f"{source_file}:{idx}",
                    metadata={"force_split": True},
                )
            )

            offset += len(chunk_text.encode("utf-8"))
            idx += 1
            pos = end

        return chunks

    def _create_chunk(
        self, text: str, source_file: str, chunk_index: int, byte_offset: int
    ) -> TextChunk:
        """Create a TextChunk with computed token count.

        Args:
            text: Chunk text content.
            source_file: Source file path.
            chunk_index: Index of this chunk.
            byte_offset: Byte offset in source file.

        Returns:
            A fully populated TextChunk instance.
        """
        token_count = self.count_tokens(text)
        return TextChunk(
            text=text,
            source_file=source_file,
            chunk_index=chunk_index,
            byte_offset=byte_offset,
            token_count=token_count,
            chunk_id=f"{source_file}:{chunk_index}",
            metadata={},
        )
