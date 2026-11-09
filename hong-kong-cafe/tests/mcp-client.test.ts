import { createServer, type IncomingMessage } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app } from "../src/app";

const originalToken = process.env.MCP_API_KEY;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

async function bodyFrom(request: IncomingMessage): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  process.env.MCP_API_KEY = "test-token";
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await bodyFrom(request);
      const webRequest = new Request(url, {
        method: request.method,
        headers: request.headers as HeadersInit,
        body,
      });
      const webResponse = await app.fetch(webRequest, {} as never);

      response.statusCode = webResponse.status;
      webResponse.headers.forEach((value, key) => response.setHeader(key, value));
      response.end(Buffer.from(await webResponse.arrayBuffer()));
    } catch {
      response.statusCode = 500;
      response.end("internal error");
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind test MCP server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (originalToken === undefined) delete process.env.MCP_API_KEY;
  else process.env.MCP_API_KEY = originalToken;
});

describe("official MCP client transport", () => {
  it("initializes, lists tools, and calls a tool over HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: {
          headers: { Authorization: "Bearer test-token" },
        },
      },
    );
    const client = new Client({
      name: "hong-kong-cafe-test",
      version: "1.0.0",
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "get_restaurant_info",
          "check_availability",
          "create_reservation",
        ]),
      );

      const result = await client.callTool({
        name: "get_restaurant_info",
        arguments: { topic: "hours" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text" }),
        ]),
      );
    } finally {
      await client.close();
    }
  });
});
