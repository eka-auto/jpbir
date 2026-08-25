"""Temporary verification script for task 4.3 (fallback handling for unsupported formats).

Not part of the permanent test suite - delete after use.
"""
import logging
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from personal_folder_agent.components.text_processor import ConcreteTextProcessor
from personal_folder_agent.models import FileMetadata, FileStatus
from datetime import datetime

# --- Capture log records ---
records = []


class CollectingHandler(logging.Handler):
    def emit(self, record):
        records.append((record.levelname, record.getMessage()))


logger = logging.getLogger("personal_folder_agent.components.text_processor")
logger.setLevel(logging.DEBUG)
logger.addHandler(CollectingHandler())


def make_metadata(path, extension):
    return FileMetadata(
        path=path,
        size_bytes=0,
        extension=extension,
        last_modified=datetime.now(),
        sha256_hash="deadbeef",
        permissions="rw-r--r--",
        processing_status=FileStatus.PENDING,
    )


processor = ConcreteTextProcessor()

with tempfile.TemporaryDirectory() as tmpdir:
    print("=" * 70)
    print("TEST 1: Unknown extension '.xyz' with plain ASCII text content")
    print("=" * 70)
    records.clear()
    p1 = os.path.join(tmpdir, "notes.xyz")
    with open(p1, "w", encoding="utf-8") as f:
        f.write("Hello, this is plain text stored under an unknown extension.")
    result1 = processor.extract_text(p1, make_metadata(p1, ".xyz"))
    print("error_message:", result1.error_message)
    print("extraction_method:", result1.extraction_method)
    print("extracted_text:", repr(result1.extracted_text))
    print("log records:", records)
    assert result1.error_message is None, "Expected success for readable unknown-extension text file"
    assert result1.extraction_method == "plaintext_fallback"
    assert result1.extracted_text == "Hello, this is plain text stored under an unknown extension."
    assert any("Used plain text fallback" in msg and ".xyz" in msg for _, msg in records), "Expected fallback-success warning log with extension"

    print()
    print("=" * 70)
    print("TEST 2: Unknown binary extension '.bin' with non-UTF8 binary content")
    print("=" * 70)
    records.clear()
    p2 = os.path.join(tmpdir, "payload.bin")
    with open(p2, "wb") as f:
        f.write(bytes(range(0, 256)) * 4)  # includes NUL, control bytes, high bytes
    result2 = processor.extract_text(p2, make_metadata(p2, ".bin"))
    print("error_message:", result2.error_message)
    print("extraction_method:", result2.extraction_method)
    print("extracted_text length:", len(result2.extracted_text))
    print("extracted_text sample (first 50 codepoints):", [hex(ord(c)) for c in result2.extracted_text[:50]])
    print("log records:", records)
    # Document behavior: latin-1 never raises, so this "succeeds" (no exception) even though
    # content is binary garbage. Confirm no U+0000-U+001F (except tab/LF/CR) leaked through.
    for ch in result2.extracted_text:
        if ord(ch) <= 0x1F:
            assert ch in ("\t", "\n", "\r"), f"Forbidden control char leaked: {hex(ord(ch))}"

    print()
    print("=" * 70)
    print("TEST 3: Unknown extension pointing at a NON-EXISTENT file (fallback failure)")
    print("=" * 70)
    records.clear()
    p3 = os.path.join(tmpdir, "does_not_exist.xyz")
    result3 = processor.extract_text(p3, make_metadata(p3, ".xyz"))
    print("error_message:", result3.error_message)
    print("extraction_method:", result3.extraction_method)
    print("log records:", records)
    assert result3.error_message is not None, "Expected error for missing file"
    assert result3.extraction_method == "plaintext_fallback"
    assert any(
        "Unsupported format" in msg and ".xyz" in msg and "fallback failed" in msg
        for _, msg in records
    ), "Expected fallback-failure warning log including file extension"

    print()
    print("=" * 70)
    print("TEST 4: Empty file with unknown extension '.dat'")
    print("=" * 70)
    records.clear()
    p4 = os.path.join(tmpdir, "empty.dat")
    with open(p4, "w") as f:
        pass
    result4 = processor.extract_text(p4, make_metadata(p4, ".dat"))
    print("error_message:", result4.error_message)
    print("extracted_text:", repr(result4.extracted_text))
    print("log records:", records)
    assert result4.error_message is None
    assert result4.extracted_text == ""

    print()
    print("=" * 70)
    print("TEST 5: File with NO extension at all (extension == '')")
    print("=" * 70)
    records.clear()
    p5 = os.path.join(tmpdir, "README")
    with open(p5, "w", encoding="utf-8") as f:
        f.write("A readme with no extension.")
    result5 = processor.extract_text(p5, make_metadata(p5, ""))
    print("error_message:", result5.error_message)
    print("extraction_method:", result5.extraction_method)
    print("extracted_text:", repr(result5.extracted_text))
    assert result5.error_message is None
    assert result5.extraction_method == "plaintext_fallback"
    assert result5.extracted_text == "A readme with no extension."

    print()
    print("=" * 70)
    print("TEST 6: get_supported_formats() unaffected by fallback logic")
    print("=" * 70)
    formats = processor.get_supported_formats()
    print("supported formats:", formats)
    assert ".xyz" not in formats
    assert "" not in formats

    print()
    print("=" * 70)
    print("TEST 7: error_message distinguishes fallback failure vs primary handler failure")
    print("=" * 70)
    # Primary handler failure: .pdf extension (registered -> PDFHandler) pointed at a bogus/corrupt file
    p7 = os.path.join(tmpdir, "corrupt.pdf")
    with open(p7, "w", encoding="utf-8") as f:
        f.write("not a real pdf")
    result_primary = processor.extract_text(p7, make_metadata(p7, ".pdf"))
    print("PRIMARY failure error_message:", result_primary.error_message)
    print("PRIMARY extraction_method:", result_primary.extraction_method)

    print("FALLBACK failure error_message:", result3.error_message)
    print("FALLBACK extraction_method:", result3.extraction_method)

    if result_primary.error_message:
        distinguishable = (
            result_primary.extraction_method != result3.extraction_method
        )
        print("Distinguishable via extraction_method field:", distinguishable)
        print("Does error_message text itself mention 'fallback'?", "fallback" in result3.error_message.lower())
        print("Does primary error_message text mention 'fallback'?", "fallback" in result_primary.error_message.lower())

print()
print("ALL CHECKS PASSED (see notes above for behavioral observations)")
