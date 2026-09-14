#!/usr/bin/env python3
"""
classify.py — Decide which of the five layers a file belongs to.

Layers: Frontend, Backend, Database, Server, Integrations, _shared

How the decision is made (see references/classification.md for the narrative):
  1. Project-wide config/doc names go straight to _shared.
  2. Otherwise every rule family proposes a candidate:
       - path signal   — the DEEPEST path segment that names a layer wins,
                         because the most specific folder is the real intent
                         ("client/src/db/migrations/" is a migrations folder
                         that merely happens to live under client/).
       - name signal   — well-known filenames and provider names.
       - ext signal    — extension/framework mapping.
       - content signal (only with deep=True) — what the file actually does,
                         sniffed from its first few KB.
  3. The highest-confidence candidate wins. On a tie, the more
     framework-specific family wins: content > ext > path > name. That is the
     golden rule "framework/language beats filename" made mechanical.
  4. Nothing decisive → _shared at low confidence, flagged for human review.

Returns (layer, confidence_float_0_to_1, human_reason).
"""
import re

# --- extension -> layer (with a base confidence) --------------------------
EXT_LAYER = {
    # Frontend — view layers and styling
    ".jsx": ("Frontend", 0.9), ".tsx": ("Frontend", 0.92),
    ".vue": ("Frontend", 0.95), ".svelte": ("Frontend", 0.95),
    ".css": ("Frontend", 0.85), ".scss": ("Frontend", 0.85),
    ".sass": ("Frontend", 0.85), ".less": ("Frontend", 0.85),
    ".html": ("Frontend", 0.8), ".htm": ("Frontend", 0.8),
    # Frontend — static assets. Without these, every image in a project lands
    # in _shared at 0.2 and floods the review queue.
    ".png": ("Frontend", 0.9), ".jpg": ("Frontend", 0.9),
    ".jpeg": ("Frontend", 0.9), ".gif": ("Frontend", 0.9),
    ".svg": ("Frontend", 0.9), ".webp": ("Frontend", 0.9),
    ".avif": ("Frontend", 0.9), ".ico": ("Frontend", 0.88),
    ".woff": ("Frontend", 0.9), ".woff2": ("Frontend", 0.9),
    ".ttf": ("Frontend", 0.88), ".otf": ("Frontend", 0.88),
    ".eot": ("Frontend", 0.88),
    ".mp4": ("Frontend", 0.75), ".webm": ("Frontend", 0.75),
    ".mp3": ("Frontend", 0.75), ".wav": ("Frontend", 0.75),
    # Database
    ".sql": ("Database", 0.9), ".prisma": ("Database", 0.95),
    ".sqlite": ("Database", 0.9), ".sqlite3": ("Database", 0.9),
    ".db": ("Database", 0.85),
    # Server / infra
    ".dockerfile": ("Server", 0.9),
    ".tf": ("Server", 0.9), ".tfvars": ("Server", 0.88),
    ".sh": ("Server", 0.55), ".bash": ("Server", 0.55),
    ".ps1": ("Server", 0.55), ".bat": ("Server", 0.55), ".cmd": ("Server", 0.55),
    # ambiguous — resolved by path/name/content below
    ".js": ("Backend", 0.4), ".ts": ("Backend", 0.4),
    ".mjs": ("Backend", 0.4), ".cjs": ("Backend", 0.4),
    ".py": ("Backend", 0.45), ".rb": ("Backend", 0.5),
    ".go": ("Backend", 0.5), ".java": ("Backend", 0.5),
    ".php": ("Backend", 0.5), ".cs": ("Backend", 0.5),
    ".rs": ("Backend", 0.5), ".kt": ("Backend", 0.5),
}

# Extensions whose layer is genuinely unclear from the extension alone — these
# are the ones worth opening and sniffing when deep=True.
AMBIGUOUS_EXTS = {
    ".js", ".ts", ".mjs", ".cjs", ".py", ".rb", ".go", ".java", ".php",
    ".cs", ".rs", ".kt", ".sh", ".bash",
}

# --- path-segment signals (checked against every folder in the path) ------
PATH_SIGNALS = [
    # (regex on a path segment, layer, confidence, reason)
    (r"^(components?|pages?|views?|ui|client|public|assets|styles?|"
     r"frontend|www|static|layouts?|hooks?)$",
     "Frontend", 0.95, "path segment is a frontend folder"),
    (r"^(controllers?|services?|routes?|handlers?|api|middleware|"
     r"backend|server_side|usecases?|domain)$",
     "Backend", 0.9, "path segment is a backend folder"),
    (r"^(migrations?|models?|schema|schemas|seeds?|db|database|"
     r"repositor(y|ies)|entities)$",
     "Database", 0.92, "path segment is a database folder"),
    (r"^(deploy|infra|infrastructure|ops|docker|k8s|kubernetes|"
     r"helm|terraform|ci|cd|\.github|pipelines?)$",
     "Server", 0.9, "path segment is an infra/server folder"),
    (r"^(integrations?|connectors?|third_?party|external|providers?|"
     r"webhooks?|vendors?)$",
     "Integrations", 0.9, "path segment is an integrations folder"),
    # A folder literally named `server` is the author saying "this is how it
    # runs". Scored below the others so a decisive extension or a content
    # signal can still overrule it — `server/schema.sql` is Database.
    (r"^(server|hosting|bootstrap)$",
     "Server", 0.85, "path segment is a server folder"),
    # Cross-cutting by the author's own naming. Without this, a tree that is
    # already organised into a `shared/` folder has every file in it fall
    # through to the 0.2 catch-all and flood the review queue.
    (r"^(shared|common|docs?|documentation)$",
     "_shared", 0.84, "path segment is a shared/docs folder"),
]

