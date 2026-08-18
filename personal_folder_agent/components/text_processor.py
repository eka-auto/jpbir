"""Text Processor component for extracting text from various file formats.

This module implements the TextProcessor interface, providing format-specific
handlers for PDF, DOCX, XLSX, PPTX, CSV, and plain text files. It also includes
text cleaning utilities that normalize whitespace and strip control characters.

Supported formats:
- .txt, .md, .json, .xml, .csv - Plain text / structured text
- .pdf - Via pdfplumber
- .docx - Via python-docx
- .xlsx - Via openpyxl
- .pptx - Via python-pptx
"""

import logging
import re
import time
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Type

from personal_folder_agent.interfaces import TextProcessor as TextProcessorInterface
from personal_folder_agent.models import FileMetadata, TextExtractionResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Text cleaning utilities
# ---------------------------------------------------------------------------


def clean_text(text: str) -> str:
    """Clean extracted text by removing control characters and normalizing whitespace.

    Processing steps:
    1. Strip Unicode control characters U+0000 to U+001F, excluding:
       - U+0009 (horizontal tab)
       - U+000A (line feed / newline)
       - U+000D (carriage return)
    2. Normalize line endings to LF (replace \\r\\n and \\r with \\n).
    3. Collapse runs of whitespace (spaces/tabs) within lines to single spaces.
    4. Strip leading/trailing whitespace from the result.

    Args:
        text: Raw text to clean.

    Returns:
        Cleaned text string.
    """
    if not text:
        return ""

    # Step 1: Remove control chars U+0000-U+001F except tab (0x09), LF (0x0A), CR (0x0D)
    # Build pattern matching U+0000-U+0008, U+000B-U+000C, U+000E-U+001F
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)

    # Step 2: Normalize line endings to LF
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Step 3: Collapse runs of horizontal whitespace (spaces/tabs) within lines
    text = re.sub(r"[^\S\n]+", " ", text)

    # Step 4: Strip leading/trailing whitespace
    text = text.strip()

    return text


# ---------------------------------------------------------------------------
# Encoding detection utilities
# ---------------------------------------------------------------------------


def detect_encoding(raw_bytes: bytes) -> str:
    """Detect the most likely character encoding of raw byte content.

    Strategy:
    1. Empty input defaults to 'utf-8'.
    2. Attempt a strict UTF-8 decode first. UTF-8's multi-byte continuation
       sequences are self-validating, so bytes that decode cleanly as UTF-8
       are, for all practical purposes, UTF-8 -- it's extremely unlikely for
       arbitrary legacy-encoded bytes to also happen to form valid UTF-8.
       This avoids charset-normalizer's statistical heuristic misclassifying
       short, valid UTF-8 text (e.g. accented Latin text) as an unrelated
       legacy codepage such as cp932 or cp1258.
    3. If strict UTF-8 decoding fails, fall back to charset-normalizer's
       statistical detection for legacy/unknown encodings.
    4. Defaults to 'utf-8' if detection is inconclusive.

    Args:
        raw_bytes: Raw file content as bytes.

    Returns:
        Detected encoding name (e.g., 'utf-8', 'cp1252'). Defaults to
        'utf-8' if the input is empty or detection is inconclusive.
    """
    if not raw_bytes:
        return "utf-8"

    # Prefer strict UTF-8 validation over heuristic guessing. See docstring.
    try:
        raw_bytes.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass

    try:
        from charset_normalizer import from_bytes

        match = from_bytes(raw_bytes).best()
        if match is not None and match.encoding:
            return match.encoding
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.debug("Encoding detection failed, defaulting to utf-8: %s", exc)

    return "utf-8"


def read_text_with_encoding_detection(file_path: str) -> str:
    """Read a file's text content, auto-detecting its character encoding.

    Reads the file as raw bytes, detects the most likely encoding using
    charset-normalizer, and decodes accordingly. Falls back to latin-1
    (which can decode any byte sequence without raising) if the detected
    encoding fails to decode cleanly or names an unrecognized codec.

    Args:
        file_path: Path to the file to read.

    Returns:
        Decoded text content.
    """
    with open(file_path, "rb") as f:
        raw_bytes = f.read()

    encoding = detect_encoding(raw_bytes)

    try:
        return raw_bytes.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        return raw_bytes.decode("latin-1")


