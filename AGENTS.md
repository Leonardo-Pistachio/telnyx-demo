# AGENTS.md

## Repository state

- This is an implemented and deployed Telnyx Edge application under `hong-kong-cafe/`, with
  planning context in `PROJECT_BRIEF.md` and requirements in `code_challenge.md`. The public
  MCP server, KV flows, Actors, Assistant, and 13-node workflow are provisioned and partially
  live-verified. No phone number is assigned, so real-call/dynamic-webhook workflow testing is
  incomplete.
- Do not describe the phone demo or unexercised workflow paths as complete without evidence.
  Deployment and debugging evidence is in `DEBUG_LOG.md`; smoke scripts are under
  `hong-kong-cafe/scripts/`.

## Commands

Run application commands from `hong-kong-cafe/`:

```bash
npm install
npm run check          # typecheck, then all vitest tests
npm run typecheck
npm test
npm run dev            # local Telnyx Edge development
npm run mcp:smoke      # requires MCP_URL and MCP_API_KEY
npm run mcp:business-smoke   # live booking, idempotency, capacity race
npm run mcp:demo-smoke       # live weather, guarded lookup, date move; sends one email
npm run mcp:session-smoke    # requires SMOKE_SESSION_TOKEN
npm run provision:assistant  # requires TELNYX_API_KEY, MCP_API_KEY, FUNCTION_URL
telnyx-edge types      # regenerate telnyx-env.d.ts after binding/export changes
telnyx-edge ship --yes
telnyx-edge list
telnyx-edge ship status hong-kong-cafe --logs
telnyx-edge logs hong-kong-cafe --type runtime --since 15m
telnyx-edge logs hong-kong-cafe --type invocations --since 15m
telnyx-edge metrics hong-kong-cafe
```

There is no lint, CI, or production build script. `telnyx-edge ship` performs the Edge
bundle/build. Do not add generic commands without updating this file.

## Architecture

- `src/app.ts` composes Hono routes; `src/index.ts` exports both actor classes plus the fetch
  handler. `telnyx.toml` is the real manifest (`[[actors]]`, `[storage.kv.CAFE_KV]`), not
  `func.toml`.
- `workflow/assistant-config.mjs` is the executable Assistant/workflow definition.
  `scripts/provision-assistant.mjs` idempotently creates/updates the MCP server, four shared
  misunderstanding tools, and Assistant. Re-run it after changing workflow behavior.
- `POST /mcp` is a public MCP Streamable HTTP endpoint with bearer auth from `MCP_API_KEY`.
  It exposes nine tools in `src/mcp/tools.ts` (info, menu, availability, weather, create,
  lookup, change-date, misunderstanding, callback). Plain REST endpoints do not satisfy the
  challenge.
- `POST /webhook/dynamic-vars` and `POST /webhook/misunderstanding/:stage` verify Telnyx
  Ed25519 signatures against the raw body and timestamp.
- `DayBookings` is one actor per Hong Kong calendar date; capacity check plus insert happens
  inside `transactionSync` with embedded SQL. Rows store seating and a special-occasion
  remark; `findByPhone` and `remove` support guarded lookup and cross-date moves. `CallSession`
  owns the per-call misunderstanding counter and the single callback record.
- KV stores the feature flag, random session-token→trusted-call-ID mappings, and 10-minute
  booking-selection tokens. Callback requests live in `CallSession`, not KV. Never trust a
  model-supplied call ID; MCP tools resolve the trusted ID through the random session token.
- Business logic is pure TypeScript in `src/core/`. MCP and shared-webhook adapters must reuse
  it rather than duplicate reservation rules.
- All date/time logic uses `Asia/Hong_Kong`; the last bookable slot is 21:00 and a reservation
  occupies 60 minutes. Each booking is capped at 10 guests.
- Booking lookup and date changes require name (or surname) + phone + current date to match;
  all mismatches return the same `not_found` result so no booking details leak.
