# PROJECT_BRIEF.md

> Read together with `AGENTS.md` and `code_challenge.md`. If this file conflicts with
> `code_challenge.md`, flag the conflict instead of silently picking one.
> Values marked **PLACEHOLDER** are demo data and can be edited freely.
> Revision 2: replaced standalone SQLite with Telnyx-native storage (see section 8).

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

### In scope (Phase 1: this build)
- Conversation Workflow (speak nodes, prompt nodes, conditional edges)
- Dynamic variables webhook on a Telnyx Edge Function
- Reservation logic (availability, booking, alternatives)
- FAQ answers (hours, menu of the day, address)
- Misunderstanding counter + callback request
- Storage on Telnyx primitives (Actors, KV, static data), see section 8
- Structured logging on every webhook/tool call

### Out of scope for now (Phase 2)
- **Weather MCP tool and outdoor-seating decision** (outdoor area opens only if no rain)
- **Public MCP server** (the challenge requires 3+ tools; see section 9)
- Stretch goals from `code_challenge.md`
- Cancel / modify reservations, SMS confirmations, payments, multi-language
- Staff dashboard for reservations

> Phase 1 must not block Phase 2. Keep business logic in plain TypeScript modules
> (`src/core/`) with no HTTP code, so it can later be wrapped as MCP tools.

## 3. Tech stack

| Concern | Choice | Note |
|---|---|---|
| Language | **TypeScript only** | |
| HTTP framework | **Hono** | Lightweight; used inside the function's fetch handler. Verify in the spike (section 12). |
| Validation | **zod** | Validate every tool/webhook request body |
| Reservation storage | **Stateful Actor with embedded SQLite** (`this.ctx.storage.sql`) | One actor instance per date |
| Session state | **Stateful Actor** (key/value storage) | One actor instance per call |
| Flags / records | **Telnyx KV** via `env` binding | Feature flag, write-once callback records |
| Static data | TypeScript constants in `src/data/` | Hours, address, weekly menu |
| Runtime/deploy | **Telnyx Edge Compute** | `telnyx-edge ship` |
| Tests | **vitest** | Focus on availability/alternative logic |
| Timezone | `Asia/Hong_Kong` | All date/time logic uses this zone |

No standalone database, no ORM, no external hosting. Keep dependencies minimal.

## 4. Architecture (simple)

```
Caller (phone)
   │
   ▼
Telnyx AI Assistant ── Conversation Workflow
   │   │
   │   └── webhook tool calls ───────────────┐
   │                                          ▼
   └── dynamic variables webhook ──►  Edge Function (Hono fetch handler)
                                          │
                                          ├── core/ (reservation, faq, escalation logic)
                                          ├── Actor: DayBookings["2026-11-12"]  (SQLite inside)
                                          ├── Actor: CallSession["<call_id>"]   (counter, callback)
                                          ├── KV: feature flag, callback records
                                          └── src/data (static hours, address, menu)
```

Phase 1 tools are plain HTTP endpoints on the same function. In Phase 2 the same `core/`
logic is also exposed through an MCP server.

Suggested layout (adjust after scaffolding):

```
src/
  index.ts              # exports actor classes + fetch handler (Hono app)
  routes/               # webhook.ts, tools.ts
  actors/               # DayBookings.ts, CallSession.ts
  core/                 # availability.ts, faq.ts, escalation.ts, alternatives.ts
  data/                 # restaurant.ts (info, hours), menu.ts
  lib/                  # logger.ts, time.ts
tests/
```

## 5. Business rules (PLACEHOLDER values)

**Restaurant info**
- Name: Hong Kong Cafe
- Address: 12 Example Street, Central, Hong Kong (**PLACEHOLDER**)
- Opening hours: daily 11:30–22:00, last reservation 20:30 (**PLACEHOLDER**)

**Reservation model (keep simple)**
- Time slots every **30 minutes** within opening hours.
- Each reservation occupies tables for **90 minutes** (3 consecutive slots).
- Capacity: **40 seats** total at any moment (**PLACEHOLDER**). A booking fits if, for every
  slot it occupies, `seats_in_use + party_size <= capacity`.
- Party size: 1–10. Larger parties are routed to a callback.
- Booking window: today up to 30 days ahead; no times in the past (HK time).
- Required details: date, time, party size, name, phone number.
- Confirmation: the assistant reads the details back and gets a clear "yes" before booking.
- **No double booking:** the check and the insert happen inside one `DayBookings` actor
  method, wrapped in `transactionSync`. Actors run one call at a time per instance, so two
  callers cannot take the last seats.

**Alternative suggestions**
1. Requested slot full → the same `DayBookings` instance returns nearby free slots on that
   date, ordered by distance from the requested time. Offer **up to 3**.
