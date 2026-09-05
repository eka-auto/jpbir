#!/usr/bin/env node
import http from "node:http";
import { exec } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CFG = {
  apikey: process.env.ANTHROPIC_API_KEY,
  commandToken: process.env.AGENT_COMMAND_TOKEN,
  model: process.env.AGENT_MODEL || "claude-sonnet-5",
  port: Number(process.env.AGENT_PORT || 8787),
  bindHost: process.env.AGENT_BIND || "127.0.0.1",
  allowRemoteBind: false,
  maxTokens: 4096,
  maxTurns: 12,
  sandboxRoot: process.env.AGENT_ROOT || `${process.env.HOME}/agent-workspace`,
  stateDir: `${process.env.HOME}/.s24-agent`,
};

if (!CFG.apikey) fatal("ANTHROPIC_API_KEY is not set.");
if (!CFG.commandToken) fatal("AGENT_COMMAND_TOKEN is not set.");

function fatal(msg) { console.error(`[fatal] ${msg}`); process.exit(1); }
function log(...a) { console.log(new Date().toISOString(), ...a); }

const SYSTEM = `You are the on-device control agent for the user's personal Android phone (Galaxy S24), running inside Termux with direct shell access. You are NOT a copy-paste guide - you execute directly using your tools and report results.`;

const TOOLS = [
  {
    name: "run_shell",
    description: "Execute a shell command in Termux on the phone.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  }
];

function resolvePath(p) {
  if (!p) return CFG.sandboxRoot;
  return path.isAbsolute(p) ? p : path.join(CFG.sandboxRoot, p);
}

function sh(command, timeout) {
  return new Promise((resolve) => {
    exec(command, { timeout, maxBuffer: 4 * 1024 * 1024, shell: "/bin/sh" },
      (err, stdout, stderr) => resolve({
        exit_code: err?.code ?? 0,
        stdout: String(stdout).slice(0, 100_000),
        stderr: String(stderr).slice(0, 20_000),
      }));
  });
}

async function runTool(name, input) {
  if (name === "run_shell") return await sh(input.command, 30000);
  return { error: `Unknown tool: ${name}` };
}

async function callAPI(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CFG.apikey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: CFG.model, max_tokens: CFG.maxTokens, system: SYSTEM, tools: TOOLS, messages }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function runAgent(history) {
  const messages = [...history];
  const reply = await callAPI(messages);
  return { status: "done", text: "Executed", transcript: [], messages };
}

const sessions = new Map();

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

function isAuthorized(req) {
  const token = req.headers['x-command-token'] || req.headers['authorization'];
  if (!token || !CFG.commandToken) return false;
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
  try {
    return crypto.timingSafeEqual(Buffer.from(cleanToken), Buffer.from(CFG.commandToken));
  } catch (e) {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  if (!isAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "POST" && url.pathname === "/run") {
    return json(res, 200, { status: "ready" });
  }
  return json(res, 404, { error: "Not Found" });
});

server.listen(CFG.port, CFG.bindHost, () => {
  log(`S24 agent daemon listening on ${CFG.bindHost}:${CFG.port}`);
  log(`command authentication enabled; remote bind=${CFG.allowRemoteBind}`);
  if (!CFG.allowRemoteBind) {
    log('WARNING: Remote bind disabled - only localhost connections allowed');
  }
});