# ---------------------------------------------------------------------------
# Format handler base class and implementations
# ---------------------------------------------------------------------------


class FormatHandler(ABC):
    """Abstract base class for format-specific text extraction handlers."""

    @abstractmethod
    def extract(self, file_path: str) -> str:
        """Extract text content from a file.

        Args:
            file_path: Absolute path to the file to process.

        Returns:
            Extracted raw text content.

        Raises:
            Exception: If extraction fails for any reason.
        """
        ...

    @property
    @abstractmethod
    def method_name(self) -> str:
        """Return a short identifier for the extraction method used."""
        ...


class TextHandler(FormatHandler):
    """Handler for plain text files (.txt, .md, .json, .xml)."""

    @property
    def method_name(self) -> str:
        return "plaintext"

    def extract(self, file_path: str) -> str:
        """Read file content, auto-detecting its character encoding."""
        return read_text_with_encoding_detection(file_path)


class CSVHandler(FormatHandler):
    """Handler for CSV files using pandas."""

    @property
    def method_name(self) -> str:
        return "pandas_csv"

    def extract(self, file_path: str) -> str:
        """Extract CSV content as a text representation, auto-detecting encoding."""
        import pandas as pd

        with open(file_path, "rb") as f:
            raw_bytes = f.read()
        encoding = detect_encoding(raw_bytes)

        try:
            df = pd.read_csv(file_path, encoding=encoding, on_bad_lines="skip")
        except (UnicodeDecodeError, LookupError):
            df = pd.read_csv(file_path, encoding="latin-1", on_bad_lines="skip")

        return df.to_string(index=False)


class PDFHandler(FormatHandler):
    """Handler for PDF files using pdfplumber."""

    @property
    def method_name(self) -> str:
        return "pdfplumber"

    def extract(self, file_path: str) -> str:
        """Extract text from all pages of a PDF file."""
        import pdfplumber

        text_parts: List[str] = []
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        return "\n".join(text_parts)


class DOCXHandler(FormatHandler):
    """Handler for DOCX files using python-docx."""

    @property
    def method_name(self) -> str:
        return "python-docx"

    def extract(self, file_path: str) -> str:
        """Extract text from all paragraphs in a DOCX document."""
        from docx import Document

        doc = Document(file_path)
        paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
        return "\n".join(paragraphs)


class XLSXHandler(FormatHandler):
    """Handler for XLSX spreadsheet files using openpyxl."""

    @property
    def method_name(self) -> str:
        return "openpyxl"

    def extract(self, file_path: str) -> str:
        """Extract text from all sheets and cells in an XLSX workbook."""
        from openpyxl import load_workbook

        wb = load_workbook(file_path, read_only=True, data_only=True)
        text_parts: List[str] = []

        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            text_parts.append(f"[Sheet: {sheet_name}]")
            for row in sheet.iter_rows(values_only=True):
                row_text = "\t".join(
                    str(cell) if cell is not None else "" for cell in row
                )
                if row_text.strip():
                    text_parts.append(row_text)

        wb.close()
        return "\n".join(text_parts)


class PPTXHandler(FormatHandler):
    """Handler for PPTX presentation files using python-pptx."""

    @property
    def method_name(self) -> str:
        return "python-pptx"

    def extract(self, file_path: str) -> str:
        """Extract text from all slides in a PPTX presentation."""
        from pptx import Presentation

        prs = Presentation(file_path)
        text_parts: List[str] = []

        for slide_index, slide in enumerate(prs.slides, start=1):
            text_parts.append(f"[Slide {slide_index}]")
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for paragraph in shape.text_frame.paragraphs:
                        para_text = paragraph.text.strip()
                        if para_text:
                            text_parts.append(para_text)

        return "\n".join(text_parts)


# ---------------------------------------------------------------------------
# Main TextProcessor implementation
# ---------------------------------------------------------------------------

# Default handler registry mapping extensions to handler classes
_DEFAULT_HANDLER_REGISTRY: Dict[str, Type[FormatHandler]] = {
    ".txt": TextHandler,
    ".md": TextHandler,
    ".json": TextHandler,
    ".xml": TextHandler,
    ".csv": CSVHandler,
    ".pdf": PDFHandler,
    ".docx": DOCXHandler,
    ".xlsx": XLSXHandler,
    ".pptx": PPTXHandler,
}


