# Hong Kong Cafe Voice Assistant

A Telnyx voice-assistant POC for a fictional Hong Kong restaurant. Callers can book a table,
ask about opening hours, the address, or the dinner menu, and request a callback when they
cannot be understood or the restaurant is unavailable. Availability, bookings, call sessions,
and callbacks are backed by Telnyx Edge primitives.

The backend and MCP server are deployed and live-verified. The Telnyx Assistant and 13-node
workflow are provisioned, but no phone number is assigned because provisioning was explicitly
deferred. Real phone calls, Telnyx-signed dynamic-variable delivery, and the full spoken
workflow are therefore still unverified; do not present the phone demo as complete.

## What is implemented

- Public MCP Streamable HTTP endpoint with bearer authentication and six tools.
- Telnyx Assistant and 13-node Conversation Workflow provisioned through the API, including
  speak nodes, scoped prompt nodes, deterministic misunderstanding tool nodes, and conditional
  expression/LLM edges.
- Signed dynamic-variables webhook with KV-backed reservation and call-support routing.
- Hong Kong timezone slot generation, 90-minute reservations, capacity checks, same-day and
  next-day alternatives.
- One `DayBookings` Stateful Actor per date, with SQLite, `transactionSync`, idempotency, and
  concurrent last-seat protection.
- One `CallSession` Stateful Actor per trusted call ID for the misunderstanding threshold.
- Random call-session and booking-selection tokens stored in KV. Model-generated call IDs are
  never trusted.
- Write-once callback records with a 30-day TTL.
- Signed shared-webhook endpoints for deterministic workflow misunderstanding nodes.
- Structured logs, dependency-aware readiness checks, tests, deployment scripts, and a real
  debugging log.

## Architecture

```text
Caller
  |
  v
Telnyx AI Assistant / Conversation Workflow
  |                   |                         |
  | dynamic vars      | MCP tools               | deterministic shared-tool nodes
  v                   v                         v
GET/POST signed       POST /mcp                 POST /webhook/misunderstanding/:stage
webhook               (bearer auth)             (Telnyx Ed25519 signature)
  \                   |                         /
   +------------------+------------------------+
                      |
                      v
              Hono Edge Function
                      |
        +-------------+-------------+
        |             |             |
        v             v             v
   src/core       DayBookings    CallSession
   pure logic     actor/date     actor/call
        |             |             |
        +-------------+-------------+
                      |
                      v
      Telnyx KV: feature flag, session tokens,
      booking-selection tokens, callbacks
```

The business logic under `src/core/` is HTTP-independent so both the MCP server and shared
webhook tools use the same reservation and escalation rules.

## MCP interface

Endpoint: `POST <function-url>/mcp`

Authentication: `Authorization: Bearer <MCP_API_KEY>`.

| Tool | Purpose |
| --- | --- |
| `get_restaurant_info` | Hours or address |
| `get_daily_menu` | Dinner menu for today or a given date |
| `check_availability` | Validate a slot, return alternatives, issue a 10-minute selection token |
| `create_reservation` | Atomically create a reservation using a selection token |
| `record_misunderstanding` | Increment a trusted call session's misunderstanding count |
| `request_callback` | Save an idempotent callback request |

The server supports MCP `initialize`, `tools/list`, and `tools/call` over stateless HTTP
JSON-RPC.

## Telnyx-signed HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /webhook/dynamic-vars` | Return call-start dynamic variables |
| `POST /webhook/misunderstanding/intent` | Record an intent misunderstanding |
| `POST /webhook/misunderstanding/reservation` | Record a reservation misunderstanding |
| `POST /webhook/misunderstanding/confirmation` | Record a confirmation misunderstanding |
| `POST /webhook/misunderstanding/faq` | Record an FAQ misunderstanding |
| `GET /readyz` | Check secrets, KV, and both Actor dependencies |

The misunderstanding routes return `200` below the threshold, `409` at the third failure, and
an operational error otherwise. Each is a distinct shared tool so workflow tool nodes can use
hidden preset fields for the trusted `call_control_id`.

Both signed routes verify `telnyx-signature-ed25519` and `telnyx-timestamp` against the raw
body and reject timestamps outside a five-minute window.