- `src/core/weather.ts` is a deterministic demo forecast (weekend = rainy/outdoor closed,
  weekday = sunny/outdoor open) used by `check_weather` and enforced in `create_reservation`.
- Confirmed bookings trigger a best-effort Resend email to `BOOKING_NOTIFICATION_EMAIL`
  (`EMAIL_API_KEY`, optional `EMAIL_FROM`), and a fresh callback save sends its own summary
  email the same way. Email failure never rolls back a booking or callback.

## Edge pitfalls

- Secrets added with `telnyx-edge secrets add` are injected at deploy time as `process.env`
  variables. They are not properties of the binding `env` object. Re-ship after changing one.
- Regenerate `telnyx-env.d.ts` with `telnyx-edge types` whenever actor bindings or exported
  actor methods change.
- `@telnyx/edge-runtime` is pinned. Do not set it back to `latest`; verify embedded SQL and
  `transactionSync` compatibility before upgrading.
- `.env.local` contains the local MCP token and is ignored. Never commit it or print it.
- A CLI monitor timeout is not proof of deploy failure; check `telnyx-edge list`,
  `telnyx-edge ship status`, and deployment JSON. A deploy operation can remain busy and block
  subsequent ships with HTTP 409. The first deploy here took about 21 minutes.
- `hong-kong-cafe/.npmrc` sets `legacy-peer-deps=true` to work around an npm 11 arborist crash
  while resolving Vitest's optional browser peers. Keep it unless the dependency set changes.

## Required solution invariants

- Keep MCP, dynamic-variable routing, KV, at least one Stateful Actor, and structured
  observability in the required Phase 1 path. Weather was originally out of scope; the demo
  now includes a deterministic weather MCP tool for outdoor seating, which does not replace
  any mandatory path.
- Dynamic variables must route (`call_support_available`, then `reservations_enabled`), not
  only personalize text. Safe fallback for both is `"false"`.
- Speak nodes carry verbatim copy; tool nodes carry deterministic failure/counter actions.
  The Assistant API has no per-node MCP tool selector, so node instructions restrict tool use
  and deterministic shared-tool nodes handle failure routing. Do not claim API-level per-node
  MCP scoping.
- Do not implement the old LLM-counted misunderstanding workflow. See `PROJECT_BRIEF.md`
  section 6 and resolve unresolved workflow/review items before calling it complete.
- Mask phone numbers in logs. Booking tokens and session tokens are bearer-like values; never
  log them or include them in callbacks/error details.

## Verification

- Run `npm run check` after changes.
- Already live-verified: readiness, MCP auth/client calls, booking idempotency, concurrent
  last-seat protection, three-count escalation, callback idempotency, correlation logging, and
  Actor persistence after redeploy.
- POC demo update live-verified on 2026-11-11: nine-tool MCP list, 60-minute/21:00 slots,
  remark and seating persistence, weekend-rain/weekday-sun weather rule, guarded lookup,
  date-only moves, per-call callback storage in `CallSession`, and Resend delivery of booking
  and callback summaries to `BOOKING_NOTIFICATION_EMAIL` (currently the Resend account owner's
  address, because the sandbox key cannot send elsewhere without a verified domain).
- Still required: assign a phone number, verify Telnyx-signed dynamic variables from a real
  call, exercise every spoken workflow edge, and capture demo evidence.
- Preserve real failing evidence in `DEBUG_LOG.md`; do not fabricate a debugging story.

## Deliverables and tooling

- Required artifacts are listed in `code_challenge.md` and `PROJECT_BRIEF.md`: public function
  and MCP URLs, phone number, README, architecture diagram, demo script, debugging story, and
  committed OpenCode config.
- Keep `@telnyx/opencode` enabled in `.opencode/opencode.json` and `.opencode/tui.json`. Use
  Telnyx-hosted models selected through `/telnyx`; authenticate with
  `opencode auth login --provider telnyx --method "API Key"` and check with `opencode auth list`.
- `.opencode/package.json`, its lockfile, and `node_modules/` are tool-managed. Application
  dependencies belong in `hong-kong-cafe/package.json`.
