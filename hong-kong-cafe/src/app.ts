import { Hono } from "hono";
import { RESERVATIONS_FLAG_KEY } from "./core/dynamic-variables";
import type { AppBindings } from "./env";
import { logEvent, newRequestId } from "./lib/logger";
import { getRuntimeSecret } from "./lib/secrets";
import { dynamicVariablesRoutes } from "./routes/dynamic-vars";
import { mcpRoutes } from "./routes/mcp";
import { misunderstandingRoutes } from "./routes/misunderstanding";

export const app = new Hono<{ Bindings: AppBindings }>();

app.get("/", (context) => {
  return context.json({
    service: "hong-kong-cafe",
    status: "ok",
    endpoints: [
      "/readyz",
      "/webhook/dynamic-vars",
      "/webhook/misunderstanding/:stage",
      "/mcp",
    ],
  });
});

app.get("/healthz", (context) => {
  return context.json({ status: "ok" });
});

app.get("/readyz", async (context) => {
  const checks = {
    secrets: false,
    kv: false,
    day_bookings: false,
    call_session: false,
  };

  checks.secrets = Boolean(
    getRuntimeSecret("MCP_API_KEY") && getRuntimeSecret("TELNYX_PUBLIC_KEY"),
  );

  try {
    await context.env.CAFE_KV.get(RESERVATIONS_FLAG_KEY);
    checks.kv = true;
  } catch {
    checks.kv = false;
  }

  try {
    await context.env.DAY_BOOKINGS.idFromName("2000-01-01").reservationCount();
    checks.day_bookings = true;
  } catch {
    checks.day_bookings = false;
  }

  try {
    await context.env.CALL_SESSION.idFromName("readiness").misunderstandingCount();
    checks.call_session = true;
  } catch {
    checks.call_session = false;
  }

  const ready = Object.values(checks).every(Boolean);
  if (!ready) {
    logEvent("error", "readiness_failed", {
      request_id: newRequestId(),
      route: "GET /readyz",
      outcome: "failed",
      error_code: "dependency_unavailable",
    });
  }

  return context.json(
    {
      status: ready ? "ready" : "degraded",
      checks,
    },
    ready ? 200 : 503,
  );
});

app.route("/", dynamicVariablesRoutes);
app.route("/", mcpRoutes);
app.route("/", misunderstandingRoutes);

app.notFound((context) => {
  return context.json({ error: "not found" }, 404);
});

app.onError((error, context) => {
  const requestId = newRequestId();
  logEvent("error", "unhandled_request_error", {
    request_id: requestId,
    route: `${context.req.method} ${new URL(context.req.url).pathname}`,
    outcome: "failed",
    error_code: error.name || "unexpected_failure",
  });

  return context.json({ error: "internal error", request_id: requestId }, 500);
});
