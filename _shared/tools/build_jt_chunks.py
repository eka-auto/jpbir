"""Build a chunks.jsonl training corpus from one or more folder roots.

This is the local half of the hand-off described in
``personal_folder_agent/utils/chunk_io.py``: crawl -> extract -> chunk runs
here, on the machine where the files actually live; training runs elsewhere
on a GPU and consumes the JSONL this produces.

Usage:
    python tools/build_jt_chunks.py --scan-only --root "C:\\jayti"
    python tools/build_jt_chunks.py --root "C:\\jayti" --label jayti \\
        --out runs/jt_agent/parts/jayti.jsonl

Records are appended one JSON object per line as each file is processed, so
an interrupted run keeps everything it had already extracted. Re-running
with the same ``--out`` truncates and starts over unless ``--resume`` is
passed, in which case already-processed source files are skipped.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import sys
import time
from dataclasses import asdict
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from personal_folder_agent.components.text_chunker import TextChunkerImpl
from personal_folder_agent.components.text_processor import ConcreteTextProcessor
from personal_folder_agent.models import FileMetadata, FileStatus

# Filename globs are necessary but not sufficient: a private key pasted into a
# markdown runbook has no filename to match. Every chunk is checked against the
# content patterns too, so a secret has to evade both to reach the corpus.
from tools.scrub_secrets import classify as classify_secrets

# Directory names pruned during the walk. Machine-generated, vendored, or
# binary-only trees: training on them adds noise and burns tokens.
PRUNE_DIRS = {
    ".git", ".hg", ".svn", ".idea", ".vscode",
    "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache",
    "venv", ".venv", "env", "site-packages", "dist-info",
    ".next", ".nuxt", ".cache", ".parcel-cache", ".terraform", ".vercel",
    "$RECYCLE.BIN", "System Volume Information", "$Recycle.Bin",
    "AppData", "Application Data", "Local Settings",
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
    "build", "dist", "obj", "bin", "target",
    "chrome_profile", "Default", "IndexedDB", "Service Worker",
    # ML artifact trees. A single LoRA checkpoint directory contributed 44,046
    # chunks of adapter_config.json in an early run -- more than the entire
    # rest of the corpus -- which would have taught the agent about tensor
    # shapes instead of about the user.
    "models", "checkpoints", "checkpoint", "wandb", "mlruns",
    "adapter", "adapters", "lora", "safetensors",
}

# Filenames that are always machine-generated. Lockfiles in particular are
# large, highly repetitive, and say nothing a person would ever ask about.
NOISE_GLOBS = [
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json",
    "poetry.lock", "Pipfile.lock", "Cargo.lock", "composer.lock", "Gemfile.lock",
    "adapter_config.json", "adapter_model*", "tokenizer.json",
    "tokenizer_config.json", "special_tokens_map.json", "vocab.json",
    "merges.txt", "*.safetensors*", "*.ckpt", "*.pt", "*.bin",
    "trainer_state.json", "optimizer.json", "scheduler.json",
    # Build output: generated from source that is already in the corpus.
    "*.min.js", "*.min.css", "*.map", "*.bundle.js", "*.chunk.js",
]

# Filename globs never read. Credentials and key material must not end up in
# a training corpus -- a fine-tuned model can reproduce what it was shown.
SECRET_GLOBS = [
    ".env", ".env.*", "*.pem", "*.key", "*.pfx", "*.p12", "*.keystore",
    "id_rsa*", "id_ed25519*", "*.ppk",
    "credentials", "credentials.json", "client_secret*.json",
    "token.json", "*token*.json", "*.credentials",
    ".npmrc", ".pypirc", ".netrc", ".git-credentials",
    "*secret*.json", "*secrets*.yaml", "*secrets*.yml",
    # Added after a scan found 6 live 2048-bit RSA keys in the corpus: none of
    # these filenames matched any glob above.
    "serviceaccountkey*.json", "*service*account*.json",
    "firebase-adminsdk*.json", "google-services.json",
    "*.mcp.json", "gha-creds-*.json",
]

DEFAULT_MAX_FILE_MB = 25.0

# Plain-text formats the format-handler registry has no handler for, but which
# are perfectly readable as UTF-8. Source code is the largest of these and the
# most worth having: across 44 repos it is the actual record of what was built,
# and excluding it left that entire story out of the corpus.
TEXTLIKE_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".java", ".kt", ".go", ".rs", ".rb", ".php", ".cs", ".c", ".h", ".cpp",
    ".sh", ".bash", ".ps1", ".bat", ".cmd",
    ".html", ".htm", ".css", ".scss",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties",
    ".sql", ".graphql", ".proto",
    ".log", ".env.example", ".gitignore", ".dockerfile",
    ".ipynb", ".rst", ".tex", ".srt", ".vtt", ".vcf", ".ics", ".eml",
    ".tsv", ".jsonl",
}

# A line this long is a minified bundle or an embedded blob, not prose. Such a
# file is skipped whole: chunking it produces tokens no one will ever ask about.
MAX_LINE_CHARS = 5000


def is_secret_name(name: str) -> bool:
    """True when a filename looks like credential or key material."""
    lowered = name.lower()
    return any(fnmatch.fnmatch(lowered, pattern) for pattern in SECRET_GLOBS)


def is_noise_name(name: str) -> bool:
    """True when a filename is a machine-generated artifact, not content."""
    lowered = name.lower()
    return any(fnmatch.fnmatch(lowered, pattern.lower()) for pattern in NOISE_GLOBS)


def iter_files(
    roots: Iterable[str],
    extensions: Set[str],
    max_bytes: int,
    max_depth: int = 12,
) -> Iterable[Tuple[str, os.stat_result]]:
    """Yield (path, stat) for every candidate file under ``roots``.

    Prunes noise directories, refuses to follow symlinks and junctions (so a
    reparse point such as ``C:\\Documents and Settings`` cannot loop), skips
    secret-looking names, and skips anything over ``max_bytes``.
    """
    for root in roots:
        if not os.path.isdir(root):
            print("  [skip] not a directory: %s" % root, file=sys.stderr)
            continue

        root_depth = root.rstrip("\\/").count(os.sep)

        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            if dirpath.count(os.sep) - root_depth >= max_depth:
                dirnames[:] = []
                continue

            dirnames[:] = [
                name
                for name in dirnames
                if name not in PRUNE_DIRS
                and not name.startswith(".")
                and not os.path.islink(os.path.join(dirpath, name))
            ]

            for name in filenames:
                extension = os.path.splitext(name)[1].lower()
                if extension not in extensions:
                    continue
                if is_secret_name(name) or is_noise_name(name):
                    continue

                path = os.path.join(dirpath, name)
                try:
                    info = os.stat(path)
                except OSError:
                    continue
                if info.st_size == 0 or info.st_size > max_bytes:
                    continue
                yield path, info


class OutputLock:
    """Guard against two builds appending to one output file.

    Two concurrent runs against the same ``--out`` interleave their writes:
    an earlier session produced 34,019 duplicate chunks and 4 half-written
    lines that way. The merge de-duplicates, but the corrupt lines do not
    survive JSON parsing, so the damage is silent until something tries to
    read them. An exclusive lockfile makes the second run refuse instead.
    """

    def __init__(self, out_path: str) -> None:
        self.path = out_path + ".lock"
        self.handle = None

    def __enter__(self) -> "OutputLock":
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise SystemExit(
                "Refusing to start: %s exists, so another build is already "
                "writing %s. Wait for it, or delete the lock if that process "
                "is dead." % (self.path, os.path.basename(self.path[:-5]))
            )
        self.handle = os.fdopen(fd, "w")
        self.handle.write(str(os.getpid()))
        self.handle.flush()
        return self

    def __exit__(self, *exc: object) -> None:
        if self.handle is not None:
            self.handle.close()
        try:
            os.remove(self.path)
        except OSError:
            pass


def read_textlike(path: str) -> str:
    """Read a plain-text file the handler registry has no handler for.

    Returns "" when the file is binary in practice (a decode that is mostly
    replacement characters) or when any single line is long enough to mark it
    as a minified bundle rather than something a person wrote.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
    except OSError:
        return ""

    if not text.strip():
        return ""
    if text.count("�") > len(text) // 20:
        return ""
    for line in text.splitlines():
        if len(line) > MAX_LINE_CHARS:
            return ""
    return text