## State design

| State | Storage | Reason |
| --- | --- | --- |
| Reservations | `DayBookings` actor per `YYYY-MM-DD`, embedded SQLite | Atomic capacity check and insert for one date |
| Misunderstanding count | `CallSession` actor per trusted call ID | Serialized read-modify-write |
| Reservation feature flag | KV | Change routing without redeploying |
| Call-session token | KV, 4-hour TTL | Converts opaque tool input into a trusted call identity |
| Booking selection | KV, 10-minute TTL | Binds creation to a server-validated slot and is the idempotency key |
| Callback record | KV, 30-day TTL | Write-once record without a read-modify-write workflow |

## Setup

Requirements:

- Node.js 22.12 or newer.
- `telnyx-edge` v0.5.17 or a newer actor-capable release.
- An authenticated Telnyx account.

```bash
cd hong-kong-cafe
npm install
npm run check
telnyx-edge types
```

The function manifest is `hong-kong-cafe/telnyx.toml`. It declares `DAY_BOOKINGS`,
`CALL_SESSION`, and `CAFE_KV`. `telnyx-env.d.ts` is generated; run `telnyx-edge types` after
changing bindings or exported actor methods.

### Secrets

Secrets are organization-scoped, injected as `process.env` variables at deploy time, and must
be present before shipping:

```bash
telnyx-edge secrets add MCP_API_KEY "<long-random-token>"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "<organization-public-key>"
```

Retrieve the Telnyx public key from `GET https://api.telnyx.com/v2/public_key` (the response
field is `data.public`). Never commit either value. A local `.env.local` containing only the
MCP test token is ignored by git.

Adding or changing a secret requires another deploy.

### KV feature flag

The reservation flow fails closed when the flag is absent. To enable reservations:

```bash
telnyx-edge storage kv key put <kv-namespace-id> feature/reservations_enabled true
```

Set it to `false` to exercise the callback-only dynamic-variable routing path.

## Deploy and provision

```bash
cd hong-kong-cafe
telnyx-edge ship --yes
telnyx-edge list
telnyx-edge ship status hong-kong-cafe --logs
```

After the function URL is live, provision or update the MCP server, four shared webhook
tools, and Assistant:

```bash
cd hong-kong-cafe
set -a
source ../.env.local
set +a
TELNYX_API_KEY="<your-api-key>" \
FUNCTION_URL="https://hong-kong-cafe-ce4e4c94-b.telnyxcompute.com" \
npm run provision:assistant
```

The script is idempotent by resource name and writes non-secret resource IDs to the ignored
`workflow/generated-resources.json`. The provisioned Assistant ID is
`assistant-4df34ebc-c6b6-4efa-8996-ecc81b9d9a7b` and the MCP server ID is
`2eb46048-5446-4a39-8254-07de7f656ab0`. No phone number is assigned yet.

Validate the public MCP endpoint with the official MCP client:

```bash
source ../.env.local
MCP_URL="https://hong-kong-cafe-ce4e4c94-b.telnyxcompute.com/mcp" npm run mcp:smoke
```

The CLI monitor can time out while a server-side deploy continues. Check the function status
and deployment JSON before treating it as a failure.

Function: `hong-kong-cafe`
Function ID: `ce4e4c94-b420-4c1c-8135-1619146f7e23`
Assigned invoke URL: `https://hong-kong-cafe-ce4e4c94-b.telnyxcompute.com`

The current revision was deployed successfully after an earlier platform deployment stalled for
about 21 minutes. See `DEBUG_LOG.md` for the evidence trail and actual bugs found.

## Live verification

Verified against the deployed function on 2026-11-09:

- `GET /readyz`: secrets, KV, `DayBookings`, and `CallSession` all healthy.
- Official MCP SDK client: `initialize`, all six `tools/list` entries, and a real
  `get_restaurant_info` `tools/call`.
- Unauthenticated MCP request: `401`; unsigned dynamic-variable and misunderstanding webhooks:
  `403`.
