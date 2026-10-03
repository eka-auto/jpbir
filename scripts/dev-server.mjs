import { createServer } from "node:http"
import { createReadStream, statSync } from "node:fs"
import { extname, join, normalize, relative } from "node:path"

const repoRoot = process.cwd()
const frontendRoot = join(repoRoot, "Frontend")
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

createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url ?? "/").split("?")[0])
  // Vercel injects these telemetry endpoints in production. The static preview
  // has no collector, and returning 204 keeps browser checks about this app
  // rather than about an intentionally absent Vercel runtime service.
  if (requestPath.startsWith("/_vercel/")) {
    response.writeHead(204)
    response.end()
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
  
