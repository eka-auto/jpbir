import { createServer } from "node:http"
import { createReadStream, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"

const root = join(process.cwd(), "Frontend")
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
  const relativePath = requestPath === "/" ? "/index.html" : requestPath
  const filePath = normalize(join(root, relativePath))

  if (!filePath.startsWith(root)) {
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
}).listen(3000, "localhost", () => {
  console.log("Frontend server running at http://localhost:3000")
})
  
