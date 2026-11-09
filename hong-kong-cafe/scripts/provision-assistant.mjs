import { writeFile } from "node:fs/promises";
import {
  buildAssistantConfig,
  mcpServerConfig,
  sharedToolSpecs,
  SHARED_TOOL_NAMES,
} from "../workflow/assistant-config.mjs";

const apiKey = process.env.TELNYX_API_KEY;
const mcpApiKey = process.env.MCP_API_KEY;
const functionUrl = process.env.FUNCTION_URL;
const apiBase = "https://api.telnyx.com/v2";
const integrationSecretIdentifier = "hong-kong-cafe-mcp-key";

if (!apiKey) {
  console.error("TELNYX_API_KEY is required");
  process.exit(1);
}
if (!mcpApiKey) {
  console.error("MCP_API_KEY is required");
  process.exit(1);
}
if (!functionUrl) {
  console.error("FUNCTION_URL is required");
  process.exit(1);
}

async function api(path, method = "GET", body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail ?? payload?.detail ?? response.status;
    throw new Error(`${method} ${path} failed (${response.status}): ${detail}`);
  }

  return payload;
}

function listData(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

const toolsPayload = await api("/ai/tools");
const existingTools = listData(toolsPayload);
const hangupTool = existingTools.find((tool) => tool.type === "hangup");
if (!hangupTool) {
  throw new Error("No shared hangup tool exists in this Telnyx account");
}

const secretsPayload = await api("/integration_secrets");
let secret = listData(secretsPayload).find(
  (item) => item.identifier === integrationSecretIdentifier,
);
if (!secret) {
  secret = await api("/integration_secrets", "POST", {
    identifier: integrationSecretIdentifier,
    type: "bearer",
    token: mcpApiKey,
  });
}

const mcpConfig = mcpServerConfig(functionUrl);
const mcpPayload = await api("/ai/mcp_servers");
let mcpServer = listData(mcpPayload).find(
  (server) => server.name === mcpConfig.name,
);
if (mcpServer) {
  mcpServer = await api(`/ai/mcp_servers/${mcpServer.id}`, "PUT", {
    ...mcpConfig,
    id: mcpServer.id,
    api_key_ref: integrationSecretIdentifier,
  });
} else {
  mcpServer = await api("/ai/mcp_servers", "POST", {
    ...mcpConfig,
    api_key_ref: integrationSecretIdentifier,
  });
}

const sharedToolIds = {};
const refreshedTools = listData(await api("/ai/tools"));
for (const spec of sharedToolSpecs(functionUrl)) {
  const existing = refreshedTools.find(
    (tool) => tool.display_name === spec.display_name,
  );
  const tool = existing
    ? await api(`/ai/tools/${existing.id}`, "PATCH", spec)
    : await api("/ai/tools", "POST", spec);

  const stage = Object.entries(SHARED_TOOL_NAMES).find(
    ([, displayName]) => displayName === spec.display_name,
  )?.[0];
  if (!stage) throw new Error(`Unknown shared tool ${spec.display_name}`);
  sharedToolIds[stage] = tool.id;
}

const assistantConfig = buildAssistantConfig({
  functionUrl,
  mcpServerId: mcpServer.id,
  sharedToolIds,
  hangupToolId: hangupTool.id,
});

const assistants = listData(await api("/ai/assistants"));
let assistant = assistants.find(
  (candidate) => candidate.name === assistantConfig.name,
);
assistant = assistant
  ? await api(`/ai/assistants/${assistant.id}`, "POST", assistantConfig)
  : await api("/ai/assistants", "POST", assistantConfig);

const generated = {
  created_at: new Date().toISOString(),
  function_url: functionUrl,
  assistant_id: assistant.id,
  assistant_name: assistant.name,
  mcp_server_id: mcpServer.id,
  mcp_server_url: mcpServer.url,
  shared_tool_ids: sharedToolIds,
  hangup_tool_id: hangupTool.id,
};

await writeFile(
  new URL("../workflow/generated-resources.json", import.meta.url),
  `${JSON.stringify(generated, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      assistant_id: assistant.id,
      mcp_server_id: mcpServer.id,
      shared_tool_ids: sharedToolIds,
      phone_number: "not assigned",
    },
    null,
    2,
  ),
);
