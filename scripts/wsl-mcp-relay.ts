import {
  createServer,
  request as upstreamRequest,
  type OutgoingHttpHeaders,
} from "node:http";
import { isIP } from "node:net";

const listenHost = process.env.TRUTHLEASE_WSL_RELAY_HOST;
const listenPort = Number(process.env.TRUTHLEASE_WSL_RELAY_PORT ?? 18_787);
const upstreamUrl = new URL("http://127.0.0.1:8787");

function isPrivateIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  return (
    octets[0] === 10
    || (octets[0] === 172 && octets[1] !== undefined && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
  );
}

if (listenHost === undefined || !isPrivateIpv4(listenHost)) {
  throw new Error("TRUTHLEASE_WSL_RELAY_HOST must be the exact private IPv4 address of the WSL virtual interface.");
}
if (!Number.isSafeInteger(listenPort) || listenPort < 1024 || listenPort > 65_535) {
  throw new Error("TRUTHLEASE_WSL_RELAY_PORT must be an unprivileged TCP port.");
}

const server = createServer((request, response) => {
  if (request.url !== "/mcp" || !["POST", "GET", "DELETE"].includes(request.method ?? "")) {
    response.writeHead(404, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ error: "Only the TruthLease MCP path is relayed." }));
    return;
  }

  const headers: OutgoingHttpHeaders = { ...request.headers, host: upstreamUrl.host };
  delete headers.origin;
  delete headers.referer;
  delete headers["x-forwarded-for"];
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];

  const upstream = upstreamRequest({
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: "/mcp",
    method: request.method,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
    }
    response.end(JSON.stringify({ error: "The loopback TruthLease MCP is unavailable." }));
  });
  request.pipe(upstream);
});

server.on("upgrade", (_request, socket) => socket.destroy());
server.on("connect", (_request, socket) => socket.destroy());
server.listen(listenPort, listenHost, () => {
  console.log(`TruthLease WSL MCP relay listening on http://${listenHost}:${listenPort}/mcp`);
});
