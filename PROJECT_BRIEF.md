# PROJECT_BRIEF.md

> Read together with `AGENTS.md` and `code_challenge.md`. If this file conflicts with
> `code_challenge.md`, flag the conflict instead of silently picking one.
> Values marked **PLACEHOLDER** are demo data and can be edited freely.
> Revision 4: nine MCP tools, 16-node workflow, callbacks stored in the `CallSession` actor,
> and the US phone number assigned. See the scaffold at `hong-kong-cafe/`.

## 1. Goal

A phone-callable AI assistant for a fictional restaurant, **Hong Kong Cafe**, built as a
simple POC on Telnyx (AI Assistant + Conversation Workflow + Edge Function).

The assistant can:

1. **Take table reservations** (main goal).
   - If the requested time is full, suggest sensible alternative times **on the same date**.
   - If the whole date is full, suggest the **following day(s)**.
2. **Answer restaurant questions**: opening hours, today's dinner menu, address.
3. **Escalate**: if the assistant fails to understand the caller **3 times**, ask for a
   phone number, save a callback request, and end politely. A human calls back later.

## 2. Scope

### In scope (required submission)
- Conversation Workflow (speak nodes, prompt nodes, deterministic tool nodes, conditional edges)
- Dynamic variables webhook on a Telnyx Edge Function; the reservation flag must affect routing
- Public, authenticated MCP server exposing the nine tools in section 9
- Reservation logic (availability, booking, alternatives)
- FAQ answers (hours, menu of the day, address)
- Misunderstanding counter + callback request
- Storage on Telnyx primitives (Actors, KV, static data), see section 8
- Structured logging on every webhook/tool call and an operational metrics signal
- Live phone testing, README, architecture diagram, demo script, debugging story

### Out of scope
- Other stretch goals from `code_challenge.md`
- Cancel reservations, SMS confirmations, payments, multi-language
- Staff dashboard or cross-date reservation listing
- Standalone databases, ORM, queues, or external application hosting

### POC demo update (post-brief)
At the owner's request, the demo was later extended with:
- a deterministic weather tool for outdoor seating (weekend = rainy/closed,
  weekday = sunny/open),
- inside/outside seating preference and a special-occasion remark on bookings,
- guarded booking lookup and date-only changes by name/surname + phone + current date,
- a best-effort Resend email summary to `BOOKING_NOTIFICATION_EMAIL`.

These additions do not remove any mandatory Phase 1 path.

Keep business logic in plain TypeScript modules (`src/core/`) with no HTTP code so the
MCP and shared-webhook adapters use the same rules. MCP is not optional and must be part
of the deployed Phase 1 path.

## 3. Tech stack

| Concern | Choice | Note |
|---|---|---|
| Language | **TypeScript only** | |
| HTTP framework | **Hono** | Used inside the generated function fetch handler. |
| Validation | **zod** | Validate every MCP/tool/webhook request body |
| MCP transport | **HTTP JSON-RPC** at `POST /mcp` | Implemented with a runtime-compatible SDK or a small stateless handler; verified before feature work. |
| Reservation storage | **Stateful Actor with embedded SQLite** (`this.ctx.storage.sql`) | One actor instance per date |
| Session state | **Stateful Actor** (key/value storage) | One actor instance per trusted call ID |
| Flags / tokens | **Telnyx KV** via `env` binding | Feature flag, opaque session and selection tokens |
| MCP auth | **Bearer token** from Edge secret | Never commit or expose the token in prompts/logs |
| Static data | TypeScript constants in `src/data/` | Hours, address, weekly menu |
| Runtime/deploy | **Telnyx Edge Compute** | `telnyx-edge ship` from `hong-kong-cafe/` |
| Tests | **vitest** | Pure logic first, then adapter/integration tests |
| Timezone | `Asia/Hong_Kong` | All date/time logic uses this zone |

No standalone database, no ORM, no external application hosting. Keep dependencies minimal.

## 4. Architecture

```
Caller (phone)
   │
   ▼
Telnyx AI Assistant ── Conversation Workflow
   │       │                   │
   │       │ prompt tools      │ deterministic shared-tool nodes
   │       ▼                   ▼
   └── dynamic-vars     POST /mcp            POST /webhook/misunderstanding
       webhook               │                         │
             └───────────────┴──────────┬──────────────┘
                                        ▼
                         Edge Function (Hono fetch handler)
                                        │
                         ┌──────────────┼──────────────┐
                         ▼              ▼              ▼
                     src/core/      DayBookings    CallSession
                    pure logic      actor/date     actor/call
                                        │              │
                                        └───────┬──────┘
                                                ▼
                                 KV: flag,
                                 session/selection tokens
```

