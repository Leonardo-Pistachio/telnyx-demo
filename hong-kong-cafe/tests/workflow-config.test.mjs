import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MCP_TOOLS,
  buildAssistantConfig,
  MCP_TOOL_NAMES,
} from "../workflow/assistant-config.mjs";

const config = buildAssistantConfig({
  functionUrl: "https://example.test",
  mcpServerId: "mcp-test",
  sharedToolIds: {
    intent: "tool-intent",
    reservation: "tool-reservation",
    confirmation: "tool-confirmation",
    faq: "tool-faq",
  },
  hangupToolId: "tool-hangup",
});

const flow = config.conversation_flow;
const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));

describe("Assistant workflow configuration", () => {
  it("uses unique IDs and valid edge endpoints", () => {
    expect(nodeById.size).toBe(flow.nodes.length);
    const edgeIds = new Set(flow.edges.map((edge) => edge.id));
    expect(edgeIds.size).toBe(flow.edges.length);
    expect(nodeById.has(flow.start_node_id)).toBe(true);

    for (const edge of flow.edges) {
      expect(nodeById.has(edge.start_node_id)).toBe(true);
      expect(edge.target.type).toBe("node");
      expect(nodeById.has(edge.target.node_id)).toBe(true);
    }
  });

  it("gives every non-terminal speak/tool node exactly one default edge", () => {
    for (const node of flow.nodes) {
      if (node.type !== "speak" && node.type !== "tool") continue;
      const outgoing = flow.edges.filter(
        (edge) => edge.start_node_id === node.id,
      );
      if (node.id === "n_hangup") {
        expect(outgoing).toHaveLength(0);
        continue;
      }

      expect(
        outgoing.filter((edge) => edge.condition.type === "default"),
      ).toHaveLength(1);
    }
  });

  it("routes support failure by variable and leaves the flag to the booking intent", () => {
    const variableEdges = flow.edges.filter(
      (edge) =>
        edge.start_node_id === "n_identify" &&
        edge.condition.type === "expression",
    );

    expect(variableEdges.map((edge) => edge.id)).toEqual([
      "e_identify_support_failure",
    ]);
  });

  it("does not reject before the caller speaks, so FAQ still works", () => {
    const greetingEdges = flow.edges.filter(
      (edge) => edge.start_node_id === "n_greeting",
    );
    expect(greetingEdges.map((edge) => edge.target.node_id)).toEqual([
      "n_technical_failure",
      "n_identify",
    ]);

    const identifyEdges = flow.edges.filter(
      (edge) => edge.start_node_id === "n_identify",
    );
    const closedIndex = identifyEdges.findIndex(
      (edge) => edge.id === "e_identify_reservations_closed",
    );
    const firstBookingIndex = identifyEdges.findIndex(
      (edge) =>
        edge.id === "e_identify_manage" || edge.id === "e_identify_reservation",
    );
    const faq = identifyEdges.find((edge) => edge.id === "e_identify_faq");

    expect(closedIndex).toBeGreaterThanOrEqual(0);
    expect(closedIndex).toBeLessThan(firstBookingIndex);
    expect(faq.target.node_id).toBe("n_faq");
    expect(identifyEdges[closedIndex].target.node_id).toBe(
      "n_reservations_unavailable",
    );
  });

  it("never sends a disabled-reservations route to callback collection", () => {
    const disabledEdges = flow.edges.filter(
      (edge) =>
        edge.condition.type === "expression" &&
        edge.condition.expression.left.name === "reservations_enabled",
    );

    expect(disabledEdges.length).toBeGreaterThan(0);
    for (const edge of disabledEdges) {
      expect(edge.target.node_id).toBe("n_reservations_unavailable");
    }
    expect(nodeById.get("n_reservations_unavailable").type).toBe("speak");
  });

  it("routes every misunderstanding tool by 200, 409, and default", () => {
    const toolNodeIds = [
      "n_intent_unclear",
      "n_reservation_unclear",
      "n_confirmation_unclear",
      "n_manage_unclear",
      "n_faq_unclear",
    ];

    for (const nodeId of toolNodeIds) {
      const outgoing = flow.edges.filter(
        (edge) => edge.start_node_id === nodeId,
      );
      expect(outgoing).toHaveLength(3);
      const statuses = outgoing.flatMap((edge) => {
        const expression = edge.condition.expression;
        if (!expression || expression.type !== "comparison") return [];
        return [expression.right.value];
      });
      expect(statuses).toEqual(["200", "409"]);
      expect(
        outgoing.filter((edge) => edge.condition.type === "default"),
      ).toHaveLength(1);
    }
  });

  it("keeps MCP server surface larger than the Assistant allowlist", () => {
    expect(MCP_TOOL_NAMES).toHaveLength(9);
    expect(ASSISTANT_MCP_TOOLS).toHaveLength(8);
    expect(ASSISTANT_MCP_TOOLS).not.toContain("record_misunderstanding");
    expect(config.mcp_servers[0].allowed_tools).toEqual(
      ASSISTANT_MCP_TOOLS,
    );
  });

  it("fails dynamic-variable defaults closed", () => {
    expect(config.dynamic_variables.call_support_available).toBe("false");
    expect(config.dynamic_variables.reservations_enabled).toBe("false");
    expect(config.dynamic_variables_webhook_timeout_ms).toBe(8000);
  });
});