2. Same date full (or no valid slot) → the function asks the next dates' actors in order, up to
   7 days. Pick the first date with availability and offer up to 3 slots closest to the
   originally requested time.
3. Nothing within 7 days → apologise and offer a callback request.

**Misunderstanding rule**
- A "misunderstanding" = the assistant cannot map the caller's utterance to a supported
  intent or cannot extract a required value after re-asking.
- Counter is **per call** (in the `CallSession` actor). At **3**, go to the Escalate node: ask
  for a callback number, read it back, save it, say a team member will call back, end the call.
- The counter does not reset mid-call.

**Daily menu**
- Menu depends on the weekday (7 entries in `src/data/menu.ts`, **PLACEHOLDER** dishes).
- "Dinner menu of the day" = today's dinner items in Hong Kong time.

## 6. Conversation Workflow

| # | Node | Type | Purpose | Tools available |
|---|---|---|---|---|
| 1 | Greeting | **speak** | Verbatim greeting + short AI-assistant disclosure | none |
| 2 | Identify Intent | prompt | Decide: reservation / FAQ / human / unclear | `record_misunderstanding` |
| 3 | Reservation | prompt | Collect date, time, party size; check availability; offer alternatives | `check_availability`, `record_misunderstanding` |
| 4 | Confirm Booking | prompt | Collect name + phone, read back, get "yes", book | `create_reservation` |
| 5 | Answer FAQ | prompt | Hours, address, menu of the day | `get_restaurant_info`, `get_daily_menu`, `record_misunderstanding` |
| 6 | Escalate | prompt | Collect callback number, confirm, save | `request_callback` |
| 7 | Goodbye | **speak** | Verbatim closing line | none |

**Edges**
- Greeting → Identify Intent (always)
- Identify Intent → Reservation / Answer FAQ / Escalate (LLM conditions: caller intent)
- Reservation → Confirm Booking (LLM: caller accepted a specific slot)
- Identify Intent / Reservation / Answer FAQ → Escalate (when `should_escalate` is true)
- Any completed task → Goodbye
- **Variable-comparison edge (required by challenge):** at Identify Intent,
  `reservations_enabled == "false"` routes straight to Escalate (callback only). See section 7.

Scope tools per node: each node gets only the tools in the table above.

## 7. Dynamic variables webhook

Called by Telnyx at the start of each call. Runs on the Telnyx Edge Function and must
**influence routing**, not only wording.

| Variable | Source | Used for |
|---|---|---|
| `reservations_enabled` | KV feature flag | **Routing**: `"false"` → skip reservation, go to callback |
| `is_open_now` | Computed from hours + HK time | Greeting wording |
| `today_date` | Computed (HK time) | So the assistant resolves "tomorrow", "Friday" correctly |
| `restaurant_name`, `restaurant_address` | `src/data` | Speak node and FAQ |
| `caller_number` | Telnyx call data | Pre-fill phone number; log caller |

## 8. State: what lives where (record this reasoning in the README)

| State | Where | Why |
|---|---|---|
| Reservations for one date | **`DayBookings` actor** (embedded SQLite, name = `YYYY-MM-DD`) | Capacity check + insert is a read-modify-write on one entity; the actor serialises it, `transactionSync` makes it atomic; SQL handles the per-slot seat sums |
| Misunderstanding count, callback number for one call | **`CallSession` actor** (key/value, name = call ID) | Per-call entity, read-modify-write counter, no lock needed |
| `reservations_enabled` flag | **KV** | Toggle behaviour without redeploying |
| Callback record for staff (write-once, key `callback:<call_id>`, with TTL) | **KV** | Single write, never modified, so no read-modify-write; verify listing support (section 10) |
| Hours, address, weekly menu | **Constants in code** | Static, changes only on redeploy; no storage needed |

**Storage decision (why not standalone SQLite):** Telnyx functions are containers, and a
standalone SQL database is listed as "coming soon" in the Edge Compute docs, so a normal
SQLite file or hosted DB is not a safe fit. SQLite *is* available inside each Stateful Actor
(`this.ctx.storage.sql`, per-instance, durable), so the reservation data uses it there.
Sharding by date also avoids a single global actor, which the actor docs advise against.

**Trade-off to mention in the demo:** an actor's SQLite is private to its instance, so there
is no cross-date query. Phase 1 never needs one (alternatives check one date at a time).
A "list all upcoming reservations" staff view would need a standalone SQL database later.

## 9. Phase 1 tool endpoints (HTTP, called by the assistant)

