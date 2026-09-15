// The MCP endpoint, spoken over HTTP on the table's own port.
//
// Why this exists: the stdio transport makes the client launch a process, which
// means the config has to name a program on disk — bun plus a checkout, or the
// packaged binary inside the app bundle. Both are per-machine paths, so no
// single config works for everyone. An HTTP endpoint on a port the app already
// owns needs no paths at all:
//
//   { "mcpServers": { "table": { "type": "http", "url": "http://localhost:4780/mcp" } } }
//
// `mtg-server mcp` (stdio) still works for checkouts and for anyone who prefers
// it; both transports share the dispatch in mcp-tools.ts.
//
// Implements the Streamable HTTP transport from MCP 2025-06-18:
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
import { handleMessage } from "./mcp-tools";

/** Checked against 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25 (the one
 * Claude Code sends). The spec says an unsupported version MUST be a 400, but
 * rejecting every future date would break this server the day a new revision
 * ships, and the four methods it implements — initialize, ping, tools/list and
 * tools/call — have not changed across those revisions. So any well-formed date
 * is accepted and only a malformed header is refused. */
const VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** The transport's security section: servers MUST validate Origin to stop DNS
 * rebinding, and SHOULD bind loopback. The table binds every interface on
 * purpose (you might open it from a phone), so the MCP endpoint does the
 * equivalent check itself: the peer has to be this machine. */
function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a.startsWith("127.");
}

function originAllowed(origin: string | null): boolean {
  if (!origin || origin === "null") return true; // non-browser clients send none
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A JSON-RPC error with no id, for failures that happen before dispatch. */
const rpcError = (message: string, status: number, code = -32600) =>
  json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);

/** One response, as an SSE stream — for clients that ask only for
 * text/event-stream. The spec has the server close the stream after the
 * response, so there is nothing to keep open. */
function sse(payload: unknown): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export interface McpPeer {
  /** the remote address, from Bun's srv.requestIP(req) */
  address?: string;
}

/**
 * Handle one request to the MCP endpoint. Returns null when the path isn't
 * ours, so the caller can carry on routing.
 */
export async function handleMcpHttp(req: Request, peer: McpPeer): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== "/mcp" && url.pathname !== "/mcp/") return null;

  if (!isLoopback(peer.address)) {
    return rpcError("the MCP endpoint only answers this machine", 403, -32001);
  }
  if (!originAllowed(req.headers.get("origin"))) {
    return rpcError("bad Origin", 403, -32001);
  }

  const version = req.headers.get("mcp-protocol-version");
  if (version && !VERSION_SHAPE.test(version)) {
    return rpcError(`malformed MCP-Protocol-Version ${version}`, 400);
  }

  // GET would open a stream for server-initiated messages; this server never
  // sends any, and the spec's answer for that is 405.
  if (req.method === "GET" || req.method === "DELETE") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: "POST, OPTIONS",
        "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
        "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Accept",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return rpcError("malformed JSON", 400, -32700);
  }

  // A batch is allowed to mix requests and notifications; a lone message is the
  // common case. Notifications get no reply, so a batch of only those is a 202
  // like a single one.
  const batch = Array.isArray(body);
  const messages: any[] = batch ? body : [body];
  if (batch && messages.length === 0) return rpcError("empty batch", 400);

  const responses: any[] = [];
  for (const msg of messages) {
    const res = await handleMessage(msg);
    if (res) responses.push(res);
  }

  if (responses.length === 0) {
    // every message was a notification or a response: "MUST return HTTP 202
    // Accepted with no body"
    return new Response(null, { status: 202 });
  }

  const payload = batch ? responses : responses[0];
  const accept = req.headers.get("accept") ?? "";
  const wantsJson = accept.includes("application/json") || accept.includes("*/*") || accept === "";
  return wantsJson ? json(payload) : sse(payload);
}
