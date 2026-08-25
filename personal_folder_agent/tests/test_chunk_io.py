"""Unit tests for JSONL chunk serialization.

The chunk file is the hand-off between the local crawl/chunk stages and a
GPU session elsewhere, and it is also the pipeline's resume state -- so a
round trip has to be exact, and a file truncated by a killed session has
to fail loudly rather than silently train on a partial dataset.
"""

import json

import pytest

from personal_folder_agent.models import TextChunk
from personal_folder_agent.utils.chunk_io import load_chunks_jsonl, save_chunks_jsonl


def make_chunk(index, source="C:/docs/notes.md", text=None):
    return TextChunk(
        text=text if text is not None else f"chunk body {index}",
        source_file=source,
        chunk_index=index,
        byte_offset=index * 512,
        token_count=600 + index,
        chunk_id=f"{source}:{index}",
        metadata={"strategy": "sentence_aware"},
    )


class TestRoundTrip:
    def test_preserves_every_field(self, tmp_path):
        chunks = [make_chunk(index) for index in range(5)]
        path = tmp_path / "chunks.jsonl"

        assert save_chunks_jsonl(chunks, path) == 5
        assert load_chunks_jsonl(path) == chunks

    def test_preserves_order(self, tmp_path):
        chunks = [make_chunk(index) for index in (3, 1, 2)]
        path = tmp_path / "chunks.jsonl"
        save_chunks_jsonl(chunks, path)

        assert [c.chunk_index for c in load_chunks_jsonl(path)] == [3, 1, 2]

    def test_preserves_non_ascii_text(self, tmp_path):
        """Personal folders contain non-English documents; escaping them
        would still round-trip, but writing them raw keeps the file
        readable when a user inspects it before uploading."""
        chunk = make_chunk(0, text="प्रोजेक्ट नोट्स — café résumé 日本語")
        path = tmp_path / "chunks.jsonl"
        save_chunks_jsonl([chunk], path)

        assert "café" in path.read_text(encoding="utf-8")
        assert load_chunks_jsonl(path)[0].text == chunk.text

    def test_writes_one_json_object_per_line(self, tmp_path):
        path = tmp_path / "chunks.jsonl"
        save_chunks_jsonl([make_chunk(index) for index in range(3)], path)

        lines = path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 3
        assert json.loads(lines[0])["chunk_id"] == "C:/docs/notes.md:0"

    def test_creates_missing_parent_directories(self, tmp_path):
        path = tmp_path / "nested" / "deeper" / "chunks.jsonl"

        save_chunks_jsonl([make_chunk(0)], path)

        assert path.exists()

    def test_empty_chunk_list_round_trips(self, tmp_path):
        path = tmp_path / "chunks.jsonl"

        assert save_chunks_jsonl([], path) == 0
        assert load_chunks_jsonl(path) == []

    def test_overwrites_rather_than_appending(self, tmp_path):
        path = tmp_path / "chunks.jsonl"
        save_chunks_jsonl([make_chunk(index) for index in range(5)], path)

        save_chunks_jsonl([make_chunk(0)], path)

        assert len(load_chunks_jsonl(path)) == 1


class TestLoadErrors:
    def test_missing_file_is_reported(self, tmp_path):
        with pytest.raises(FileNotFoundError, match="Chunk file not found"):
            load_chunks_jsonl(tmp_path / "absent.jsonl")

    def test_blank_lines_are_skipped(self, tmp_path):
        path = tmp_path / "chunks.jsonl"
        save_chunks_jsonl([make_chunk(0), make_chunk(1)], path)
        path.write_text(path.read_text(encoding="utf-8") + "\n\n", encoding="utf-8")

        assert len(load_chunks_jsonl(path)) == 2

    def test_a_truncated_final_line_fails_loudly(self, tmp_path):
        """A session killed mid-write must not silently drop a chunk."""
        path = tmp_path / "chunks.jsonl"
        save_chunks_jsonl([make_chunk(0)], path)
        path.write_text(path.read_text(encoding="utf-8") + '{"text": "half', encoding="utf-8")

        with pytest.raises(ValueError, match="not a valid TextChunk record"):
            load_chunks_jsonl(path)

    def test_a_json_object_with_the_wrong_fields_is_rejected(self, tmp_path):
        path = tmp_path / "chunks.jsonl"
        path.write_text('{"unexpected": "shape"}\n', encoding="utf-8")

        with pytest.raises(ValueError, match="not a valid TextChunk record"):
            load_chunks_jsonl(path)

    def test_the_error_names_the_offending_line(self, tmp_path):
        path = tmp_path / "chunks.jsonl"
        save_chunks_jsonl([make_chunk(0), make_chunk(1)], path)
        path.write_text(path.read_text(encoding="utf-8") + "not json\n", encoding="utf-8")

        with pytest.raises(ValueError, match=r"chunks\.jsonl:3"):
            load_chunks_jsonl(path)