| Endpoint | Input | Output |
|---|---|---|
| `POST /webhook/dynamic-vars` | Telnyx call payload | variables from section 7 |
| `POST /tools/check-availability` | date, time, party_size | `available` + `alternatives[]` (same-day, else next days) |
| `POST /tools/create-reservation` | date, time, party_size, name, phone | confirmation id, or `slot_taken` + fresh alternatives |
| `POST /tools/get-daily-menu` | optional date | dinner items |
| `POST /tools/get-restaurant-info` | topic: hours / address | text values |
| `POST /tools/record-misunderstanding` | call_id | `count`, `should_escalate` |
| `POST /tools/request-callback` | name (optional), phone, call_id | saved confirmation |

All responses are short, voice-friendly JSON. Dates as `YYYY-MM-DD`, times as 24h `HH:mm`.

**Phase 2 (later):** a public MCP server exposing at least 3 tools, e.g. `check_availability`,
`create_reservation`, `get_weather` (rain forecast → outdoor area open/closed). The challenge
requires this, so keep `core/` free of HTTP code.

## 10. Known risks / open questions

1. **Stateful Actors are Beta.** The CLI must be a release with actor deploy support
   (the docs say v0.2.2 and earlier cannot ship an actor project). Embedded SQL needs
   `@telnyx/edge-runtime` 0.6.0+, and `transactionSync` typing needs 0.8.0+. Use the latest.
2. **Config file name:** the actor docs use `telnyx.toml` with `[[actors]]` blocks, while the
   challenge and `AGENTS.md` mention `func.toml`. Follow whatever the scaffold generates, declare
   the actor and KV bindings there, and update `AGENTS.md`.
3. **Scaffold shape:** actor projects are scaffolded with `telnyx-edge new-func --actor --name=<name>`
   and export the actor classes plus a fetch handler. Confirm during the spike that Hono works as
   that fetch handler and that one project can hold both actor classes and the KV binding.
4. **Call ID availability:** confirm which Telnyx system variable (e.g. conversation or call ID)
   is available to webhook tools, since `CallSession` is named by it.
5. **KV listing:** confirm whether KV can list keys by prefix. If not, staff find callbacks in the
   structured logs (`callback_requested` event), and the KV record is only a backup.
6. **Counter wiring in the Portal:** confirm how a tool result (`should_escalate`) can drive an
   edge. If it cannot be a variable comparison, use an LLM condition ("`should_escalate` is true").
7. **Language:** English only for the POC. Cantonese/Mandarin is out of scope.

## 11. Observability (minimum)

- JSON log line for every webhook/tool call:
  `request_id, timestamp, caller, call_id, node, tool, outcome, latency_ms`
- One extra signal: **latency_ms** on every call, plus counters for
  `booking_created`, `slot_taken`, `escalated_to_callback`.
- Keep a `DEBUG_LOG.md` from day one for the required "what broke and how I found it" story.

## 12. Milestones

1. **Spike (do first):** scaffold an actor project; deploy a trivial `DayBookings` actor that
   creates a table and inserts/reads a row; add a KV binding; serve it through a Hono fetch
   handler. Confirm it all survives redeploy. Record findings in `DEBUG_LOG.md`.
2. **Core logic:** capacity rules, slot math and alternatives as pure functions, with vitest tests.
3. **`DayBookings` actor:** schema, `checkAvailability`, `book` (atomic), same-day alternatives.
4. **Endpoints:** all tools in section 9 with zod validation and logs; next-day search across actors.
5. **`CallSession` actor + callback flow**, KV flag, dynamic variables webhook.
6. **Deploy** with `telnyx-edge ship`, assign phone number, build the workflow in the Portal.
7. **Test every path** through a real call (section 13).
8. **Docs:** README, architecture diagram, demo script, debugging story.
9. **Phase 2:** weather MCP + MCP server.

Commit after each milestone.

## 13. Test paths (must pass on the live assistant)

- **Happy:** book a free slot, details read back, confirmation given.
- **Alternative (same day):** requested hour full → sensible nearby times offered.
- **Alternative (next day):** whole date full → following day offered.
- **FAQ:** opening hours, today's dinner menu, address.
- **Escalation:** 3 misunderstandings → callback number captured and saved.
- **Negative:** past date, party size 0 or 25, invalid phone number, caller refuses all alternatives,
  `reservations_enabled = false`.
- **Concurrency:** two simultaneous bookings for the last seats → only one succeeds.
- **Persistence:** a booking is still there after the actor idles or the function is redeployed.

## 14. Rules for the coding agent

- Do not invent commands; derive them from the scaffold (`package.json`, `telnyx.toml`/`func.toml`)
  and update `AGENTS.md` once real commands exist.
- Check the Telnyx docs (links in `code_challenge.md`) before using an actor, KV or binding API.
- Never commit secrets. Use function secrets or untracked `.env`.
- Keep it simple: no extra frameworks, queues, or external services beyond this brief.
- Ask before expanding scope; Phase 2 items stay out until Phase 1 passes section 13.
