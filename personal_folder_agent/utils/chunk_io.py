"""JSONL serialization for :class:`~personal_folder_agent.models.TextChunk`.

The crawl/extract/chunk stages run on the user's own machine, where the
files live; training runs on a GPU somewhere else (a Colab Pro+ session,
typically). The chunk list is the hand-off between them, and JSON Lines is
the right shape for it: one chunk per line, appendable, streamable, and
diffable, and a file truncated by an interrupted run is detectable at the
line it was cut off on -- :func:`load_chunks_jsonl` reports that line
number and refuses the file rather than returning a silently short
dataset.

The same format backs the pipeline's resume state, so a chunk set exported
for upload and a chunk set recovered from a checkpoint directory are the
same bytes.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Iterable, List, Union

from personal_folder_agent.models import TextChunk

PathLike = Union[str, Path]


def save_chunks_jsonl(chunks: Iterable[TextChunk], path: PathLike) -> int:
    """Write chunks to a JSON Lines file, creating parent directories.

    Args:
        chunks: Chunks to write, in order.
        path: Destination ``.jsonl`` path.

    Returns:
        The number of chunks written.
    """
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with destination.open("w", encoding="utf-8") as handle:
        for chunk in chunks:
            handle.write(json.dumps(asdict(chunk), ensure_ascii=False) + "\n")
            count += 1
    return count


def load_chunks_jsonl(path: PathLike) -> List[TextChunk]:
    """Read chunks back from a JSON Lines file.

    Blank lines are skipped, but a *partial* record is not: a file
    truncated mid-write by a killed Colab session raises rather than
    silently loading the records before the tear-off point. Training on a
    quietly shortened dataset -- and reporting the resulting statistics as
    if they described the whole corpus -- is worse than a loud failure the
    user can fix by re-exporting.

    Args:
        path: Source ``.jsonl`` path.

    Returns:
        The chunks, in file order.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If a line is not a JSON object with the TextChunk
            fields -- a truncated final line, or a file that is not a
            chunk export at all.
    """
    source = Path(path)
    if not source.exists():
        raise FileNotFoundError(f"Chunk file not found: {source}")

    chunks: List[TextChunk] = []
    with source.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                chunks.append(TextChunk(**json.loads(line)))
            except (json.JSONDecodeError, TypeError) as exc:
                raise ValueError(
                    f"{source}:{line_number} is not a valid TextChunk record "
                    f"({type(exc).__name__}: {exc}). Re-export the chunk set from "
                    "the chunking stage."
                ) from exc
    return chunks
