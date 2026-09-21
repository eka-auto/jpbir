// Runs the repo's Python mirrors of JavaScript policy from a Node suite, with their
// third-party imports (FastMCP, firebase_admin) stubbed, so a test can compare verdicts
// by executing both sides.
//
// Regex-asserting the Python source only ever caught constants. s24-source-mirrors.test.mjs
// kept passing while the connect MCP and the puller rejected every signed-broker-v2
// heartbeat, and while Database/firestore_mcp.py wrote updateMask paths Firestore rejects
// with 400. Executing them is the only check of what they actually do.
//
// Not a suite itself: run-all.mjs only discovers *.test.mjs.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PRELUDE = `
import importlib.util, json, sys, types

def _stub(name, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module
    return module

class _FastMCP:
    def __init__(self, *args, **kwargs):
        pass
    def tool(self, *args, **kwargs):
        return lambda fn: fn

_stub("mcp")
_stub("mcp.server")
_stub("mcp.server.fastmcp", FastMCP=_FastMCP)
_firebase = _stub("firebase_admin", initialize_app=lambda *a, **k: None)
_firebase.credentials = _stub("firebase_admin.credentials")
_firebase.firestore = _stub("firebase_admin.firestore")

def load(relative_path):
    name = "mirror_" + "".join(c if c.isalnum() else "_" for c in relative_path)
    spec = importlib.util.spec_from_file_location(name, ROOT + "/" + relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

INPUT = json.load(sys.stdin)
`;

/** Runs `body` after the prelude; `input` arrives as INPUT and the script prints JSON. */
export function runPython(body, input = null) {
  const script = `ROOT = ${JSON.stringify(ROOT)}\n${PRELUDE}\n${body}`;
  const res = spawnSync('python3', ['-c', script], { encoding: 'utf8', input: JSON.stringify(input) });
  if (res.error) {
    throw new Error(`python3 could not be started (${res.error.message}); this suite executes the Python mirrors`);
  }
  if (res.status !== 0) throw new Error(`python exited ${res.status}: ${res.stderr.slice(-1500)}`);
  return JSON.parse(res.stdout);
}