MCP and dynamic variables run on the same Edge Function. Shared webhook tool nodes use a
small adapter over the same `core/` services; they do not duplicate business rules.

Actual layout:

```
hong-kong-cafe/
  telnyx.toml             # generated function ID, actor and KV bindings
  src/index.ts            # re-exports actor classes; default Hono fetch handler
  src/app.ts              # route composition
  src/routes/             # dynamic-vars.ts, mcp.ts, webhook.ts
  src/actors/             # DayBookings.ts, CallSession.ts
  src/core/               # time, availability, booking, alternatives, faq, callback, escalation
  src/data/               # restaurant.ts, menu.ts
  src/lib/                # logger, signatures, validation, MCP response helpers
  tests/                  # focused unit and integration tests
```

## 5. Business rules (PLACEHOLDER values)

**Restaurant info**
- Name: Hong Kong Cafe
- Address: 12 Example Street, Central, Hong Kong (**PLACEHOLDER**)
- Opening hours: daily 11:30–22:00, last reservation 21:00 (**PLACEHOLDER**)

**Reservation model (keep simple)**
- Time slots are every **30 minutes** from 11:30 through 21:00, in `Asia/Hong_Kong`.
- Each reservation occupies tables for **60 minutes** (two consecutive slots). A 21:00
  reservation ends exactly at closing (22:00).
- Capacity: **40 seats** total at any moment (**PLACEHOLDER**). A booking fits if, for every
  occupied slot, `seats_in_use + party_size <= capacity`.
- Party size is an integer from 1–10. Zero, negative, or non-integer input is invalid and
  goes through clarification/misunderstanding handling. Party sizes above 10 go to callback.
- The booking window includes today through 30 calendar days ahead. No time at or before
  the current Hong Kong time is bookable.
- Required details: date, time, party size, name, phone number.
- Confirmation: the assistant reads the details back and gets a clear "yes" before booking.
- `check_availability` returns an opaque `selection_token`, stored in KV for 10 minutes. It
  records the validated date/time/party-size selection. `create_reservation` accepts that
  token plus name and phone, not a second set of model-supplied slot values.
- The selection token is also the booking idempotency key. Retrying a successful or
  in-progress request with the same token returns the existing confirmation; it must not
  consume more seats. A different selection requires a new availability check.
- **No double booking:** the capacity check and insert happen inside one `DayBookings` actor
  method wrapped in `transactionSync`. Actors run one call at a time per instance, so two
  callers cannot take the last seats.
- A call, network timeout, or unknown booking result is not proof of failure. The assistant
  retries the same selection token once, then offers a callback if the outcome is still
  unknown. It must never claim a booking was created without a confirmation result.

**Alternative suggestions**
1. Requested slot full or outside the valid booking boundary → the same date's actor returns
   nearby free slots ordered by absolute distance from the requested time. Offer **up to 3**.
2. If the requested date has no valid free slot → search following dates one at a time, up
   to 7 calendar days, never beyond the 30-day booking window. Pick the first date with
   availability and offer up to 3 slots closest to the requested time.
3. Nothing within that bounded search → apologise and offer a callback request.

**Misunderstanding rule**
- A "misunderstanding" means the assistant cannot map the caller's utterance to a supported
  intent or cannot extract a required value after one clarifying re-ask.
- The counter is **per call** (in the `CallSession` actor) and does not reset mid-call.
- Record it through the shared webhook tool node, which uses the trusted call ID from a hidden
  preset parameter. Do not rely on the model inventing a call/session ID.
- The shared tool returns HTTP `200` when recorded below the threshold, HTTP `409` when the
  counter has reached 3, and a non-2xx operational error if it could not record. Tool nodes
  route deterministically on `telnyx_last_tool_status_code`.
- At 3, go to Escalate: collect a callback number, read it back, save it, say a team member
  will call back, and end. The counter never exceeds 3.
- If the callback number cannot be understood after two re-asks, say the callback could not
  be saved and end honestly. Do not loop forever or claim success.