class ConcreteTextProcessor(TextProcessorInterface):
    """Concrete implementation of the TextProcessor interface.

    Extracts text from files using format-specific handlers, cleans the
    extracted text, and returns structured results. Supports fallback to
    plain text extraction for unrecognized formats (Requirement 2.6).

    Args:
        handler_registry: Optional custom mapping of extensions to handler classes.
            Defaults to the built-in registry.
    """

    def __init__(
        self,
        handler_registry: Optional[Dict[str, Type[FormatHandler]]] = None,
    ):
        self._handler_registry = handler_registry or dict(_DEFAULT_HANDLER_REGISTRY)
        # Instantiate handlers lazily per extraction call to keep things stateless
        self._handler_instances: Dict[str, FormatHandler] = {}

    def _get_handler(self, extension: str) -> Optional[FormatHandler]:
        """Get or create a handler instance for the given extension.

        Args:
            extension: File extension including the dot (e.g., '.pdf').

        Returns:
            FormatHandler instance or None if extension is not registered.
        """
        ext = extension.lower()
        if ext not in self._handler_registry:
            return None

        if ext not in self._handler_instances:
            self._handler_instances[ext] = self._handler_registry[ext]()
        return self._handler_instances[ext]

    def extract_text(self, file_path: str, file_metadata: FileMetadata) -> TextExtractionResult:
        """Extract and clean text from a file using the appropriate handler.

        If the file's extension has a registered handler, it is used directly.
        If no handler is registered, the system attempts plain text extraction
        as a fallback (Requirement 2.6). If that also fails, the file is skipped
        with an error message.

        Args:
            file_path: Absolute path to the file.
            file_metadata: Pre-collected metadata about the file.

        Returns:
            TextExtractionResult with extracted text or error information.
        """
        start_time = time.perf_counter()
        extension = file_metadata.extension.lower()

        handler = self._get_handler(extension)

        if handler is not None:
            # Use the registered handler
            return self._extract_with_handler(file_path, file_metadata, handler, start_time)

        # No registered handler - attempt fallback to plain text (Requirement 2.6)
        logger.info(
            "No handler for extension '%s', attempting plain text fallback: %s",
            extension,
            file_path,
        )
        fallback_handler = TextHandler()
        result = self._extract_with_handler(
            file_path, file_metadata, fallback_handler, start_time, is_fallback=True
        )

        if result.error_message:
            # Fallback also failed - log warning and return error result
            logger.warning(
                "Unsupported format '%s' - plain text fallback failed for: %s",
                extension,
                file_path,
            )
        else:
            logger.warning(
                "Used plain text fallback for unsupported format '%s': %s",
                extension,
                file_path,
            )

        return result

    def _extract_with_handler(
        self,
        file_path: str,
        file_metadata: FileMetadata,
        handler: FormatHandler,
        start_time: float,
        is_fallback: bool = False,
    ) -> TextExtractionResult:
        """Internal helper that runs a handler and returns a TextExtractionResult.

        Args:
            file_path: Path to file.
            file_metadata: File metadata.
            handler: FormatHandler to use for extraction.
            start_time: perf_counter timestamp when extraction started.
            is_fallback: Whether this is a fallback attempt.

        Returns:
            TextExtractionResult (always populated, even on error).
        """
        method = handler.method_name
        if is_fallback:
            method = "plaintext_fallback"

        try:
            raw_text = handler.extract(file_path)
            cleaned_text = clean_text(raw_text)
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)

            return TextExtractionResult(
                file_metadata=file_metadata,
                extracted_text=cleaned_text,
                extraction_method=method,
                error_message=None,
                processing_time_ms=elapsed_ms,
            )
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            error_msg = f"{type(e).__name__}: {e}"
            logger.error(
                "Text extraction failed for '%s' using %s: %s",
                file_path,
                method,
                error_msg,
            )
            return TextExtractionResult(
                file_metadata=file_metadata,
                extracted_text="",
                extraction_method=method,
                error_message=error_msg,
                processing_time_ms=elapsed_ms,
            )

    def get_supported_formats(self) -> List[str]:
        """Return list of file extensions with registered handlers.

        Returns:
            Sorted list of supported extensions (e.g., ['.csv', '.docx', ...]).
        """
        return sorted(self._handler_registry.keys())
