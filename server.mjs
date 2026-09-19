import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const requested = pathname === "/" ? "/index.html" : pathname;
    const safePath = normalize(requested).replace(/^([.][.][/\\])+/, "");
    let filePath = join(root, safePath);

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Acesso negado");
      return;
    }

    const details = await stat(filePath);
    if (details.isDirectory()) filePath = join(filePath, "index.html");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(body);
  } catch {
    response.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"});
    response.end("Arquivo não encontrado");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Cívica disponível em http://localhost:${port}`);
});