- If `reservations_enabled` is `"false"`, FAQ still works. When the caller asks to book, check,
  or move a reservation, an Identify Intent LLM edge (listed before the booking edges) routes to
  a verbatim Reservations Unavailable speak node ("please call back later"), then Goodbye. No
  details or callback number are collected and the misunderstanding counter is not touched.

**Failure behavior**
- MCP/business errors return a short voice-friendly failure and an error signal. The model
  must not invent availability, booking confirmation, or callback success.
- A booking timeout is retried once with the same selection token, then offered as a callback.
- A KV or Actor write failure is reported honestly and never converted into a success.
- If dynamic variables cannot establish session support, return
  `reservations_enabled = "false"` and `call_support_available = "false"`. A variable edge
  routes to a verbatim technical-failure message and then Goodbye.
- Assistant-level defaults for both variables must also be the safe `"false"` values in case
  the webhook times out.

**Daily menu**
- Menu depends on the weekday (7 entries in `src/data/menu.ts`, **PLACEHOLDER** dishes).
- "Dinner menu of the day" = today's dinner items in Hong Kong time.

## 6. Conversation Workflow

Failure actions are deterministic tool nodes, not prompt nodes. Each references a distinct
shared webhook tool so its stage is a hidden preset field and the trusted `call_control_id`
is never model-supplied. Prompt nodes contain only the tools needed for their step.

| # | Node | Type | Purpose | Tools |
|---|---|---|---|---|
| 1 | Greeting | **speak** | Verbatim greeting + AI-assistant disclosure | none |
| 2 | Identify Intent | prompt | Choose reservation / FAQ / human / still unclear | none |
| 3 | Intent Unclear | **tool** | Record failed intent after a re-ask | `record-intent-misunderstanding` |
| 4 | Reservation | prompt | Collect date/time/party/seating; check weather and availability; offer alternatives | `check_availability`, `check_weather` |
| 5 | Reservation Unclear | **tool** | Record failed reservation extraction | `record-reservation-misunderstanding` |
| 6 | Confirm Booking | prompt | Collect name/phone, read back, get clear yes, create reservation | `create_reservation` |
| 7 | Confirmation Unclear | **tool** | Record failed confirmation extraction | `record-confirmation-misunderstanding` |
| 8 | Check Or Change Booking | prompt | Verify name/surname + phone + date, read back the booking, move it to a new date | `lookup_reservation`, `change_reservation_date` |
| 9 | Manage Booking Unclear | **tool** | Record failed booking-lookup extraction | `record-reservation-misunderstanding` |
| 10 | Answer FAQ | prompt | Answer hours/address/menu; handle follow-ups | `get_restaurant_info`, `get_daily_menu` |
| 11 | FAQ Unclear | **tool** | Record failed FAQ intent/value | `record-faq-misunderstanding` |
| 12 | Escalate | prompt | Collect callback number, read back, save | `request_callback` |
| 13 | Technical Failure | **speak** | Honest verbatim service-unavailable message | none |
| 14 | Reservations Unavailable | **speak** | Verbatim "not taking reservations, call back later" when the flag is false | none |
| 15 | Goodbye | **speak** | Verbatim closing line | none |
| 16 | Hangup | **tool** | End the call | built-in hangup |

**Required edges and priorities**
- Greeting: `call_support_available == "false"` → Technical Failure; default → Identify
  Intent.
- At Identify Intent, the variable edge `call_support_available == "false"` → Technical
  Failure runs first. The first LLM edge is "`reservations_enabled` is false and the caller
  wants to make, check, or move a reservation" → Reservations Unavailable → Goodbye.
- Identify Intent LLM edges: reservation → Reservation; check/move existing booking →
  Check Or Change Booking; FAQ → Answer FAQ; explicit human → Escalate; still unclear after
  one re-ask → Intent Unclear.
- Reservation LLM edges: caller accepts a concrete slot → Confirm Booking; party >10 or
  explicit human → Escalate; caller no longer wants to book → Goodbye; cannot extract after
  one re-ask → Reservation Unclear.
- Add variable edges from Reservation, Confirm Booking, and Check Or Change Booking for
  `reservations_enabled == "false"` → Reservations Unavailable so the hard rule is not left
  to the model.
- Confirm Booking LLM edges: clear yes and details confirmed → invoke `create_reservation`
  in that node, then route on its result: success → Goodbye; slot taken or caller changes the
  slot → Reservation with fresh alternatives; declined → Goodbye; tool failure → Technical
  Failure; explicit human → Escalate; repeated unclear/no confirmation → Confirmation Unclear.
