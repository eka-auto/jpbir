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

Three chunking strategies are supported (Requirement 7.3), selectable via
the ``strategy`` constructor argument or the ``chunk_document`` override:

- ``SENTENCE_AWARE`` (default): splits at sentence boundaries, preserving
  context.
- ``PARAGRAPH_AWARE``: splits at paragraph boundaries, preserving paragraph
  structure.
- ``FIXED_SIZE``: fixed-size token chunks with overlap between consecutive
  chunks.

Requirements addressed:
- 2.3: Split documents larger than 100 KB into chunks of 512-1024 tokens
       using tiktoken with cl100k_base tokenizer, preserving sentence boundaries
- 2.4: Count tokens using Qwen 2.5-3B tokenizer, reject chunks exceeding
       1024 tokens for splitting
- 7.3: Chunking strategy selection (fixed_size, sentence_aware,
       paragraph_aware)
"""

import logging
import math
import re
from typing import Any, List, Optional, Union

import tiktoken

from personal_folder_agent.interfaces import TextChunker as TextChunkerBase
from personal_folder_agent.models import ChunkingStrategy, TextChunk

logger = logging.getLogger(__name__)


# Sentence boundary pattern: matches '.', '?', or '!' followed by whitespace
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")

# Paragraph boundary pattern: one or more blank lines between paragraphs
_PARAGRAPH_BOUNDARY_RE = re.compile(r"\n\s*\n")

# Default Hugging Face model identifier for the Qwen 2.5 tokenizer
DEFAULT_QWEN_MODEL_NAME = "Qwen/Qwen2.5-3B-Instruct"

# Documents at or below this size (in bytes) are not chunked when they fit
# within max_chunk_tokens (Requirement 2.3: only documents larger than
# 100 KB are split). Any document larger than this is always chunked.
MIN_CHUNK_DOCUMENT_BYTES = 100 * 1024


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
        strategy: Union[str, ChunkingStrategy] = ChunkingStrategy.SENTENCE_AWARE,
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
            strategy: Chunking strategy to use by default. One of
                'fixed_size', 'sentence_aware', 'paragraph_aware' (or the
                corresponding ChunkingStrategy enum member). Defaults to
                sentence_aware (Requirement 7.3).

        Raises:
            ValueError: If chunk size parameters are invalid or the
                strategy is not a recognized chunking strategy.
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

        self.strategy = self._normalize_strategy(strategy)

    @staticmethod
    def _normalize_strategy(strategy: Union[str, ChunkingStrategy]) -> ChunkingStrategy:
        """Normalize a strategy value to a ChunkingStrategy enum member.

        Accepts either a ChunkingStrategy member or a string matching one of
        the enum values ('fixed_size', 'sentence_aware', 'paragraph_aware').

        Args:
            strategy: The strategy value to normalize.

        Returns:
            The corresponding ChunkingStrategy member.

        Raises:
            ValueError: If the strategy is not a recognized chunking strategy.
        """
        if isinstance(strategy, ChunkingStrategy):
            return strategy
        if isinstance(strategy, str):
            try:
                return ChunkingStrategy(strategy)
            except ValueError:
                pass
        valid = ", ".join(f"'{s.value}'" for s in ChunkingStrategy)
        raise ValueError(
            f"Unknown chunking strategy '{strategy}'. Valid strategies: {valid}"
        )

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

    def should_chunk(self, text: str) -> bool:
        """Return True if a document is large enough to require chunking.

        Per Requirement 2.3, only documents larger than 100 KB are split
        into chunks. Documents at or below 100 KB are kept whole (returned
        as a single chunk) when they fit within max_chunk_tokens.

        Args:
            text: The document text to evaluate.

        Returns:
            True if the document exceeds 100 KB, False otherwise.
        """
        return len(text.encode("utf-8")) > MIN_CHUNK_DOCUMENT_BYTES

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

    def chunk_document(
        self,
        text: str,
        source_file: str,
        strategy: Optional[Union[str, ChunkingStrategy]] = None,
    ) -> List[TextChunk]:
        """Split a document's text into 512-1024 token chunks.

        Dispatches to the configured chunking strategy (Requirement 7.3):
        sentence-aware (default), paragraph-aware, or fixed-size with
        overlap. Documents larger than 100 KB are always chunked; smaller
        documents are returned as a single chunk when they fit within
        max_chunk_tokens (Requirement 2.3).

        Args:
            text: The full text content to chunk.
            source_file: Path to the source file for reference tracking.
            strategy: Optional per-call strategy override. If not given,
                the instance's configured strategy is used.

        Returns:
            List of TextChunk objects with source references and token counts.
        """
        if not text or not text.strip():
            return []

        active_strategy = (
            self.strategy if strategy is None else self._normalize_strategy(strategy)
        )

        if active_strategy == ChunkingStrategy.PARAGRAPH_AWARE:
            return self._chunk_paragraph_aware(text, source_file)
        if active_strategy == ChunkingStrategy.FIXED_SIZE:
            return self._chunk_fixed_size(text, source_file)
        return self._chunk_sentence_aware(text, source_file)

    def _chunk_sentence_aware(self, text: str, source_file: str) -> List[TextChunk]:
        """Split text into chunks at sentence boundaries (Requirement 2.3).

        Tries to break at sentence boundaries ('. ', '? ', '! ') while
        keeping chunks within the configured token range. If a single
        sentence exceeds max_chunk_tokens, it is force-split at the token
        boundary.

        For documents whose total token count fits within max_chunk_tokens,
        a single chunk is returned without splitting.

        Args:
            text: The full text content to chunk.
            source_file: Path to the source file for reference tracking.

        Returns:
            List of TextChunk objects with source references and token counts.
        """
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

        # Greedy pack sentences into groups, each within max_chunk_tokens.
        # Each group is (parts, is_force_split) where is_force_split marks
        # groups produced by token-boundary force-splitting.
        groups: List[tuple] = []
        current_sentences: List[str] = []
        current_token_count = 0

        for sentence in sentences:
            sentence_tokens = self.count_tokens(sentence)

            # Handle sentences that exceed max_chunk_tokens on their own
            if sentence_tokens > self.max_chunk_tokens:
                if current_sentences:
                    groups.append((current_sentences, False))
                    current_sentences = []
                    current_token_count = 0
                # Force-split the oversized sentence into its own group(s)
                force_chunks = self._force_split(sentence, source_file, 0, 0)
                for fc in force_chunks:
                    groups.append(([fc.text], True))
                continue

            if current_token_count + sentence_tokens > self.max_chunk_tokens:
                if current_sentences:
                    groups.append((current_sentences, False))
                    current_sentences = []
                    current_token_count = 0

            current_sentences.append(sentence)
            current_token_count += sentence_tokens

        if current_sentences:
            groups.append((current_sentences, False))

        # Balance the tail: ensure every group is within [min, max] tokens
        groups = self._balance_groups(groups)

        return self._groups_to_chunks(groups, source_file)

    def _balance_groups(self, groups: List[tuple]) -> List[tuple]:
        """Rebalance sentence/paragraph groups so each is within [min, max] tokens.

        Greedy packing can leave a group below min_chunk_tokens in two
        situations: the final tail group, and a group flushed immediately
        before an oversized sentence/paragraph is force-split. This
        repeatedly merges any group below min with its successor (or, for
        the final group, its predecessor) and re-splits the combined parts
        at a boundary that keeps both sides within the configured token
        range (possible because min <= max/2 in the default 512-1024
        configuration). Per Design Property 2, every chunk of a document
        larger than 100 KB must be within [min, max], including the final
        chunk.

        Args:
            groups: List of (parts, is_force_split) groups, each within
                max_chunk_tokens.

        Returns:
            Rebalanced groups, each within [min_chunk_tokens,
            max_chunk_tokens] where possible.
        """
        if self.min_chunk_tokens <= 1:
            return groups

        result = list(groups)
        changed = True
        while changed:
            changed = False
            rebuilt: List[tuple] = []
            i = 0
            n = len(result)
            while i < n:
                group, forced = result[i]
                group_tokens = self.count_tokens("".join(group))

                # Keep groups at/above min as-is.
                if group_tokens >= self.min_chunk_tokens:
                    rebuilt.append((group, forced))
                    i += 1
                    continue

                if i + 1 < n:
                    # Merge with the successor and re-split.
                    next_group, next_forced = result[i + 1]
                    combined = group + next_group
                    combined_tokens = self.count_tokens("".join(combined))

                    if combined_tokens <= self.max_chunk_tokens:
                        rebuilt.append((combined, forced or next_forced))
                        i += 2
                        changed = True
                        continue

                    left, right, token_split = self._split_combined(
                        combined, combined_tokens
                    )
                    if left is not None:
                        rebuilt.append((left, forced or token_split))
                        rebuilt.append((right, next_forced or token_split))
                        i += 2
                        changed = True
                        continue

                    # Cannot split cleanly; keep as-is.
                    rebuilt.append((group, forced))
                    i += 1
                    continue

                # Final group below min: merge with the predecessor in the
                # rebuilt list and re-split so the final chunk also respects
                # the minimum (Design Property 2).
                if rebuilt:
                    prev_group, prev_forced = rebuilt[-1]
                    combined = prev_group + group
                    combined_tokens = self.count_tokens("".join(combined))

                    if combined_tokens <= self.max_chunk_tokens:
                        rebuilt[-1] = (combined, prev_forced or forced)
                        i += 1
                        changed = True
                        continue

                    left, right, token_split = self._split_combined(
                        combined, combined_tokens
                    )
                    if left is not None:
                        rebuilt[-1] = (left, prev_forced or token_split)
                        rebuilt.append((right, forced or token_split))
                        i += 1
                        changed = True
                        continue

                # Cannot balance; keep as-is.
                rebuilt.append((group, forced))
                i += 1

            result = rebuilt

        return result

    def _split_combined(
        self, combined: List[str], combined_tokens: int
    ) -> tuple:
        """Split a combined part list keeping both sides within [min, max].

        Prefers a part-boundary split (preserving sentence/paragraph
        boundaries). When no part boundary yields two sides each >=
        min_chunk_tokens (e.g. one part is an oversized force-split block),
        falls back to a token-boundary split of the combined text, which
        always reconstructs the original text because decode is additive.

        Args:
            combined: List of text parts to split.
            combined_tokens: Total token count of the combined parts.

        Returns:
            A ``(left, right, token_boundary_split)`` tuple where ``left``
            and ``right`` are part lists with both sides within
            [min_chunk_tokens, max_chunk_tokens] and
            ``token_boundary_split`` is True when the split broke a
            sentence/paragraph boundary. Returns ``(None, None, False)`` if
            no such split exists (only possible when min > max/2).
        """
        # Token counts are measured on the joined text, never summed per
        # part: tokenization is not additive (a part boundary can merge into
        # a single token, so sum(count(part)) overstates count("".join)).
        # Summing here previously returned a left side below min, which made
        # _balance_groups merge and re-split the same pair forever.
        #
        # count("".join(combined[:idx+1])) is non-decreasing in idx and the
        # right side is non-increasing, so the first boundary that satisfies
        # the left bound is the only candidate worth testing: if its right
        # side is already too small, every later boundary is worse.
        for idx in range(len(combined) - 1):
            left_tokens = self.count_tokens("".join(combined[: idx + 1]))
            if left_tokens < self.min_chunk_tokens:
                continue
            right_tokens = self.count_tokens("".join(combined[idx + 1 :]))
            if right_tokens >= self.min_chunk_tokens:
                return combined[: idx + 1], combined[idx + 1 :], False
            break

        # No part boundary works (e.g. a single oversized force-split part).
        # Split the combined text at a token boundary so both sides are
        # within [min, max]. This is possible because combined_tokens is in
        # (max, 2*max] and min <= max/2 in the default configuration.
        if combined_tokens < 2 * self.min_chunk_tokens:
            return None, None, False

        text = "".join(combined)
        tokens = self._encode(text)
        split = combined_tokens // 2
        split = max(split, self.min_chunk_tokens)
        split = min(split, combined_tokens - self.min_chunk_tokens)
        left_text = self._decode(tokens[:split])
        right_text = self._decode(tokens[split:])
        return [left_text], [right_text], True

    def _groups_to_chunks(self, groups: List[tuple], source_file: str) -> List[TextChunk]:
        """Convert sentence/paragraph groups into TextChunk objects.

        Args:
            groups: List of (parts, is_force_split) groups.
            source_file: Path to the source file for reference tracking.

        Returns:
            List of TextChunk objects with sequential indices and byte offsets.
        """
        chunks: List[TextChunk] = []
        byte_offset = 0
        for group, is_force_split in groups:
            chunk_text = "".join(group)
            chunks.append(
                self._create_chunk(
                    chunk_text,
                    source_file,
                    len(chunks),
                    byte_offset,
                    force_split=is_force_split,
                )
            )
            byte_offset += len(chunk_text.encode("utf-8"))
        return chunks

    def _chunk_paragraph_aware(self, text: str, source_file: str) -> List[TextChunk]:
        """Split text into chunks at paragraph boundaries (Requirement 7.3).

        Preserves paragraph structure: chunks are built from whole
        paragraphs (split on blank lines) and never break a paragraph
        unless the paragraph alone exceeds max_chunk_tokens, in which case
        it is force-split at token boundaries.

        Args:
            text: The full text content to chunk.
            source_file: Path to the source file for reference tracking.

        Returns:
            List of TextChunk objects with source references and token counts.
        """
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

        paragraphs = self._split_into_paragraphs(text)

        # Greedy pack paragraphs into groups, each within max_chunk_tokens
        groups: List[tuple] = []
        current_paragraphs: List[str] = []
        current_token_count = 0

        for paragraph in paragraphs:
            paragraph_tokens = self.count_tokens(paragraph)

            # Handle paragraphs that exceed max_chunk_tokens on their own
            if paragraph_tokens > self.max_chunk_tokens:
                if current_paragraphs:
                    groups.append((current_paragraphs, False))
                    current_paragraphs = []
                    current_token_count = 0
                # Force-split the oversized paragraph into its own group(s)
                force_chunks = self._force_split(paragraph, source_file, 0, 0)
                for fc in force_chunks:
                    groups.append(([fc.text], True))
                continue

            if current_token_count + paragraph_tokens > self.max_chunk_tokens:
                if current_paragraphs:
                    groups.append((current_paragraphs, False))
                    current_paragraphs = []
                    current_token_count = 0

            current_paragraphs.append(paragraph)
            current_token_count += paragraph_tokens

        if current_paragraphs:
            groups.append((current_paragraphs, False))

        # Balance the tail: ensure every group is within [min, max] tokens
        groups = self._balance_groups(groups)

        return self._groups_to_chunks(groups, source_file)

    def _chunk_fixed_size(self, text: str, source_file: str) -> List[TextChunk]:
        """Split text into fixed-size token chunks with overlap (Requirement 7.3).

        Produces chunks of approximately ``target_tokens`` tokens (the
        midpoint of the configured min/max range, clamped to
        max_chunk_tokens), with each consecutive chunk overlapping the
        previous one by ``overlap_tokens`` tokens to preserve context
        across boundaries.

        Args:
            text: The full text content to chunk.
            source_file: Path to the source file for reference tracking.

        Returns:
            List of TextChunk objects with source references and token counts.
        """
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

        # Target chunk size: midpoint of the configured range, clamped to
        # max_chunk_tokens. Overlap: 10% of the target size.
        target_tokens = min(
            max((self.min_chunk_tokens + self.max_chunk_tokens) // 2, 1),
            self.max_chunk_tokens,
        )
        overlap_tokens = max(target_tokens // 10, 1)

        tokens = self._encode(text)
        total = len(tokens)

        # Choose the number of slices n so that every slice (including the
        # final one) is within [min, max] (Design Property 2). With n slices
        # of size s and n-1 overlaps of o: n*s - (n-1)*o = total, so
        # s = (total + (n-1)*o) / n. s decreases as n grows, so pick the
        # smallest n with s <= max; for min <= max/2 (the default
        # configuration) this also guarantees s >= min.
        if self.max_chunk_tokens - overlap_tokens <= 0:
            # Degenerate configuration: overlap would swallow the whole
            # chunk. Fall back to non-overlapping max-sized slices.
            n = max(1, math.ceil(total / self.max_chunk_tokens))
            overlap_tokens = 0
        else:
            n = max(
                1,
                math.ceil(
                    (total - overlap_tokens)
                    / (self.max_chunk_tokens - overlap_tokens)
                ),
            )
        s = (total + (n - 1) * overlap_tokens) / n

        # Distribute the total slice tokens (total + (n-1)*o) across n
        # slices as evenly as possible.
        slice_total = total + (n - 1) * overlap_tokens
        base = slice_total // n
        remainder = slice_total % n

        slices: List[tuple] = []
        pos = 0
        for i in range(n):
            size = base + (1 if i < remainder else 0)
            end = min(pos + size, total)
            slices.append((pos, end))
            if end >= total:
                break
            pos = end - overlap_tokens

        chunks: List[TextChunk] = []
        byte_offset = 0
        for start, end in slices:
            chunk_tokens = tokens[start:end]
            chunk_text = self._decode(chunk_tokens)
            token_count = len(chunk_tokens)

            chunks.append(
                TextChunk(
                    text=chunk_text,
                    source_file=source_file,
                    chunk_index=len(chunks),
                    byte_offset=byte_offset,
                    token_count=token_count,
                    chunk_id=f"{source_file}:{len(chunks)}",
                    metadata={"strategy": "fixed_size", "overlap_tokens": overlap_tokens},
                )
            )

            byte_offset += len(chunk_text.encode("utf-8"))

        return chunks

    def _split_into_paragraphs(self, text: str) -> List[str]:
        """Split text into paragraphs at blank-line boundaries.

        Preserves the paragraph separators with each paragraph so that
        joining them reconstructs the original text.

        Args:
            text: Text to split into paragraphs.

        Returns:
            List of paragraph strings (including trailing separators).
        """
        parts = _PARAGRAPH_BOUNDARY_RE.split(text)
        if not parts:
            return [text]

        paragraphs: List[str] = []
        remaining = text
        for part in parts:
            if not part:
                continue
            idx = remaining.find(part)
            if idx == -1:
                # Fallback: append as-is
                paragraphs.append(part)
                continue

            end_of_part = idx + len(part)
            # Include the blank-line separator that follows this paragraph
            while end_of_part < len(remaining) and remaining[end_of_part] in ("\n", "\r"):
                end_of_part += 1

            paragraphs.append(remaining[:end_of_part])
            remaining = remaining[end_of_part:]

        if remaining:
            paragraphs.append(remaining)

        return paragraphs

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
        self,
        text: str,
        source_file: str,
        chunk_index: int,
        byte_offset: int,
        force_split: bool = False,
    ) -> TextChunk:
        """Create a TextChunk with computed token count.

        Args:
            text: Chunk text content.
            source_file: Source file path.
            chunk_index: Index of this chunk.
            byte_offset: Byte offset in source file.
            force_split: Whether this chunk was produced by token-boundary
                force-splitting (marks the chunk metadata accordingly).

        Returns:
            A fully populated TextChunk instance.
        """
        token_count = self.count_tokens(text)
        metadata = {"force_split": True} if force_split else {}
        return TextChunk(
            text=text,
            source_file=source_file,
            chunk_index=chunk_index,
            byte_offset=byte_offset,
            token_count=token_count,
            chunk_id=f"{source_file}:{chunk_index}",
            metadata=metadata,
        )
