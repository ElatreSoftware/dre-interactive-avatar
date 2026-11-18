/**
 * A two-origin static server for the embedding tests.
 *
 * Cross-origin behaviour — `frame-ancestors`, the `allow` attribute, the
 * postMessage handshake — cannot be observed from a single origin, so the
 * fixtures are served from ports of their own. `127.0.0.1` and `localhost` are
 * different origins to a browser even on the same port, which is the cheap way
 * to get a second one.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[2] ?? 4321);
const WIDGET_ORIGIN = process.env.WIDGET_ORIGIN ?? "http://localhost:3000";

createServer(async (request, response) => {
  const [pathname] = (request.url ?? "/").split("?");
  const name = (pathname ?? "").replace(/^\/+/, "") || "host.html";
  // Fixtures only: no traversal, no subdirectories.
  if (!/^[a-z0-9_-]+\.html$/i.test(name)) {
    response.writeHead(404).end("not found");
    return;
  }
  try {
    const file = await readFile(new URL(name, `file://${DIRECTORY}`), "utf8");
    const body = file.replaceAll("__WIDGET_ORIGIN__", WIDGET_ORIGIN);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(PORT);