- MCP booking: confirmed, then returned `already_confirmed` on an idempotent retry.
- Two simultaneous last-seat requests: one success and one `slot_taken` conflict.
- Misunderstanding counts: `1`, `2`, `3`, with escalation true at three.
- Callback first save: `saved`; retry: `already_saved`.
- Actor persistence: after two redeploys, the earlier test booking still consumed capacity.
- MCP correlation: a trusted `call_id` was resolved from the opaque session token and logged;
  the token itself was not logged.

The business smoke tests intentionally created reservations for future dates
`2026-11-19` and `2026-11-20` (Hong Kong time). Use other dates for a clean demo.

## Testing

```bash
cd hong-kong-cafe
npm run check   # typecheck followed by all vitest tests
npm test
```

The suite covers timezone and boundary rules, alternatives, contact normalization, callback
idempotency, trusted token mapping, signature validation, dynamic-variables HTTP behavior,
misunderstanding thresholds, workflow graph invariants, an official MCP client transport, and
a local MCP availability-to-booking flow. Actor concurrency, KV behavior, and public MCP
behavior have also been exercised against the deployed function through the smoke scripts.

## Observability

Application logs are JSON lines with timestamp, event, request ID, route, outcome, latency,
masked caller, tool/node when available, and the trusted call ID when an MCP request carries a
resolvable session token. The session token itself is never logged. Key events include:

- `dynamic_variables_resolved`
- `dynamic_variables_rejected`
- `misunderstanding_recorded`
- `misunderstanding_rejected`
- `mcp_request`
- `mcp_rejected`
- `unhandled_request_error`

Useful checks:

```bash
telnyx-edge list
telnyx-edge metrics hong-kong-cafe --since 15m
telnyx-edge metrics hong-kong-cafe --errors
telnyx-edge logs hong-kong-cafe --type invocations --since 15m
telnyx-edge logs hong-kong-cafe --type runtime --since 15m
```

To determine within one minute whether the assistant is broken, check the Edge request/error
metrics first. A jump in 5xx responses or a drop in successful invocations indicates a backend
problem. Then read the corresponding invocation records and runtime JSON logs using the same
time window; filter for `error_code`, `mcp_rejected`, or `dynamic_variables_rejected`. The
call/session correlation is carried by the trusted call ID and opaque session token, never by
logging the token itself. An Assistant-side failure with successful Edge metrics points to
the workflow, tool attachment, or phone configuration instead.

## Security and privacy

- Dynamic variables and shared tool calls require Telnyx Ed25519 signatures.
- The MCP endpoint fails closed without `MCP_API_KEY` and uses constant-time bearer comparison.
- Model-supplied call IDs are resolved through random, expiring KV session tokens.
- Phone numbers are masked in logs. Callback records retain the number only in KV until TTL.
- Secrets, `.env.local`, generated local tooling, and `node_modules` are excluded from git.

## Current limitations

- The Assistant and workflow are provisioned, but no Telnyx phone number is assigned because
  the user deferred provisioning. Phone-oriented live testing is incomplete.
- Telnyx-signed dynamic-variable delivery and the spoken tool-node transitions cannot be fully
  verified until a real phone call is made.
- MCP tools are attached at Assistant level; the current Assistant API cannot select MCP tools
  per workflow node. Node prompt instructions constrain tool use, while deterministic
  shared-tool nodes handle failure routing.
- No staff callback dashboard; callback records are stored for operations/tooling.
- No cancellation, modification, SMS, payments, multi-language support, or weather logic.

## Repository map

```text
PROJECT_BRIEF.md           Requirements and implementation contract
code_challenge.md          Original challenge
DEMO_SCRIPT.md             Live-demo runbook and current prerequisites
DEBUG_LOG.md               Evidence-based development debugging record
AGENTS.md                  Repository commands, architecture, and agent constraints
hong-kong-cafe/            Deployable Edge Function
  src/actors/              Stateful Actors
  src/core/                Pure business logic and services
  src/routes/              Hono HTTP endpoints
  src/mcp/                 MCP protocol and tools
  scripts/                 Assistant provisioning and MCP smoke tests
  workflow/                Executable Assistant/workflow configuration
  tests/                   Vitest suite
  telnyx.toml              Edge manifest and bindings
```