def build_metadata(path: str, info: os.stat_result) -> FileMetadata:
    """Construct the FileMetadata the text processor expects.

    ``sha256_hash`` is left empty: hashing every file doubles the I/O and
    nothing downstream of chunking consumes it here.
    """
    return FileMetadata(
        path=path,
        size_bytes=info.st_size,
        extension=os.path.splitext(path)[1].lower(),
        last_modified=datetime.fromtimestamp(info.st_mtime),
        sha256_hash="",
        permissions="r" if os.access(path, os.R_OK) else "-",
        processing_status=FileStatus.PENDING,
    )


def already_done(out_path: str) -> Set[str]:
    """Source files already present in a partially written output file."""
    seen: Set[str] = set()
    if not os.path.isfile(out_path):
        return seen
    with open(out_path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                seen.add(json.loads(line)["source_file"])
            except (ValueError, KeyError):
                continue
    return seen


def scan(roots: List[str], extensions: Set[str], max_bytes: int) -> Dict[str, object]:
    """Count candidate files and bytes per extension without reading them."""
    by_extension: Dict[str, List[int]] = {}
    total_files = 0
    total_bytes = 0
    started = time.time()

    for path, info in iter_files(roots, extensions, max_bytes):
        extension = os.path.splitext(path)[1].lower()
        bucket = by_extension.setdefault(extension, [0, 0])
        bucket[0] += 1
        bucket[1] += info.st_size
        total_files += 1
        total_bytes += info.st_size

    return {
        "roots": roots,
        "total_files": total_files,
        "total_mb": round(total_bytes / (1024 * 1024), 1),
        "seconds": round(time.time() - started, 1),
        "by_extension": {
            extension: {"files": count, "mb": round(size / (1024 * 1024), 1)}
            for extension, (count, size) in sorted(
                by_extension.items(), key=lambda item: -item[1][1]
            )
        },
    }


def build(
    roots: List[str],
    out_path: str,
    label: str,
    extensions: Set[str],
    max_bytes: int,
    resume: bool,
    strategy: Optional[str],
    progress_every: int,
) -> Dict[str, object]:
    """Crawl, extract and chunk, appending JSONL as each file completes."""
    processor = ConcreteTextProcessor()
    chunker = TextChunkerImpl()
    handled_by_processor = set(processor.get_supported_formats())

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)

    lock = OutputLock(out_path)
    lock.__enter__()

    skip = already_done(out_path) if resume else set()
    mode = "a" if (resume and os.path.isfile(out_path)) else "w"

    files_seen = 0
    files_chunked = 0
    files_failed = 0
    chunks_written = 0
    secrets_skipped = 0
    tokens_written = 0
    errors: List[Dict[str, str]] = []
    started = time.time()

    with open(out_path, mode, encoding="utf-8") as out:
        for path, info in iter_files(roots, extensions, max_bytes):
            files_seen += 1
            if path in skip:
                continue

            extension = os.path.splitext(path)[1].lower()
            if extension in handled_by_processor:
                try:
                    extraction = processor.extract_text(path, build_metadata(path, info))
                except Exception as error:  # noqa: BLE001 - one bad file must not stop the run
                    files_failed += 1
                    errors.append({"file": path, "stage": "extract", "error": str(error)})
                    continue
                raw = extraction.extracted_text or ""
            else:
                raw = read_textlike(path)

            text = raw.strip()
            if not text:
                continue

            try:
                chunks = chunker.chunk_document(text, path, strategy) if strategy \
                    else chunker.chunk_document(text, path)
            except Exception as error:  # noqa: BLE001
                files_failed += 1
                errors.append({"file": path, "stage": "chunk", "error": str(error)})
                continue

            for chunk in chunks:
                leaked = classify_secrets(chunk.text or "")
                if leaked:
                    secrets_skipped += 1
                    errors.append(
                        {"file": path, "stage": "secret_filter",
                         "error": "chunk dropped: %s" % ",".join(leaked)}
                    )
                    continue
                record = asdict(chunk)
                record.setdefault("metadata", {})
                record["metadata"]["corpus_label"] = label
                record["metadata"]["source_root"] = _owning_root(path, roots)
                out.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
                chunks_written += 1
                tokens_written += int(chunk.token_count or 0)

            files_chunked += 1
            out.flush()

            if progress_every and files_chunked % progress_every == 0:
                print(
                    "  [%s] %d files -> %d chunks (%.0fs)"
                    % (label, files_chunked, chunks_written, time.time() - started),
                    flush=True,
                )

    lock.__exit__()

    return {
        "label": label,
        "roots": roots,
        "out": out_path,
        "files_seen": files_seen,
        "files_chunked": files_chunked,
        "files_failed": files_failed,
        "chunks": chunks_written,
        "secret_chunks_skipped": secrets_skipped,
        "tokens": tokens_written,
        "seconds": round(time.time() - started, 1),
        "errors": errors[:50],
    }