- Check Or Change Booking LLM edges: finished → Goodbye; explicit human or `not_found` with
  an accepted callback → Escalate; operational tool failure → Technical Failure; repeated
  unclear details → Manage Booking Unclear.
- Answer FAQ LLM edges: more questions → stay; finished → Goodbye; explicit human →
  Escalate; repeated unclear request → FAQ Unclear.
- Each `* Unclear` tool node has exactly one default edge. Route
  `telnyx_last_tool_status_code == "200"` back to its originating prompt node,
  `== "409"` → Escalate, and default → Technical Failure.
- Escalate LLM edges: callback saved → Goodbye; caller declines callback → Goodbye;
  callback cannot be understood after two re-asks or cannot be saved → Technical Failure.
- Technical Failure → Goodbye. All successful/completed paths → Goodbye. Goodbye → Hangup.
- Speak nodes each have exactly one outgoing default edge; tool nodes with outgoing edges
  have exactly one default. LLM edges must not be blocked by instructions that forbid tools.

The workflow canvas is not considered complete until all above paths have been exercised by
a real call. Do not implement the old seven-node, LLM-counting version.

## 7. Dynamic variables webhook

Called at conversation start. Runs on the Edge Function, verifies the Telnyx Ed25519
signature, and must influence routing, not only wording. The configured builder defaults
are safe values because a timeout falls back to them.

| Variable | Source | Used for |
|---|---|---|
| `reservations_enabled` | KV feature flag, safe fallback `"false"` | **Routing** to the reservations-unavailable rejection |
| `call_support_available` | Whether session KV can be initialized, safe fallback `"false"` | **Routing** to Technical Failure |
| `call_session_token` | Random opaque token; KV maps it to trusted `call_control_id` with a 4-hour TTL | MCP tools resolve trusted per-call state |
| `is_open_now` | Hours + HK time | Greeting wording |
| `today_date` | HK date (`YYYY-MM-DD`) | Resolve "today"/"tomorrow"/weekday correctly |
| `restaurant_name`, `restaurant_address` | `src/data` | Greeting/FAQ wording |

Do not return the caller's full phone number as a dynamic variable. Telnyx system variables
or the signed webhook payload may be used for trusted prefill internally, but routine logs
must mask the number. The dynamic-variables response must be wrapped in
`{ "dynamic_variables": { ... } }`; a flat object is silently ignored by Telnyx.

## 8. State: what lives where (record this reasoning in the README)

| State | Where | Why |
|---|---|---|
| Reservations for one date | **`DayBookings` actor** (embedded SQLite, name = `YYYY-MM-DD`) | Capacity check + insert is a read-modify-write on one entity; the actor serialises it, `transactionSync` makes it atomic; SQL handles the per-slot seat sums |
| Misunderstanding count for one call | **`CallSession` actor** (key/value, name = trusted call ID) | Per-call read-modify-write counter; actor dispatch prevents lost increments |
| `reservations_enabled` flag | **KV**, default safe value when missing | Toggle behaviour without redeploying |
| Call session token → trusted call ID | **KV**, random token, 4-hour TTL | Lets MCP tools resolve trusted per-call identity without trusting a model-supplied call ID |
| Selection token → validated slot | **KV**, random token, 10-minute TTL | Binds creation to a server-validated date/time/party choice and serves as booking idempotency key |
| Callback record for one call | **`CallSession` actor** (same instance as the counter) | One callback per call; first save wins and retries return `already_saved`; no separate KV record, hashing, or TTL logic |
| Hours, address, weekly menu | **Constants in code** | Static, changes only on redeploy; no storage needed |

**Storage decision (why not standalone SQLite):** Telnyx functions are containers, and a
standalone SQL database is not a safe fit for this POC. SQLite *is* available inside each
Stateful Actor (`this.ctx.storage.sql`, per-instance, durable), so reservation data uses it
there. Sharding by date also avoids a single global actor.

**Trade-off to mention in the demo:** an actor's SQLite is private to its instance, so there
is no cross-date query. The availability service checks one date at a time. A "list all
upcoming reservations" staff view would need a separate data design.

Callback values contain personal data: store only in the per-call actor record, mask phone
numbers in logs, and do not include them in demo screenshots. A fresh callback also sends a
best-effort Resend summary email to `BOOKING_NOTIFICATION_EMAIL` (currently only the Resend
account owner, because of the sandbox sender).

