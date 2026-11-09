import { Hono } from "hono";
import { resolveSessionCallId } from "../core/tokens";
import type { AppBindings } from "../env";
import { isAuthorizedBearer } from "../lib/auth";
import { logEvent, newRequestId } from "../lib/logger";
import { getRuntimeSecret } from "../lib/secrets";
import { processMcpPayload } from "../mcp/server";

const MCP_ALLOWED_HEADERS =
  "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID";

export const mcpRoutes = new Hono<{ Bindings: AppBindings }>();

mcpRoutes.options("/mcp", (context) => {
  return context.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": MCP_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  });
});

mcpRoutes.get("/mcp", (context) => {
  return context.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "SSE stream not supported" },
    },
    405,
    { Allow: "POST, OPTIONS" },
  );
});

mcpRoutes.delete("/mcp", (context) => {
  return context.body(null, 405, { Allow: "POST, OPTIONS" });
});

mcpRoutes.post("/mcp", async (context) => {
  const startedAt = performance.now();
  const requestId = newRequestId();
  const expectedToken = getRuntimeSecret("MCP_API_KEY");

  if (!expectedToken) {
    logEvent("error", "mcp_rejected", {
      request_id: requestId,
      route: "POST /mcp",
      outcome: "failed",
      error_code: "not_configured",
      latency_ms: Math.round(performance.now() - startedAt),
    });
    return context.json({ error: "MCP is not configured" }, 503);
  }

  const authorized = await isAuthorizedBearer(
    context.req.header("authorization"),
    expectedToken,
  );

  if (!authorized) {
    logEvent("warn", "mcp_rejected", {
      request_id: requestId,
      route: "POST /mcp",
      outcome: "rejected",
      error_code: "unauthorized",
      latency_ms: Math.round(performance.now() - startedAt),
    });
    return context.json(
      { error: "unauthorized" },
      401,
      { "WWW-Authenticate": 'Bearer realm="hong-kong-cafe-mcp"' },
    );
  }

  let payload: unknown;
  try {
    payload = await context.req.json();
  } catch {
    logEvent("warn", "mcp_rejected", {
      request_id: requestId,
      route: "POST /mcp",
      outcome: "rejected",
      error_code: "bad_json",
      latency_ms: Math.round(performance.now() - startedAt),
    });
    return context.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      400,
    );
  }

  try {
    const sessionTokens: string[] = [];
    const result = await processMcpPayload(
      payload,
      { env: context.env },
      sessionTokens,
    );
    let correlationId: string | undefined;

    for (const token of sessionTokens) {
      try {
        correlationId =
          (await resolveSessionCallId(context.env.CAFE_KV, token)) ??
          undefined;
        if (correlationId) break;
      } catch {
        correlationId = undefined;
      }
    }

    const responseHeaders = {
      "MCP-Protocol-Version": "2025-06-18",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "MCP-Protocol-Version",
    };

    logEvent(result.failed ? "warn" : "info", "mcp_request", {
      request_id: requestId,
      correlation_id: correlationId,
      call_id: correlationId,
      route: "POST /mcp",
      tool: result.toolNames.join(",") || undefined,
      node: "mcp",
      outcome: result.failed ? "failed" : "success",
      error_code: result.failed ? "mcp_error" : undefined,
      latency_ms: Math.round(performance.now() - startedAt),
    });

    if (!result.body) {
      return context.body(null, result.status as 202, responseHeaders);
    }

    return context.json(result.body, result.status as 200, responseHeaders);
  } catch {
    logEvent("error", "mcp_request", {
      request_id: requestId,
      route: "POST /mcp",
      node: "mcp",
      outcome: "failed",
      error_code: "unexpected_failure",
      latency_ms: Math.round(performance.now() - startedAt),
    });
    return context.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "Internal error" },
      },
      500,
      { "Access-Control-Allow-Origin": "*" },
    );
  }
});
