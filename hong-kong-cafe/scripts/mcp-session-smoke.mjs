import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const token = process.env.MCP_API_KEY;
const sessionToken = process.env.SMOKE_SESSION_TOKEN;

if (!url || !token || !sessionToken) {
  console.error("MCP_URL, MCP_API_KEY, and SMOKE_SESSION_TOKEN are required");
  process.exit(1);
}

function parseToolResult(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Tool returned no text content");
  return JSON.parse(text);
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({
  name: "hong-kong-cafe-session-smoke",
  version: "1.0.0",
});

async function call(name, args) {
  return parseToolResult(await client.callTool({ name, arguments: args }));
}

try {
  await client.connect(transport);

  const counts = [];
  for (let index = 0; index < 3; index += 1) {
    counts.push(
      await call("record_misunderstanding", {
        session_token: sessionToken,
        stage: "confirmation",
      }),
    );
  }

  if (
    counts[0]?.count !== 1 ||
    counts[1]?.count !== 2 ||
    counts[2]?.count !== 3 ||
    counts[2]?.should_escalate !== true
  ) {
    throw new Error(`Misunderstanding threshold failed: ${JSON.stringify(counts)}`);
  }

  const firstCallback = await call("request_callback", {
    session_token: sessionToken,
    phone: "+85290000000",
    name: "Session Smoke",
  });
  const secondCallback = await call("request_callback", {
    session_token: sessionToken,
    phone: "+85290000000",
    name: "Session Smoke",
  });

  if (
    firstCallback.status !== "saved" ||
    secondCallback.status !== "already_saved"
  ) {
    throw new Error(
      `Callback idempotency failed: ${JSON.stringify({
        firstCallback,
        secondCallback,
      })}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        misunderstanding_counts: counts.map((result) => result.count),
        escalated: counts[2].should_escalate,
        callback_first: firstCallback.status,
        callback_retry: secondCallback.status,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
