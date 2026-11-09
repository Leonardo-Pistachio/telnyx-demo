export const MCP_TOOL_NAMES = [
  "get_restaurant_info",
  "get_daily_menu",
  "check_availability",
  "create_reservation",
  "record_misunderstanding",
  "request_callback",
];

export const ASSISTANT_MCP_TOOLS = [
  "get_restaurant_info",
  "get_daily_menu",
  "check_availability",
  "create_reservation",
  "request_callback",
];

export const SHARED_TOOL_NAMES = {
  intent: "hk-cafe-record-intent-misunderstanding",
  reservation: "hk-cafe-record-reservation-misunderstanding",
  confirmation: "hk-cafe-record-confirmation-misunderstanding",
  faq: "hk-cafe-record-faq-misunderstanding",
};

const ASSISTANT_INSTRUCTIONS = `You are the phone assistant for Hong Kong Cafe.

Current Hong Kong date: {{today_date}}. The restaurant is {{restaurant_name}} at {{restaurant_address}}.

Rules:
- Never invent availability, a reservation, a callback, or restaurant information. Only state success after a successful tool result.
- Use the tools listed in the active workflow node. Do not call unrelated tools.
- Pass exactly {{call_session_token}} as session_token on every MCP tool call when that field is available. Never reveal or invent the token or a call ID.
- Resolve relative dates using the Hong Kong date above. Use YYYY-MM-DD dates and 24-hour HH:mm times with tools.
- Book only after reading back the date, time, party size, name, and phone number and receiving a clear yes.
- A selection_token belongs to one date, time, and party size. If the caller changes any of them, check availability again.
- Party sizes above 10 need a human callback.
- If a tool fails or the result is unknown, say so honestly. Never claim a booking or callback was saved.
- Do not ask for or speak a full phone number in a general greeting. For reservation or callback actions, collect and read it back.
- Keep responses concise and suitable for a phone call.`;

const GREETING_MESSAGE =
  "Thank you for calling {{restaurant_name}}. This call is handled by an AI assistant. How can I help you today?";

const GOODBYE_MESSAGE =
  "Thank you for calling Hong Kong Cafe. Goodbye.";

const TECHNICAL_FAILURE_MESSAGE =
  "I am sorry, but the reservation system is unavailable right now. I cannot safely complete or save this request. Please call back later.";

function llm(prompt) {
  return { type: "llm", prompt };
}

function fallback() {
  return { type: "default" };
}

function variableEquals(name, value) {
  return {
    type: "expression",
    expression: {
      type: "comparison",
      op: "==",
      left: { type: "variable", name },
      right: { type: "string_literal", value },
    },
  };
}

function target(nodeId) {
  return { type: "node", node_id: nodeId };
}

function edge(id, startNodeId, targetNodeId, condition) {
  return {
    id,
    start_node_id: startNodeId,
    target: target(targetNodeId),
    condition,
  };
}

function toolFailureEdges(prefix, toolNodeId, returnNodeId) {
  return [
    edge(
      `e_${prefix}_recorded`,
      toolNodeId,
      returnNodeId,
      variableEquals("telnyx_last_tool_status_code", "200"),
    ),
    edge(
      `e_${prefix}_threshold`,
      toolNodeId,
      "n_escalate",
      variableEquals("telnyx_last_tool_status_code", "409"),
    ),
    edge(
      `e_${prefix}_failure`,
      toolNodeId,
      "n_technical_failure",
      fallback(),
    ),
  ];
}

export function sharedToolSpecs(functionUrl) {
  return Object.entries(SHARED_TOOL_NAMES).map(([stage, displayName]) => ({
    type: "webhook",
    display_name: displayName,
    timeout_ms: 5000,
    webhook: {
      name: `record_${stage}_misunderstanding`,
      description:
        "Deterministically records one failed caller interaction for the trusted call and returns 409 when escalation is required.",
      url: `${functionUrl}/webhook/misunderstanding/${stage}`,
      method: "POST",
      body_parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      preset_body_fields: {
        call_id: "{{call_control_id}}",
      },
    },
  }));
}

export function mcpServerConfig(functionUrl) {
  return {
    name: "hong-kong-cafe",
    type: "http",
    url: `${functionUrl}/mcp`,
    allowed_tools: MCP_TOOL_NAMES,
  };
}