# --- filename signals -----------------------------------------------------
# Known third-party providers, matched against whole name TOKENS rather than as
# substrings. Substring matching is wrong in both directions: it reads "s3" out
# of "css3" and "maps" out of "sitemaps", while missing the "stripe" in
# "stripeClient" once the name is lowercased. Tokenizing on separators and
# camelCase humps gets both cases right.
PROVIDERS = {
    "stripe", "razorpay", "paypal", "twilio", "sendgrid", "mailgun",
    "firebase", "auth0", "okta", "cloudinary", "algolia", "segment",
    "s3", "aws", "gcp", "azure", "oauth", "webhook", "webhooks",
    "googlemaps", "mapbox", "plaid", "shopify",
}
_TOKEN_RE = re.compile(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+")


def name_tokens(name):
    """Split a filename into lowercase word tokens.

    'stripeClient.ts' -> ['stripe', 'client', 'ts']
    'css3.css'        -> ['css3', 'css']      (not 's3')
    'AWSClient.js'    -> ['aws', 'client', 'js']
    """
    tokens = []
    for part in re.split(r"[^A-Za-z0-9]+", name):
        tokens.extend(t.lower() for t in _TOKEN_RE.findall(part))
    return tokens

NAME_SIGNALS = [
    (r"^dockerfile$", "Server", 0.95, "Dockerfile"),
    (r"^docker-compose\.ya?ml$", "Server", 0.95, "docker-compose"),
    (r"^(nginx|gunicorn|uwsgi|supervisor|procfile|nodemon)",
     "Server", 0.85, "process/proxy config"),
    (r"^\.?env(\..+)?$", "_shared", 0.6, "env file (kept at root/shared)"),
    (r"^(index|main|app|server|wsgi|asgi|manage)\.(js|ts|py|go|rb)$",
     "Server", 0.7, "application entrypoint"),
    (r".*(migration|migrate).*", "Database", 0.85, "migration file"),
    (r".*\.(model|entity|repository|schema)\.(js|ts|py)$",
     "Database", 0.85, "data model"),
    (r".*(controller|service|route|handler|middleware)\.(js|ts|py|go|rb)$",
     "Backend", 0.85, "backend module by name"),
    (r".*(component|page|view|layout)\.(js|ts|jsx|tsx)$",
     "Frontend", 0.85, "frontend module by name"),
]

# --- files that are clearly project-wide config / docs -> _shared ---------
SHARED_NAMES = {
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "tsconfig.json", "requirements.txt", "pyproject.toml", "poetry.lock",
    "go.mod", "go.sum", "gemfile", "gemfile.lock", "pom.xml",
    "readme.md", "license", "license.md", ".gitignore", ".editorconfig",
    ".eslintrc", ".prettierrc", "makefile", "cargo.toml", "cargo.lock",
}

# --- content signals — what the file actually does ------------------------
# Only consulted when deep=True and the file's extension is ambiguous. Each
# entry is (compiled regex, layer, confidence, reason). First match wins, so
# order from most to least specific.
CONTENT_SIGNALS = [
    # Database
    (r"\b(CREATE|ALTER|DROP)\s+TABLE\b", "Database", 0.9, "contains DDL"),
    (r"mongoose\.Schema|sequelize\.define|knex\.schema|\.createTable\(",
     "Database", 0.88, "defines an ORM schema"),
    (r"class\s+\w+\(\s*models\.Model\s*\)|db\.Column\(|@Entity\b",
     "Database", 0.88, "defines an ORM model"),
    # Server (bootstrap/hosting) — checked before Backend, since a file that
    # binds a port is the entrypoint even if it also defines routes.
    (r"app\.listen\(|uvicorn\.run\(|serve\(\s*\{|http\.ListenAndServe\(",
     "Server", 0.85, "binds a port / boots the app"),
    # Integrations
    (r"\b(stripe|twilio|razorpay|sendgrid|boto3|firebase-admin)\b|"
     r"@aws-sdk/|googleapis",
     "Integrations", 0.85, "imports a third-party provider SDK"),
    # Frontend
    (r"from\s+['\"]react['\"]|import\s+React\b|from\s+['\"]vue['\"]|"
     r"useState\(|useEffect\(|@Component\(",
     "Frontend", 0.88, "imports a UI framework"),
    (r"document\.(getElementById|querySelector)|window\.addEventListener",
     "Frontend", 0.8, "manipulates the DOM"),
    # Backend
    (r"from\s+flask\b|from\s+fastapi\b|FastAPI\(|@app\.route|"
     r"require\(['\"]express['\"]\)|from\s+['\"]express['\"]|"
     r"@RestController\b|@Controller\b",
     "Backend", 0.85, "defines a server framework app/route"),
    (r"router\.(get|post|put|patch|delete)\(|app\.(get|post|put)\(",
     "Backend", 0.82, "registers HTTP routes"),
]
CONTENT_SIGNALS = [(re.compile(p, re.I), l, c, r)
                   for p, l, c, r in CONTENT_SIGNALS]

# How much of a file to read when sniffing. Imports and class declarations are
# near the top; reading more costs time and buys nothing.
SNIFF_BYTES = 4096

# Below this confidence a signal-based guess is weak enough to be worth
# opening the file to check.
SNIFF_THRESHOLD = 0.7

# Family tie-break weights: when two candidates have equal confidence, the
# more framework-specific family wins.
TIER = {"content": 4, "ext": 3, "path": 2, "name": 1}


def _path_signal(rel_path):
    """Deepest path segment that names a layer. Returns (layer, conf, reason)."""
    segments = re.split(r"[\\/]", rel_path.lower())[:-1]  # drop the filename
    best = None
    for seg in segments:
        for pat, layer, conf, reason in PATH_SIGNALS:
            if re.match(pat, seg):
                # Overwrite rather than return: later segments are deeper, and
                # the deepest folder is the most specific statement of intent.
                best = (layer, conf, f"{reason} ('{seg}/')")
                break
    return best


def _name_signal(filename_lower, filename_raw):
    for pat, layer, conf, reason in NAME_SIGNALS:
        if re.match(pat, filename_lower):
            return (layer, conf, reason)
    # Provider check runs on the raw name so camelCase humps survive.
    for tok in name_tokens(filename_raw):
        if tok in PROVIDERS:
            return ("Integrations", 0.8,
                    f"name references a known third-party provider ('{tok}')")
    return None


def sniff_content(abs_path):
    """Read the head of a file and infer its layer from what it does.

    Returns (layer, conf, reason) or None. Never raises: an unreadable or
    binary file simply yields no signal.
    """
    try:
        with open(abs_path, "rb") as fh:
            raw = fh.read(SNIFF_BYTES)
    except OSError:
        return None
    if b"\0" in raw:  # binary; nothing textual to match
        return None
    text = raw.decode("utf-8", errors="replace")
    for rx, layer, conf, reason in CONTENT_SIGNALS:
        if rx.search(text):
            return (layer, conf, reason)
    return None


def guess_layer(rel_path, filename, ext, abs_path=None, deep=False):
    """Classify one file. Pass abs_path + deep=True to enable content sniffing."""
    fn = filename.lower()

    # Project-wide config/docs are decided by name alone.
    if fn in SHARED_NAMES:
        return ("_shared", 0.8, "project-wide config/doc file")

    candidates = []  # (conf, tier, layer, reason)
    ps = _path_signal(rel_path)
    if ps:
        candidates.append((ps[1], TIER["path"], ps[0], ps[2]))
    ns = _name_signal(fn, filename)
    if ns:
        candidates.append((ns[1], TIER["name"], ns[0], ns[2]))
    if ext in EXT_LAYER:
        layer, conf = EXT_LAYER[ext]
        candidates.append((conf, TIER["ext"], layer,
                           f"extension {ext} maps to {layer}"))

    best = max(candidates, default=None, key=lambda c: (c[0], c[1]))

    # Open the file only when the cheap signals are weak and the extension is
    # one whose layer the extension cannot settle on its own.
    if (deep and abs_path and ext in AMBIGUOUS_EXTS
            and (best is None or best[0] < SNIFF_THRESHOLD)):
        cs = sniff_content(abs_path)
        if cs:
            candidates.append((cs[1], TIER["content"], cs[0],
                               f"content: {cs[2]}"))
            best = max(candidates, key=lambda c: (c[0], c[1]))

    if best is None:
        return ("_shared", 0.2, "no strong signal; needs human confirmation")
    return (best[2], best[0], best[3])


if __name__ == "__main__":
    import os
    import sys
    args = [a for a in sys.argv[1:] if a != "--deep"]
    deep = "--deep" in sys.argv[1:]
    for p in args:
        print(p, "->", guess_layer(
            p, os.path.basename(p), os.path.splitext(p)[1].lower(),
            abs_path=p if os.path.isfile(p) else None, deep=deep))
