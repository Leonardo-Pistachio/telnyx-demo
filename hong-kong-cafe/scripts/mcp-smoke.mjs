import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const token = process.env.MCP_API_KEY;

if (!url || !token) {
  console.error("MCP_URL and MCP_API_KEY are required");
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: { Authorization: `Bearer ${token}` },
  },
});

const client = new Client({
  name: "hong-kong-cafe-smoke",
  version: "1.0.0",
});

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const result = await client.callTool({
    name: "get_restaurant_info",
    arguments: { topic: "address" },
  });

  console.log(
    JSON.stringify(
      {
        protocolVersion: transport.protocolVersion,
        tools: listed.tools.map((tool) => tool.name).sort(),
        toolResult: result.content,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