## 9. Required HTTP and MCP interfaces

### Public MCP server

`POST /mcp` exposes MCP Streamable HTTP (HTTP JSON-RPC), with bearer authentication from an
Edge secret. The URL and credential are both required submission artifacts. The server must
support real MCP `initialize`, `tools/list`, and `tools/call` exchanges, not merely ordinary
REST calls with MCP-like names.

| MCP tool | Input | Output |
|---|---|---|
| `get_restaurant_info` | `topic`: `hours` or `address` | matching text values |
| `get_daily_menu` | optional `date` (`YYYY-MM-DD`) | resolved date, weekday, dinner items |
| `check_availability` | `date`, `time`, `party_size` | `available`, requested result, up to 3 `alternatives`, and `selection_token` for a valid requested slot |
| `create_reservation` | `selection_token`, `name`, `phone`, optional `seating`, `remark` | confirmation id/details, `slot_taken` + fresh alternatives, or honest failure |
| `check_weather` | `date` | deterministic demo forecast; weekend rain closes outdoor seating |
| `lookup_reservation` | `name` or surname, `phone`, `date` | the booking with a masked phone, or an identical `not_found` for any mismatch |
| `change_reservation_date` | `name` or surname, `phone`, `current_date`, `new_date` | booking moved at the same time, or alternatives / `not_found` |
| `record_misunderstanding` | `session_token`, `stage` | new `count`, `should_escalate`, recorded status; not attached to the Assistant, used by smoke tests (the workflow uses the signed shared tools below) |
| `request_callback` | `session_token`, `phone`, optional `name` | `saved` or `already_saved`, or honest failure |

Dates are `YYYY-MM-DD`, times are 24-hour `HH:mm`, and all date rules use
`Asia/Hong_Kong`. MCP/business responses are short, structured, and voice-friendly. Invalid
input, unauthorized calls, timeouts, and Actor/KV failures return an explicit failure result
and must not be described as success.

### Telnyx-signed webhooks

| Endpoint | Input | Output |
|---|---|---|
| `POST /webhook/dynamic-vars` | Telnyx initialization event | variables from section 7 |
| `POST /webhook/misunderstanding/intent` | hidden preset trusted `call_id` only | status `200` below 3, `409` at 3, error otherwise |
| `POST /webhook/misunderstanding/reservation` | hidden preset trusted `call_id` only | same status contract |
| `POST /webhook/misunderstanding/confirmation` | hidden preset trusted `call_id` only | same status contract |
| `POST /webhook/misunderstanding/faq` | hidden preset trusted `call_id` only | same status contract |

The four misunderstanding paths are separate org-level shared tools with the same backend
adapter and hidden preset `call_id: "{{call_control_id}}"`. Telnyx signs these requests and
the dynamic-variables request with Ed25519. Verify `telnyx-signature-ed25519` and
`telnyx-timestamp` against the raw body before processing. The MCP endpoint uses bearer auth
instead because it is called by the assistant's MCP client.

## 10. Known risks / open questions

Resolved during scaffolding:
- CLI `v0.5.17` is installed and authenticated; generated actor projects use `telnyx.toml`.
- The scaffold created function `hong-kong-cafe` (`ce4e4c94-b420-4c1c-8135-1619146f7e23`) with
  a `COUNTER` actor. The `Counter` is temporary and will become the two production actors.
- The dynamic-variables webhook exposes `call_control_id`; MCP calls use the opaque
  `call_session_token` mapping rather than trusting model-supplied call IDs.

Still to verify or watch:
1. **Hono + Actor + KV + MCP coexistence.** One deployed function must export both actors,
   bind KV, and serve Hono/MCP. Do not build business features before this spike passes.
2. **Actor/runtime API.** Confirm the installed `@telnyx/edge-runtime` supports both
   `transactionSync` and embedded SQL typing. Use the generated package lock, not `latest`
   drift.
3. **MCP transport at the edge.** Verify a real MCP client can initialize and call tools over
   HTTP on Edge. If it cannot, stop and review deployment options; do not silently replace
   the required public MCP server.
4. **Tool-node arguments and status routing.** Confirm hidden preset fields (trusted call ID),
   tool-node output/status routing, and string-versus-number comparison behavior in the
   Portal. `409` is the intended threshold signal.
