#!/usr/bin/env node
/**
 * S24 Android Control Daemon
 * Runs on-device in Termux. Exposes an agent loop over the Messages API
 * with real shell/file tools and a command queue endpoint.
 */

import http from "node:http";
import { exec } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---- config ----

const CFG = {
  apikey: process.env.ANTHROPIC_API_KEY,
  model: process.env.AGENT_MODEL || "claude-sonnet-5",
  port: Number(process.env.AGENT_PORT || 8787),
  bindHost: process.env.AGENT_BIND || "0.0.0.0",
  maxTokens: 4096,
  maxTurns: 12,
  sandboxRoot: process.env.AGENT_ROOT || `${process.env.HOME}/agent-workspace`,
  stateDir: `${process.env.HOME}/.s24-agent`,
};

if (!CFG.apikey) fatal("ANTHROPIC_API_KEY is not set.");

function fatal(msg) { console.error(`[fatal] ${msg}`); process.exit(1); }
function log(...a) { console.log(new Date().toISOString(), ...a); }

// ---- system prompt ----

const SYSTEM = `You are the on-device control agent for the user's personal Android phone (Galaxy S24), running inside Termux with direct s
hell access. You are NOT a copy-paste guide - you execute directly using your tools and report results.

CAPABILITIES
- run_shell: execute commands in the Termux shell.
- read_file / write_file / list_dir: file operations within the sandbox root.
- Use termux-* utilities where relevant (termux-battery-status, termux-notification,
  termux-clipboard-get, termux-sms-list, termux-location).

OPERATING RULES
1. Work in small verified steps. Run a command, read the actual output, then decide the next step. Never assume a command succeeded.
2. If a command fails, read the stderr and diagnose before retrying. Do not repeat an identical failing command.
3. Prefer read-only inspection before mutation. Check a path exists before writing to it.
4. Stay inside the sandbox root for file operations unless the user names an absolute path outside it.
5. Never exfiltrate credentials, tokens, SMS contents, or location data to any network destination. Report them to the user only.
6. When the task is done, summarize what you actually ran and what changed. Be concise and factual. If something could not be done, say so
plainly rather than approximating.`;

// ---- tool schemas ----

const TOOLS = [
  {
    name: "run_shell",
    description: "Execute a shell command in Termux on the phone and return stdout, stderr, and exit code.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." },
        timeout_ms: { type: "integer", description: "Timeout in ms. Default 30000, max 180000." },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the device. Truncated to 100KB.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute or sandbox-relative path." } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a UTF-8 text file. Creates parent directories. Overwrites existing files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or sandbox-relative path." },
        content: { type: "string", description: "Full file content to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: "List the entries of a directory with type and size.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path. Defaults to sandbox root." } },
      required: [],
    },
  },
];

// ---- tool runners ----

function resolvePath(p) {
  if (!p) return CFG.sandboxRoot;
  return path.isAbsolute(p) ? p : path.join(CFG.sandboxRoot, p);
}

function sh(command, timeout) {
  return new Promise((resolve) => {
    exec(command, { timeout, maxBuffer: 4 * 1024 * 1024, shell: "/bin/sh" },
      (err, stdout, stderr) => resolve({
        exit_code: err?.code ?? 0,
        timed_out: err?.killed === true,
        stdout: String(stdout).slice(0, 100_000),
        stderr: String(stderr).slice(0, 20_000),
      }));
  });
}

async function runTool(name, input) {
  try {
    switch (name) {
      case "run_shell": {
        const cmd = input.command;
        const timeout = Math.min(Number(input.timeout_ms) || 30_000, 180_000);
        log("run:", cmd);
        return await sh(cmd, timeout);
      }
      case "read_file": {
        const p = resolvePath(input.path);
        if (!existsSync(p)) return { error: `No such file: ${p}` };
        return { path: p, content: (await readFile(p, "utf8")).slice(0, 100_000) };
      }
      case "write_file": {
        const p = resolvePath(input.path);
        await mkdir(path.dirname(p), { recursive: true });
        await writeFile(p, input.content, "utf8");
        return { path: p, bytes: Buffer.byteLength(input.content), status: "written" };
      }
      case "list_dir": {
        const p = resolvePath(input.path);
        const entries = await readdir(p, { withFileTypes: true });
        const withStats = await Promise.all(entries.map(async (e) => {
          let size = null;
          try {
            const st = await (await import("node:fs/promises")).stat(path.join(p, e.name));
            size = st.size;
          } catch { /* ignore stat errors */ }
          return { name: e.name, type: e.isDirectory() ? "dir" : "file", size };
        }));
        return { path: p, entries: withStats };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// ---- Messages API loop ----

async function callAPI(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CFG.apikey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CFG.model,
      max_tokens: CFG.maxTokens,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Runs the agent loop until the model stops requesting tools.
 * `history` is carried by the caller - the API itself is stateless.
 */
export async function runAgent(history) {
  const messages = [...history];
  const transcript = [];

  for (let turn = 0; turn < CFG.maxTurns; turn++) {
    const reply = await callAPI(messages);
    messages.push({ role: "assistant", content: reply.content });

    const text = reply.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (text) transcript.push({ type: "text", text });

    const toolUses = reply.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      return { status: "done", text, transcript, messages };
    }

    const results = [];
    for (const t of toolUses) {
      const out = await runTool(t.name, t.input);
      transcript.push({ type: "tool", name: t.name, input: t.input, output: out });
      results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }

  return { status: "max_turns_reached", transcript, messages };
}

// ---- command queue / HTTP ----

const sessions = new Map(); // sessionId -> messages[]

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, model: CFG.model, sandbox: CFG.sandboxRoot });
  }

  if (req.method !== "POST" || req.url !== "/command") {
    return json(res, 404, { error: "not found" });
  }

  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
  req.on("end", async () => {
    try {
      const { action, prompt, session_id } = JSON.parse(raw);
      if (action !== "anthropic-agent") return json(res, 400, { error: "unsupported action" });

      const sid = session_id || crypto.randomUUID();
      const history = sessions.get(sid) || [];
      history.push({ role: "user", content: prompt });

      const result = await runAgent(history);
      sessions.set(sid, result.messages);

      json(res, 200, {
        session_id: sid,
        status: result.status,
        text: result.text,
        transcript: result.transcript,
      });
    } catch (e) {
      log("error:", e.message);
      json(res, 500, { error: String(e.message || e) });
    }
  });
});

await mkdir(CFG.sandboxRoot, { recursive: true });
await mkdir(CFG.stateDir, { recursive: true });

server.listen(CFG.port, CFG.bindHost, () => {
  log(`S24 agent daemon listening on ${CFG.bindHost}:${CFG.port}`);
  log(`model=${CFG.model} sandbox=${CFG.sandboxRoot}`);
});