def _owning_root(path: str, roots: List[str]) -> str:
    lowered = path.lower()
    for root in roots:
        if lowered.startswith(root.lower()):
            return root
    return ""


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", action="append", dest="roots", required=True,
                        help="Folder root to crawl. Repeatable.")
    parser.add_argument("--out", help="Output .jsonl path (required unless --scan-only).")
    parser.add_argument("--label", default="corpus",
                        help="Corpus label stamped into each chunk's metadata.")
    parser.add_argument("--scan-only", action="store_true",
                        help="Count candidate files and bytes; read nothing.")
    parser.add_argument("--resume", action="store_true",
                        help="Append, skipping source files already in --out.")
    parser.add_argument("--max-file-mb", type=float, default=DEFAULT_MAX_FILE_MB)
    parser.add_argument("--strategy", default=None,
                        choices=["fixed_size", "sentence_aware", "paragraph_aware"])
    parser.add_argument("--extensions", default=None,
                        help="Comma-separated override, e.g. '.txt,.md,.pdf'.")
    parser.add_argument("--no-textlike", action="store_true",
                        help="Exclude source code, config and log formats.")
    parser.add_argument("--progress-every", type=int, default=25)
    parser.add_argument("--report", help="Write the JSON summary here as well.")
    args = parser.parse_args(argv)

    if args.extensions:
        extensions = {
            item if item.startswith(".") else "." + item
            for item in (part.strip().lower() for part in args.extensions.split(","))
            if item
        }
    else:
        extensions = set(ConcreteTextProcessor().get_supported_formats())
        if not args.no_textlike:
            extensions |= TEXTLIKE_EXTS

    max_bytes = int(args.max_file_mb * 1024 * 1024)

    if args.scan_only:
        summary: Dict[str, object] = scan(args.roots, extensions, max_bytes)
    else:
        if not args.out:
            parser.error("--out is required unless --scan-only is given")
        summary = build(
            roots=args.roots,
            out_path=args.out,
            label=args.label,
            extensions=extensions,
            max_bytes=max_bytes,
            resume=args.resume,
            strategy=args.strategy,
            progress_every=args.progress_every,
        )

    rendered = json.dumps(summary, indent=2, ensure_ascii=False)
    print(rendered)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as handle:
            handle.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
