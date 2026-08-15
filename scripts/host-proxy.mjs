import http from "node:http";
import { URL } from "node:url";

const listenHost = process.env.FLUX_RECROOM_PROXY_HOST || "127.0.0.1";
const listenPort = Number(process.env.FLUX_RECROOM_PROXY_PORT || "2059");
const gateway = (process.env.FLUX_RECROOM_GATEWAY_URL || "").trim().replace(/\/+$/, "");
const sessionToken = (process.env.FLUX_RECROOM_SESSION_TOKEN || "").trim();

if (!gateway) {
  console.error("FLUX_RECROOM_GATEWAY_URL is required.");
  process.exit(2);
}
if (!sessionToken) {
  console.error("FLUX_RECROOM_SESSION_TOKEN is required.");
  process.exit(2);
}

const blockedRequestHeaders = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const blockedResponseHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function readBody(req) {
  const chunks = [];
  let total = 0;
  const max = Number(process.env.FLUX_RECROOM_PROXY_BODY_LIMIT || String(32 * 1024 * 1024));
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) throw Object.assign(new Error("request body exceeds proxy limit"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function cleanHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (blockedRequestHeaders.has(key.toLowerCase()) || value == null) continue;
    result[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  result.authorization = `Bearer ${sessionToken}`;
  result["x-flux-recroom-host-proxy"] = "1";
  return result;
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = req.url || "/";

  if (url === "/flux/local-health") {
    return sendJson(res, 200, {
      ok: true,
      service: "flux-recroom-host-proxy",
      gateway,
      targetBuild: "2022-05-19",
      buildId: "8751857",
      sessionConfigured: true,
    });
  }

  try {
    const target = new URL(url, `${gateway}/`);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const response = await fetch(target, {
      method: req.method || "GET",
      headers: cleanHeaders(req.headers),
      body,
      redirect: "manual",
      cache: "no-store",
    });

    const responseBody = Buffer.from(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((value, key) => {
      if (!blockedResponseHeaders.has(key.toLowerCase())) headers[key] = value;
    });
    headers["content-length"] = String(responseBody.length);
    headers["x-flux-proxied"] = "1";

    res.writeHead(response.status, headers);
    if (req.method === "HEAD") res.end();
    else res.end(responseBody);

    if (process.env.FLUX_RECROOM_PROXY_LOG !== "0") {
      console.log(`${req.method || "GET"} ${url} -> ${response.status} (${Date.now() - started}ms)`);
    }
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    console.error(`${req.method || "GET"} ${url} proxy error:`, error instanceof Error ? error.message : error);
    if (!res.headersSent) {
      sendJson(res, statusCode, {
        ok: false,
        error: error instanceof Error ? error.message : "host proxy failed",
      });
    } else {
      res.destroy();
    }
  }
});

server.listen(listenPort, listenHost, () => {
  console.log(`Flux Rec Room host proxy listening on http://${listenHost}:${listenPort}`);
  console.log(`Forwarding to ${gateway} for May 19 2022 build 8751857.`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
