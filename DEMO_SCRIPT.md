# Demo Script

## Current readiness

The backend, MCP server, Assistant, and workflow are deployed/provisioned. The US number
`+1 603 471 5321` is assigned to the Assistant (a Hong Kong number costs 75 USD). The owner
cannot call it from their own phone, so full real-call testing has not been done. The owner has
confirmed the reservations-disabled flow in a live test (see step 6). Do not present the
phone section as completed until every path below has actually been exercised on a call.

Known smoke-test reservations exist on 2026-11-19 and 2026-11-20 (Hong Kong time). Use different
dates for a clean demo.

## Preflight

```bash
cd hong-kong-cafe
curl -sS https://hong-kong-cafe-ce4e4c94-b.telnyxcompute.com/readyz
set -a
source ../.env.local
set +a
MCP_URL="https://hong-kong-cafe-ce4e4c94-b.telnyxcompute.com/mcp" npm run mcp:smoke
telnyx-edge storage kv key put <kv-id> feature/reservations_enabled true
telnyx-edge metrics hong-kong-cafe --since 15m
```

Expected readiness: secrets, KV, `DayBookings`, and `CallSession` are all true.

## 8–10 minute live demo

1. **Architecture, 1 minute.** Show the README diagram and explain the split:
   - `DayBookings` actor for atomic per-date capacity.
   - `CallSession` actor for the per-call misunderstanding counter and the single callback.
   - KV for the flag and session/selection tokens.
   - `src/core/` shared by MCP and signed shared-tool endpoints.

2. **Happy-path reservation, 2 minutes.** Call the Assistant:
   - Greeting and disclosure play verbatim.
   - Book a table for four on a non-smoke-test date.
   - Show the availability MCP call and selection-token booking in the terminal logs.
   - Confirm the reservation is read back only after a clear yes.

2a. **Seating, weather, and remark, 2 minutes.** Book a weekday table and ask to sit outside:
   - The Assistant calls `check_weather`; a weekday is sunny, so outside is confirmed.
   - Mention a birthday; the `remark` is stored and read back.
   - Ask for a Saturday outside table: the weather tool returns rainy/outdoor closed and the
     Assistant offers indoor seating instead.

2b. **Guarded lookup and date change, 2 minutes.** Ask to check and move the booking:
   - A surname is accepted only together with the phone number and booking date.
   - Show the `lookup_reservation` result with a masked phone.
   - Try a wrong phone: same `not_found` result, no booking details disclosed.
   - Move the booking to a later weekday; the time stays the same and the old date lookup
     returns `not_found`.
   - Show the booking-summary email delivered to `BOOKING_NOTIFICATION_EMAIL` (the Resend
     sandbox currently delivers only to the account owner's address).

3. **Alternatives, 1 minute.** Request a slot already filled by the demo setup. Show up to three
   same-day alternatives; if applicable, demonstrate the next-day search. Confirm the Assistant
   checks availability again when the caller accepts a different time.

4. **FAQ and MCP, 1 minute.** Ask for opening hours, address, and today’s dinner menu. Show the
   MCP `get_restaurant_info`/`get_daily_menu` calls in logs.

5. **Deterministic escalation, 2 minutes.** At a collection node, remain unclear through one
   re-ask. Show the tool-node HTTP `200`. Repeat for counts 2 and 3. On the third, show HTTP `409`
   and the workflow moving to callback collection. Confirm the saved callback and the
   `already_saved` idempotent retry.

6. **Feature-flag routing, 1 minute.** Set `feature/reservations_enabled` to `false`. Start a new
   call. Show the dynamic-variable value. Ask for the address (still answered), then ask for a
   table: the assistant says "not taking reservations right now, please call back later" with
   no details collected.
   Restore the flag to `true`.

7. **Observability and failure path, 1 minute.** Show Edge request/error metrics and the JSON
   runtime log for the same call ID. Point out masked caller, `tool`, `node`, `outcome`,
   `latency_ms`, and the MCP correlation ID. Explain that the opaque session token is never
   logged.

8. **Debugging story, 1 minute.** Use `DEBUG_LOG.md`. Lead with the callback bug:
   - Callers heard "technical issue saving the callback". Runtime logs showed two
     `request_callback` calls ending in `mcp_error` and no `callback_saved`/`callback_failed`
     event, which located the failure at argument validation. The model sent the phone as a JSON
     number; the fix coerces it and re-asks instead of failing.
   - First deploy stayed pending for about 21 minutes; actual deploy status proved it was not a
     crash, and a later ship completed normally.
   - MCP returned 503 because secrets were read from the binding object instead of
     `process.env`.
   - Live KV rejected colon keys; keys were centralized with allowed `/` separators.
   - With the reservations flag off, callers were still drawn into details collection because
     the only variable edge sat on a prompt node; the fix routes a booking request to a
     verbatim "call back later" message while FAQ keeps working.

## If real calls have not succeeded yet

Show the deployed MCP endpoint with the official SDK smoke script, `GET /readyz`, Edge metrics,
and the evidence in `DEBUG_LOG.md`. State clearly that real-call, signed-dynamic-variable, and
spoken-transition verification remain pending. Do not imitate a phone conversation and call it
a live test.

## Evidence to capture

- Phone number (`+1 603 471 5321`) and Assistant ID.
- Terminal showing `GET /readyz` all green and official MCP `tools/list`.
- One successful booking confirmation ID.
- Logs showing an MCP `tools/call` with correlated call ID.
- Escalation logs with counts 1, 2, 3 and `409` on the third.
- Dynamic-variable flag false routing evidence from a real call.
- Edge metrics and logs captured during the same call.