export function buildAssistantConfig({
  functionUrl,
  mcpServerId,
  sharedToolIds,
  hangupToolId,
}) {
  const nodes = [
    {
      id: "n_greeting",
      type: "speak",
      name: "Greeting",
      message: GREETING_MESSAGE,
      position: { x: 0, y: 0 },
    },
    {
      id: "n_identify",
      type: "prompt",
      name: "Identify Intent",
      instructions:
        "Identify whether the caller wants a reservation, restaurant information, a human, or is still unclear. Do not answer the request yet. Ask one short clarifying question if the intent is ambiguous. If it remains unclear after one re-ask, choose the unclear transition.",
      instructions_mode: "append",
      position: { x: 260, y: 0 },
    },
    {
      id: "n_intent_unclear",
      type: "tool",
      name: "Intent Unclear",
      shared_tool_id: sharedToolIds.intent,
      position: { x: 260, y: 180 },
    },
    {
      id: "n_reservation",
      type: "prompt",
      name: "Reservation",
      instructions:
        "Collect the date, time, and party size. Use {{today_date}} to resolve relative dates. Call check_availability for the exact requested date, time, and party size. If it is available, read back the slot and ask whether the caller wants to proceed. If alternatives are returned, offer no more than three and call check_availability again for the alternative the caller selects. Do not create a reservation in this node. Route callers with more than 10 guests or who ask for a human to escalation. If details remain unclear after one re-ask, choose the unclear transition.",
      instructions_mode: "append",
      position: { x: 520, y: 0 },
    },
    {
      id: "n_reservation_unclear",
      type: "tool",
      name: "Reservation Unclear",
      shared_tool_id: sharedToolIds.reservation,
      position: { x: 520, y: 180 },
    },
    {
      id: "n_confirm",
      type: "prompt",
      name: "Confirm Booking",
      instructions:
        "Collect the guest name and phone number. Read back the exact date, time, party size, name, and phone number, and obtain a clear yes. Then call create_reservation with the selection_token from the accepted availability check and the confirmed contact details. If the tool confirms success, tell the caller the reservation is confirmed and choose the booked transition. If the slot was taken, offer the returned alternatives and choose the slot-taken transition. If the result is an operational error or remains unknown after retrying the same selection token once, never claim success and choose the tool-failure transition. If the caller wants a different date or time, choose the change-slot transition. If confirmation remains unclear after one re-ask, choose the unclear transition.",
      instructions_mode: "append",
      position: { x: 780, y: 0 },
    },
    {
      id: "n_confirmation_unclear",
      type: "tool",
      name: "Confirmation Unclear",
      shared_tool_id: sharedToolIds.confirmation,
      position: { x: 780, y: 180 },
    },
    {
      id: "n_faq",
      type: "prompt",
      name: "Answer FAQ",
      instructions:
        "Answer opening hours or address with get_restaurant_info and dinner-menu questions with get_daily_menu. Use the tool result and do not guess. Handle follow-up questions in this node. If the request remains unclear after one re-ask, choose the unclear transition. If the caller asks for a human, choose the human transition. When the caller is finished, choose the finished transition.",
      instructions_mode: "append",
      position: { x: 520, y: -180 },
    },
    {
      id: "n_faq_unclear",
      type: "tool",
      name: "FAQ Unclear",
      shared_tool_id: sharedToolIds.faq,
      position: { x: 520, y: -360 },
    },
    {
      id: "n_escalate",
      type: "prompt",
      name: "Escalate",
      instructions:
        "Apologise briefly and collect a callback phone number. Read it back and obtain confirmation. You may use {{telnyx_end_user_target}} only when the caller confirms that the number they are calling from is best. Call request_callback with {{call_session_token}}, the confirmed phone number, and an optional name. Only after the tool returns ok true say that a team member will call back. If the caller declines a callback, choose the declined transition. If the number cannot be understood after two re-asks or the callback cannot be saved, choose the failure transition and do not claim success.",
      instructions_mode: "append",
      position: { x: 1040, y: 0 },
    },
    {
      id: "n_technical_failure",
      type: "speak",
      name: "Technical Failure",
      message: TECHNICAL_FAILURE_MESSAGE,
      position: { x: 1300, y: 180 },
    },
    {
      id: "n_goodbye",
      type: "speak",
      name: "Goodbye",
      message: GOODBYE_MESSAGE,
      position: { x: 1300, y: 0 },
    },
    {
      id: "n_hangup",
      type: "tool",
      name: "Hangup",
      shared_tool_id: hangupToolId,
      position: { x: 1560, y: 0 },
    },
  ];

  const edges = [
    edge("e_greeting_identify", "n_greeting", "n_identify", fallback()),
    edge(
      "e_identify_support_failure",
      "n_identify",
      "n_technical_failure",
      variableEquals("call_support_available", "false"),
    ),
    edge(
      "e_identify_reservations_disabled",
      "n_identify",
      "n_escalate",
      variableEquals("reservations_enabled", "false"),
    ),
    edge(
      "e_identify_reservation",
      "n_identify",
      "n_reservation",
      llm("The caller wants to make, change, or discuss a table reservation."),
    ),
    edge(
      "e_identify_faq",
      "n_identify",
      "n_faq",
      llm(
        "The caller asks about opening hours, address, dinner menu, or other restaurant information.",
      ),
    ),
    edge(
      "e_identify_human",
      "n_identify",
      "n_escalate",
      llm("The caller explicitly asks to speak with a human or request a callback."),
    ),
    edge(
      "e_identify_unclear",
      "n_identify",
      "n_intent_unclear",
      llm(
        "The caller's supported intent is still unclear after one clarifying re-ask.",
      ),
    ),
    ...toolFailureEdges("intent", "n_intent_unclear", "n_identify"),
    edge(
      "e_reservation_disabled",
      "n_reservation",
      "n_escalate",
      variableEquals("reservations_enabled", "false"),
    ),
    edge(
      "e_reservation_confirm",
      "n_reservation",
      "n_confirm",
      llm(
        "The caller accepted an available date and time from a successful check_availability result.",
      ),
    ),
    edge(
      "e_reservation_large_party",
      "n_reservation",
      "n_escalate",
      llm(
        "The party has more than 10 guests, or the caller explicitly asks for a human.",
      ),
    ),
    edge(
      "e_reservation_unclear",
      "n_reservation",
      "n_reservation_unclear",
      llm(
        "The required date, time, or party size is still unclear after one clarifying re-ask.",
      ),
    ),
    edge(
      "e_reservation_finished",
      "n_reservation",
      "n_goodbye",
      llm("The caller no longer wants to make a reservation."),
    ),
    ...toolFailureEdges(
      "reservation",
      "n_reservation_unclear",
      "n_reservation",
    ),
    edge(
      "e_confirm_disabled",
      "n_confirm",
      "n_escalate",
      variableEquals("reservations_enabled", "false"),
    ),
    edge(
      "e_confirm_booked",
      "n_confirm",
      "n_goodbye",
      llm(
        "create_reservation returned ok true and the confirmed reservation details were read to the caller.",
      ),
    ),
    edge(
      "e_confirm_slot_taken",
      "n_confirm",
      "n_reservation",
      llm(
        "create_reservation returned ok false with code slot_taken and returned fresh alternatives.",
      ),
    ),
    edge(
      "e_confirm_change_slot",
      "n_confirm",
      "n_reservation",
      llm(
        "The caller wants to change the date, time, or party size before booking.",
      ),
    ),
    edge(
      "e_confirm_tool_failure",
      "n_confirm",
      "n_technical_failure",
      llm(
        "create_reservation failed operationally or its result remains unknown after retrying the same selection token once.",
      ),
    ),
    edge(
      "e_confirm_human",
      "n_confirm",
      "n_escalate",
      llm("The caller explicitly asks for a human or callback."),
    ),
    edge(
      "e_confirm_unclear",
      "n_confirm",
      "n_confirmation_unclear",
      llm(
        "The caller has not given a clear yes or no after one confirmation re-ask, or a required contact value is still unclear.",
      ),
    ),
    edge(
      "e_confirm_declined",
      "n_confirm",
      "n_goodbye",
      llm("The caller declines to make the reservation."),
    ),
    ...toolFailureEdges(
      "confirmation",
      "n_confirmation_unclear",
      "n_confirm",
    ),
    edge(
      "e_faq_finished",
      "n_faq",
      "n_goodbye",
      llm("The caller has no more restaurant questions."),
    ),
    edge(
      "e_faq_human",
      "n_faq",
      "n_escalate",
      llm("The caller explicitly asks for a human or callback."),
    ),
    edge(
      "e_faq_unclear",
      "n_faq",
      "n_faq_unclear",
      llm(
        "The caller's restaurant question is still unclear after one clarifying re-ask.",
      ),
    ),
    ...toolFailureEdges("faq", "n_faq_unclear", "n_faq"),
    edge(
      "e_escalate_saved",
      "n_escalate",
      "n_goodbye",
      llm("request_callback returned ok true and the caller was told about the callback."),
    ),
    edge(
      "e_escalate_declined",
      "n_escalate",
      "n_goodbye",
      llm("The caller declines a callback."),
    ),
    edge(
      "e_escalate_failure",
      "n_escalate",
      "n_technical_failure",
      llm(
        "The callback number could not be understood after two re-asks, or request_callback failed and no callback was saved.",
      ),
    ),
    edge(
      "e_technical_goodbye",
      "n_technical_failure",
      "n_goodbye",
      fallback(),
    ),
    edge("e_goodbye_hangup", "n_goodbye", "n_hangup", fallback()),
  ];

  return {
    name: "Hong Kong Cafe",
    description:
      "Phone assistant for table reservations, FAQ, deterministic misunderstanding escalation, and callbacks.",
    model: "moonshotai/Kimi-K2.6",
    instructions: ASSISTANT_INSTRUCTIONS,
    greeting: "",
    enabled_features: ["telephony"],
    dynamic_variables_webhook_url: `${functionUrl}/webhook/dynamic-vars`,
    dynamic_variables_webhook_timeout_ms: 8000,
    dynamic_variables: {
      call_support_available: "false",
      reservations_enabled: "false",
      call_session_token: "",
      today_date: "",
      is_open_now: "false",
      restaurant_name: "Hong Kong Cafe",
      restaurant_address: "12 Example Street, Central, Hong Kong",
    },
    mcp_servers: [
      {
        id: mcpServerId,
        allowed_tools: ASSISTANT_MCP_TOOLS,
      },
    ],
    conversation_flow: {
      start_node_id: "n_greeting",
      nodes,
      edges,
    },
  };
}
