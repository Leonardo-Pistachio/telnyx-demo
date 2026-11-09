import {
  findTool,
  MCP_TOOLS,
  type McpToolContext,
  type McpToolResult,
} from "./tools";

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const LATEST_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export interface McpProcessingResult {
  status: number;
  body?: JsonRpcResponse | JsonRpcResponse[];
  toolNames: string[];
  failed: boolean;
}

function success(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.jsonrpc === "2.0" &&
    typeof candidate.method === "string" &&
    (candidate.id === undefined ||
      candidate.id === null ||
      typeof candidate.id === "string" ||
      typeof candidate.id === "number")
  );
}

async function processRequest(
  request: JsonRpcRequest,
  toolNames: string[],
  sessionTokens: string[],
  context: McpToolContext,
): Promise<JsonRpcResponse | undefined> {
  const id = request.id ?? null;
  const isNotification = request.id === undefined;

  if (request.method === "notifications/initialized") {
    return undefined;
  }

  if (request.method === "ping") {
    return success(id, {});
  }

  if (request.method === "initialize") {
    const params =
      request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : {};
    const requestedVersion =
      typeof params.protocolVersion === "string"
        ? params.protocolVersion
        : LATEST_PROTOCOL_VERSION;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
      requestedVersion,
    )
      ? requestedVersion
      : LATEST_PROTOCOL_VERSION;

    return success(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "hong-kong-cafe", version: "0.1.0" },
      instructions:
        "Hong Kong Cafe reservation and information tools. Do not invent tool results.",
    });
  }

  if (request.method === "tools/list") {
    return success(id, {
      tools: MCP_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  if (request.method === "tools/call") {
    if (!request.params || typeof request.params !== "object") {
      return failure(id, -32602, "Invalid params");
    }

    const params = request.params as Record<string, unknown>;
    if (typeof params.name !== "string") {
      return failure(id, -32602, "Tool name is required");
    }

    const tool = findTool(params.name);
    if (!tool) {
      return failure(id, -32602, "Unknown tool", { tool: params.name });
    }

    toolNames.push(tool.name);

    const argumentsValue = params.arguments ?? {};
    if (
      argumentsValue &&
      typeof argumentsValue === "object" &&
      "session_token" in argumentsValue &&
      typeof argumentsValue.session_token === "string"
    ) {
      sessionTokens.push(argumentsValue.session_token);
    }

    const result = await tool.handler(argumentsValue, context);
    return success(id, result);
  }

  if (isNotification) return undefined;

  return failure(id, -32601, "Method not found", { method: request.method });
}

export async function processMcpPayload(
  payload: unknown,
  context: McpToolContext,
  sessionTokens: string[] = [],
): Promise<McpProcessingResult> {
  const toolNames: string[] = [];

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return {
        status: 400,
        body: failure(null, -32600, "Invalid Request"),
        toolNames,
        failed: true,
      };
    }

    const responses: JsonRpcResponse[] = [];
    let failed = false;

    for (const item of payload) {
      if (!isRequest(item)) {
        failed = true;
        responses.push(failure(null, -32600, "Invalid Request"));
        continue;
      }

      const response = await processRequest(
        item,
        toolNames,
        sessionTokens,
        context,
      );
      if (response) responses.push(response);
      if (response && "error" in response) failed = true;
      if (response && "result" in response && isToolError(response.result)) {
        failed = true;
      }
    }

    if (responses.length === 0) {
      return { status: 202, toolNames, failed };
    }

    return { status: 200, body: responses, toolNames, failed };
  }

  if (!isRequest(payload)) {
    return {
      status: 400,
      body: failure(null, -32600, "Invalid Request"),
      toolNames,
      failed: true,
    };
  }

  const response = await processRequest(
    payload,
    toolNames,
    sessionTokens,
    context,
  );

  if (!response) {
    return { status: 202, toolNames, failed: false };
  }

  if ("error" in response || isToolError(response.result)) {
    return { status: 200, body: response, toolNames, failed: true };
  }

  return { status: 200, body: response, toolNames, failed: false };
}

function isToolError(value: unknown): value is McpToolResult {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).isError === true
  );
}