5. **Node and correlation logging.** Prompt-node MCP requests may not carry a trusted workflow
   node label. Use the call/session correlation ID plus tool/route; never trust a
   model-supplied ID for authorization. Record what the platform actually supplies.
6. **Phone normalization.** Accept common spoken phone punctuation and normalize before
   storage; reject implausible lengths without logging the full value.
7. **Language:** English only for the POC. Cantonese/Mandarin is out of scope.

## 11. Observability (minimum)

- One structured JSON log per webhook/MCP/tool call with: `timestamp`, `request_id`,
  `correlation_id`, masked `caller`, trusted `call_id` when available, `route`, `tool`,
  `node` if trustworthy, `outcome`, `error_code`, and `latency_ms`.
- Do not log raw phone numbers, full callback records, secrets, or authorization headers.
- One signal beyond application logs: use Telnyx Edge invocation metrics/health plus
  application counters (`booking_created`, `slot_taken`, `escalated_to_callback`, tool errors,
  and latency). Document the exact query/CLI command.
- Keep `DEBUG_LOG.md` from day one. It must record real development failures and the signal
  that located them; do not fabricate a debugging story.
- README runbook: how to notice breakage within one minute, what health/metrics/log query to
  check first, and how to correlate one Assistant → Function → MCP → KV/Actor path.

## 12. Milestones

1. [x] Lock the implementation contract; make MCP required.
2. [x] Scaffold the actor-aware TypeScript function and install the Edge CLI.
3. [x] Add actual build/typecheck/test commands and baseline README.
4. [x] Spike Hono + both actors + KV + persistence/concurrency; record findings.
5. [x] Implement signed dynamic variables and session-token initialization (signed live call
   pending).
6. [x] Deploy authenticated MCP transport and verify it with an official MCP client.
7. [x] Configure workflow tool nodes, hidden trusted call ID, and status routing; real-call
   verification pending.
8. [x] Implement pure time/capacity/alternative logic with focused tests.
9. [x] Implement and live-verify atomic bookings, idempotency, concurrency, and persistence.
10. [x] Implement and live-verify `CallSession`, callbacks, and all nine MCP tools.
11. [x] Instrument logs, readiness, metrics, correlation, and failure responses.
12. [x] Assign the US number `+1 603 471 5321` to the Assistant (a Hong Kong number costs
    75 USD).
13. [ ] Run the full functional/routing live-call matrix; the reservations-disabled flow is
    owner-verified live. MCP, booking, concurrency, callback,
    and persistence portions have passed.
14. [x] Finish README, architecture diagram, demo script, and evidence-based debugging story.

Commit at coherent checkpoints when asked; never commit secrets or local tool binaries.

## 13. Test paths (must pass on the live assistant)

- **Happy:** reservation, details read back, confirmation given, MCP tool invoked.
- **Alternative (same day):** requested slot full → sensible nearby times offered.
- **Alternative (next day):** whole date full → following valid day offered.
- **FAQ:** opening hours, today's dinner menu, address.
- **Escalation:** 3 misunderstandings at every collection stage → callback saved; callback
  extraction failure ends honestly.
- **Confirmation:** rejected details loop without restarting; slot lost during confirmation
  returns fresh alternatives; timeout/retry does not duplicate a booking.
- **Negative:** past time, invalid date, party size 0/non-integer, party >10, invalid phone,
  caller refuses all alternatives, `reservations_enabled = false`, MCP/KV/Actor failure.
- **Security:** unsigned dynamic webhook rejected, bad MCP bearer rejected, model-supplied call
  ID cannot access another call's state.
- **Concurrency:** two simultaneous bookings for the last seats → only one succeeds.
- **Persistence:** a booking survives actor idle and function redeploy.
- **MCP:** real client initialize/list/call against the public URL; conversation evidence that
  the Assistant invoked the MCP tool.

This matrix is exercised in separate test sessions so failures stay attributable.

## 14. Rules for the coding agent

- Use the verified scaffold commands and keep `AGENTS.md` current when commands or layout change.
- Check the Telnyx docs before using an actor, KV, workflow-tool, or binding API.
- Never commit secrets. Use Edge secrets or an untracked local environment file.
- Keep it simple: no extra frameworks, queues, external hosting, or standalone database.
- MCP, phone workflow, observability, and live verification are required; do not defer them.
- Ask before expanding scope; the initial stretch goals stayed out, while the owner later
  requested the demo additions listed under "POC demo update (post-brief)".
