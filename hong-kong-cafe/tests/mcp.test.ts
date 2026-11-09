import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { processMcpPayload } from "../src/mcp/server";

const AUTH_HEADERS = {
  Authorization: "Bearer test-token",
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const TEST_ENV = {} as never;
const TOOL_CONTEXT = { env: TEST_ENV };
const previousToken = process.env.MCP_API_KEY;

beforeAll(() => {
  process.env.MCP_API_KEY = "test-token";
});

afterAll(() => {
  if (previousToken === undefined) {
    delete process.env.MCP_API_KEY;
  } else {
    process.env.MCP_API_KEY = previousToken;
  }
});

async function postMcp(body: unknown, headers = AUTH_HEADERS) {
  return app.request(
    "http://localhost/mcp",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    TEST_ENV,
  );
}

describe("MCP endpoint", () => {
  it("rejects missing or incorrect bearer credentials", async () => {
    const response = await postMcp(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { "Content-Type": "application/json" },
    );

    expect(response.status).toBe(401);
  });

  it("initializes with a supported protocol version", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });
    const body = (await response.json()) as {
      result: { protocolVersion: string; capabilities: unknown };
    };

    expect(response.status).toBe(200);
    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.capabilities).toEqual({
      tools: { listChanged: false },
    });
  });

  it("lists and calls the restaurant info tool", async () => {
    const listResponse = await postMcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const listBody = (await listResponse.json()) as {
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };
    expect(listBody.result.tools.map((tool) => tool.name)).toContain(
      "get_restaurant_info",
    );

    const callResponse = await postMcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_restaurant_info",
        arguments: { topic: "address" },
      },
    });
    const callBody = (await callResponse.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };

    expect(callBody.result.isError).toBeUndefined();
    const result = JSON.parse(callBody.result.content[0]!.text) as {
      ok: boolean;
      value: string;
    };
    expect(result.ok).toBe(true);
    expect(result.value).toContain("Central");
  });

  it("returns a tool error for invalid arguments", async () => {
    const response = await processMcpPayload(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "get_restaurant_info",
          arguments: { topic: "menu" },
        },
      },
      TOOL_CONTEXT,
    );

    expect(response.failed).toBe(true);
    expect(response.body).toMatchObject({
      result: { isError: true },
    });
  });

  it("handles notification-only requests with 202", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(response.status).toBe(202);
  });
});
