import { describe, test, expect } from "vitest";
import { handleMcpHttp } from "../server/mcp-http";

const LOCAL = { address: "127.0.0.1" };
const URL_MCP = "http://localhost:4780/mcp";

const post = (body: unknown, headers: Record<string, string> = {}, peer = LOCAL) =>
  handleMcpHttp(
    new Request(URL_MCP, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    peer,
  );

const rpc = (method: string, params?: any, id: any = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("MCP over HTTP", () => {
  test("ignores paths that are not the endpoint", async () => {
    const res = await handleMcpHttp(new Request("http://localhost:4780/api/state"), LOCAL);
    expect(res).toBeNull();
  });

  test("initialize answers with the server's identity and echoes the protocol version", async () => {
    const res = (await post(rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {} })))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("table");
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  test("tools/list returns tools with schemas", async () => {
    const res = (await post(rpc("tools/list")))!;
    const body = await res.json();
    expect(body.result.tools.length).toBeGreaterThan(0);
    for (const t of body.result.tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema.type).toBe("object");
    }
    // the tools the agent actually plays with
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toContain("get_state");
  });

  test("ping is answered", async () => {
    const res = (await post(rpc("ping")))!;
    expect((await res.json()).result).toEqual({});
  });

  test("a notification gets 202 and no body", async () => {
    const res = (await post({ jsonrpc: "2.0", method: "notifications/initialized" }))!;
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  test("a batch of notifications is also 202", async () => {
    const res = (await post([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "notifications/cancelled" },
    ]))!;
    expect(res.status).toBe(202);
  });

  test("a batch with a request answers with an array", async () => {
    const res = (await post([rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", undefined, 2)]))!;
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((m: any) => m.id)).toEqual([1, 2]);
  });

  test("an unknown method is a JSON-RPC error, not an HTTP one", async () => {
    const res = (await post(rpc("resources/list")))!;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  test("GET and DELETE are 405 with an Allow header", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = (await handleMcpHttp(new Request(URL_MCP, { method }), LOCAL))!;
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toContain("POST");
    }
  });

  test("only this machine may talk to the endpoint", async () => {
    const res = (await post(rpc("tools/list"), {}, { address: "192.168.1.50" }))!;
    expect(res.status).toBe(403);
  });

  test("a foreign Origin is refused (DNS rebinding)", async () => {
    const res = (await post(rpc("tools/list"), { Origin: "http://evil.example.com" }))!;
    expect(res.status).toBe(403);
  });

  test("a localhost Origin is fine, and so is none at all", async () => {
    expect((await post(rpc("ping"), { Origin: "http://localhost:4780" }))!.status).toBe(200);
    expect((await post(rpc("ping")))!.status).toBe(200);
  });

  test("malformed JSON is a 400", async () => {
    const res = (await post("{not json"))!;
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  test("protocol version header: dates pass, junk is a 400", async () => {
    expect((await post(rpc("ping"), { "MCP-Protocol-Version": "2025-11-25" }))!.status).toBe(200);
    expect((await post(rpc("ping"), { "MCP-Protocol-Version": "2099-01-01" }))!.status).toBe(200);
    expect((await post(rpc("ping"), { "MCP-Protocol-Version": "banana" }))!.status).toBe(400);
  });

  test("a client that only takes SSE gets an event stream", async () => {
    const res = (await post(rpc("ping"), { Accept: "text/event-stream" }))!;
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: message");
    expect(JSON.parse(text.split("data: ")[1]).result).toEqual({});
  });

  test("the trailing-slash form of the endpoint works too", async () => {
    const res = await handleMcpHttp(
      new Request("http://localhost:4780/mcp/", { method: "POST", headers: { Accept: "application/json" }, body: JSON.stringify(rpc("ping")) }),
      LOCAL,
    );
    expect(res!.status).toBe(200);
  });
});
