import { createServer } from "node:http"
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize, relative } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = process.cwd()

function unquoteEnvValue(raw) {
  const val = String(raw ?? "")
  if (val.startsWith("$'") && val.endsWith("'")) {
    const map = { n: "\n", r: "\r", t: "\t", "'": "'", '"': '"', "\\": "\\" }
    return val.slice(2, -1).replace(/\\([nrt'"\\])/g, (_, ch) => map[ch] ?? ch)
  }
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1)
  }
  return val
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, "utf8")
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const val = unquoteEnvValue(line.slice(eq + 1))
    if (
      process.env[key] === undefined ||
      process.env[key] === "" ||
      (process.env[key].startsWith("$'") && process.env[key].endsWith("'"))
    ) {
      process.env[key] = val
    }
  }
}

for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string" && v.startsWith("$'") && v.endsWith("'")) {
    process.env[k] = unquoteEnvValue(v)
  }
}

loadEnvFile(join(repoRoot, ".env.development.local"))
loadEnvFile("/vercel/share/.env.project")
loadEnvFile(join(repoRoot, ".env"))

const routes = new Map([
  ["/", "Frontend/index.html"],
  ["/agent", "Frontend/agent.html"],
  ["/db", "Frontend/db.html"],
  ["/jteka", "Frontend/jteka.html"],
  ["/s24", "Frontend/s24.html"],
  ["/sandbox", "Devices/sandbox/dashboard/index.html"],
  ["/viewer", "Frontend/viewer.html"],
  ["/vivobook", "Frontend/vivobook.html"],
])
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
}

function resolveBackendRoute(requestPath) {
  if (requestPath === "/agent/query") {
    return { file: "Backend/jp-live-agent.js", extraQuery: {} }
  }
  if (requestPath === "/agent/health") {
    return { file: "Backend/jp-live-agent.js", extraQuery: { op: "health" } }
  }
  if (requestPath === "/agent/state") {
    return { file: "Backend/jp-hub-state.js", extraQuery: {} }
  }
  if (requestPath === "/api/device-command-claim") {
    return { file: "Backend/broker-command-claim.js", extraQuery: {} }
  }
  if (requestPath.startsWith("/api/device-command-claim/")) {
    const commandId = requestPath.slice("/api/device-command-claim/".length)
    if (commandId && !commandId.includes("/")) {
      return { file: "Backend/broker-command-claim.js", extraQuery: { commandId } }
    }
  }
  if (requestPath === "/api/device-command-complete") {
    return { file: "Backend/broker-command-complete.js", extraQuery: {} }
  }
  if (requestPath.startsWith("/api/device-command-complete/")) {
    const commandId = requestPath.slice("/api/device-command-complete/".length)
    if (commandId && !commandId.includes("/")) {
      return { file: "Backend/broker-command-complete.js", extraQuery: { commandId } }
    }
  }
  if (requestPath.startsWith("/api/")) {
    const name = requestPath.slice("/api/".length).replace(/\.js$/, "")
    if (/^[a-zA-Z0-9_-]+$/.test(name)) {
      const candidate = join(repoRoot, "Backend", `${name}.js`)
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return { file: `Backend/${name}.js`, extraQuery: {} }
      }
    }
    return { notFoundApi: true }
  }
  return null
}

async function readJsonOrTextBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  if (!chunks.length) return undefined
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return undefined
  const ct = String(request.headers["content-type"] || "").toLowerCase()
  if (ct.includes("application/json") || raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

function augmentResponse(response) {
  response.status = (code) => {
    response.statusCode = code
    return response
  }
  response.json = (payload) => {
    if (!response.headersSent) {
      response.setHeader("Content-Type", "application/json; charset=utf-8")
    }
    response.end(JSON.stringify(payload))
    return response
  }
  response.send = (body) => {
    if (body !== null && typeof body === "object" && !Buffer.isBuffer(body)) {
      return response.json(body)
    }
    response.end(body)
    return response
  }
  return response
}

createServer(async (request, response) => {
  const parsedUrl = new URL(request.url ?? "/", "http://127.0.0.1:3000")
  const requestPath = decodeURIComponent(parsedUrl.pathname)
  // Vercel injects these telemetry endpoints in production. The static preview
  // has no collector, and returning 204 keeps browser checks about this app
  // rather than about an intentionally absent Vercel runtime service.
  if (requestPath.startsWith("/_vercel/")) {
    response.writeHead(204)
    response.end()
    return
  }

  const backendMatch = resolveBackendRoute(requestPath)
  if (backendMatch) {
    augmentResponse(response)
    if (backendMatch.notFoundApi) {
      response.status(404).json({ success: false, ok: false, error: "Not found" })
      return
    }
    try {
      const modUrl = pathToFileURL(join(repoRoot, backendMatch.file)).href
      const mod = await import(modUrl)
      const handler = mod.default || mod
      const queryObj = Object.fromEntries(parsedUrl.searchParams.entries())
      request.query = { ...queryObj, ...backendMatch.extraQuery }
      if (request.headers["x-stats-key"] && process.env.STATS_KEY) {
        request.headers["x-stats-key"] = process.env.STATS_KEY
      }
      const disableBodyParser = mod.config?.api?.bodyParser === false
      if (!disableBodyParser && request.method && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        request.body = await readJsonOrTextBody(request)
      }
      await handler(request, response)
      if (!response.writableEnded) {
        response.end()
      }
    } catch (err) {
      if (!response.headersSent) {
        response.status(500).json({
          success: false,
          ok: false,
          error: err && err.message ? err.message : "Internal server error",
        })
      } else if (!response.writableEnded) {
        response.end()
      }
    }
    return
  }

  const relativePath = routes.get(requestPath) || join("Frontend", requestPath)
  const filePath = normalize(join(repoRoot, relativePath))

  if (relative(repoRoot, filePath).startsWith("..")) {
    response.writeHead(403)
    response.end("Forbidden")
    return
  }

  try {
    const stats = statSync(filePath)
    if (!stats.isFile()) throw new Error("Not a file")
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    })
    createReadStream(filePath).pipe(response)
  } catch {
    response.writeHead(404)
    response.end("Not found")
  }
}).listen(3000, "127.0.0.1", () => {
  console.log("Frontend server running at http://127.0.0.1:3000")
})
  
