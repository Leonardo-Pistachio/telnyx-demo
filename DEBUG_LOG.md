# Debug Log

## 2026-11-09 — First Edge deployment remained pending

**Symptom:** `telnyx-edge list` showed `hong-kong-cafe` as `deploying` more than twelve
minutes after upload. `telnyx-edge ship status hong-kong-cafe --logs` said the latest build
succeeded, while the deployment JSON reported `build_status: "build_ok"`,
`deploy_status: "pending"`, and `active: false`.

**Evidence:** The invoke URL served the new Hono application (`GET /` returned the expected
service JSON and `/health/liveness` returned `ok`). A second `telnyx-edge ship --yes` was
rejected with HTTP 409: `A ship or delete operation is already in progress`. Runtime logs
showed several `SIGTERM received, shutting down` lines and no startup exception.

**Status:** Resolved. The server-side operation eventually completed and the function reached
`deploy_ok` at 04:38 UTC, about 21 minutes after upload. A subsequent ship completed in about
4 minutes. The delay was in platform deployment, not the build or application startup.

## 2026-11-09 — KV key format rejected by the live API

**Symptom:** Setting the feature flag failed with
`HTTP 400 ... Invalid key format. Allowed characters: a-z A-Z 0-9 - _ / = .`

**Investigation:** Unit tests used an in-memory KV and therefore did not enforce the real
API's key-character rules. The implementation used colon-prefixed keys such as
`feature:reservations_enabled`, `session:<token>`, and `callback:<hash>`.

**Fix:** Centralized all KV keys in `src/core/kv-keys.ts` using `/` separators
(`feature/reservations_enabled`, `session/<token>`, `selection/<token>`,
`callback/<hash>`) and updated tests. The feature flag was then written successfully.

**Live verification:** The deployed MCP booking flow exercised selection-token writes, and the
deployed session flow exercised CallSession counters and callback KV storage.

## 2026-11-09 — Live deployment verification

- `GET /readyz`: `200`, with secrets, KV, `DayBookings`, and `CallSession` all true.
- Official MCP SDK client: discovered all six tools and invoked `get_restaurant_info`.
- Unauthenticated `POST /mcp`: `401`.
- Unsigned dynamic-variables and misunderstanding webhooks: `403`.
- MCP booking smoke: `confirmed`, retry `already_confirmed`; concurrent last-seat requests had
  exactly one success and one `slot_taken` conflict.
- Session smoke: misunderstanding counts `1, 2, 3`, escalation true; callback first `saved`,
  retry `already_saved`.
- Persistence: a booking created before a redeploy still made the same future slot unavailable
  for five guests after the redeploy.
- Correlation: an MCP `record_misunderstanding` call logged the trusted `call_id` resolved from
  the opaque session token; the token itself was not logged.

**Not verified:** A real phone call and a Telnyx-signed dynamic-variables request. The account
has no phone number, and phone provisioning was explicitly deferred by the user. The Assistant
is provisioned, but phone-number attachment and the resulting live workflow paths remain
incomplete.

## 2026-11-09 — MCP returned 503 after deploy

**Symptom:** Authenticated and unauthenticated `POST /mcp` requests both returned
`503 {"error":"MCP is not configured"}`, despite `telnyx-edge secrets list` showing
`MCP_API_KEY` and `TELNYX_PUBLIC_KEY`.

**Investigation:** The route read the secret from the Edge binding object
(`context.env.MCP_API_KEY`). Edge documentation confirms that `telnyx-edge secrets add`
injects organization secrets as **container environment variables**, available as
`process.env.NAME`; the `env` binding object is for manifest-declared resources. Runtime logs
showed the route correctly rejecting the request with `error_code: "not_configured"`.

**Fix:** Added `getRuntimeSecret()` using `process.env` and a regression test that sets the
secret through the environment. Edge secrets must be baked in at deploy time, so a redeploy is
still required before this fix can be verified live.

**Follow-up:** After the corrected revision deployed, `GET /readyz` returned all four checks
green. The official MCP client then completed `initialize`, `tools/list`, and `tools/call`
against the public endpoint. The secret issue is fixed and live-verified.

## 2026-11-11 — POC demo update: live verification and Resend sender restriction

**Deployed:** 60-minute reservations with a 21:00 last slot, seating preference, special-
occasion remark, weather tool, guarded lookup, and date-only moves. `GET /readyz` was green and
the official MCP SDK client listed all nine tools.

**Live demo smoke (`npm run mcp:demo-smoke`):**
- `check_weather` returned sunny for a weekday and rainy for a Saturday.
- An outside booking on a weekday was confirmed with `seating: "outside"` and the remark.
- Lookup with only the surname returned the booking with a masked phone (`***4567`).
- Lookup with the wrong phone returned the same `not_found` result.
- `change_reservation_date` moved the booking to the next weekday, kept `15:00`, and the old
  date lookup returned `not_found`.

**Email failure:** The fresh confirmation attempted a Resend send and logged
`booking_email_failed` with `status: 403`. The provider response was
`{"message":"You can only send testing emails to your own email address
(jackchan12382@gmail.com)...","name":"validation_error"}`. The booking remained confirmed;
email failure did not roll it back.

**Fix pending:** Verify a sending domain in Resend, set `EMAIL_FROM` to an address on that
domain, and re-ship so the secret is baked into the runtime. Delivery to
`imt183404@gmail.com` is not verified yet.

**Resolved for the demo:** Per the owner's instruction, `BOOKING_NOTIFICATION_EMAIL` was
changed to the Resend account owner's address (`jackchan12382@gmail.com`) and the function was
re-shipped. The demo smoke then returned `email_sent: true`, and runtime logs recorded
`booking_email_sent` (`result: res_e17bb227-4950-4b04-975b-e549408e36c6`). Delivery to
`imt183404@gmail.com` still requires a verified domain plus `EMAIL_FROM`.

**Not verified:** A real phone call; the workflow was re-provisioned but no number is attached.

## 2026-11-11 — Assistant promised callers a confirmation email

**Symptom:** Near the end of a call the assistant told the caller a confirmation email would
be sent. The notification email is internal to the restaurant and must not be promised.

**Cause:** The `create_reservation` MCP result included `email_sent: true/false`. The model saw
that field and described it to the caller as a confirmation email.

**Fix:** Removed `email_sent` from the booking-service/MCP result so the model receives no
email signal; sending and its success/failure logging are unchanged. Added an explicit rule to
the assistant instructions and the confirm node: never mention email or notifications to
callers. Updated the MCP flow test to assert the field is absent and dropped it from the demo
smoke output.

**Verification:** Re-shipped and re-provisioned. The live `create_reservation` result no longer
contains `email_sent`, while runtime logs still record `booking_email_sent`
(`res_25e31157-c44f-488a-99f0-56bdad706199`), proving the internal email still sends. The
spoken behavior must be confirmed on the next real call.

## 2026-11-11 — Assistant repeated the booking confirmation

**Symptom:** The assistant read the booking details back several times per call.

**Cause:** Two pre-booking read-backs (reservation node slot read-back plus the confirm node
full read-back) and a post-success read-back encouraged by the `e_confirm_booked` edge
condition ("the confirmed reservation details were read to the caller").

**Fix:** The reservation node now goes straight to confirmation after availability; the confirm
node performs the only full read-back; after success the assistant says one short sentence with
the date and time only; the booked edge now only requires that the caller was told the booking
is confirmed.

**Verification:** `npm run check` passed (70/70) and the assistant was re-provisioned. Fetching
the live Assistant config confirmed all updated instruction text is active. The spoken result
needs confirmation on the next real call.

## 2026-11-11 — "Technical issue saving the callback information"

**Symptom:** Callers heard a technical-failure message instead of a saved callback.

**Evidence:** Runtime logs for a real call showed `dynamic_variables_resolved` success, then two
`request_callback` MCP calls failing with `mcp_error`. No `callback_saved`/`callback_failed`
tool event appeared, which meant the handler returned before calling the callback service —
i.e. the Zod argument validation failed (that path logged nothing).

**Cause:** The assistant sometimes sends the phone as a JSON number or an incomplete value;
the strict string schema rejected it silently, and the escalate node treated any tool error as
a system failure.

**Fix:** Simplification requested by the owner: callback requests are no longer stored in KV
with hashing/TTL/conflict logic. The trusted call's `CallSession` Stateful Actor now stores a
single callback record (first save wins; retries return `already_saved`), and a fresh save
sends a Resend summary email (same recipient configuration as booking emails). The
`request_callback` schema now coerces numeric phones, logs invalid arguments by field name
only, and the escalate node re-asks for the number instead of declaring a technical failure.

**Verification:** `npm run check` passed (73/73). After deploy, the live session smoke returned
`callback_first: saved` and `callback_retry: already_saved`; runtime logs recorded
`callback_email_sent` (`cb_b58fdfb9-fbc3-4aea-b69e-3b7a2dbb4d69`) exactly once and only
`already_saved` on the retry.

## 2026-11-11 — Reservations-disabled flag did not reject cleanly

**Symptom:** With `feature/reservations_enabled` set to `false`, the assistant still asked the
caller for details instead of declining a booking and asking them to call back later.

**Cause:** The only `reservations_enabled == "false"` edge was on Identify Intent, a prompt node,
and it pointed at Escalate (callback number collection). Edges on a prompt node are evaluated
after the model's turn, so the caller was drawn into a details-collection conversation first.

**First fix (wrong behavior):** Moved the variable edge onto the Greeting speak node, routed to a
new verbatim "Reservations Unavailable" speak node. Speak-node edges evaluate immediately, so the
call was rejected before the caller spoke, which also blocked FAQ questions the caller was still
allowed to ask.

**Final fix:** Removed the greeting flag edge. Identify Intent now has an LLM edge, listed before
the booking edges, that routes "caller wants to make, check, or move a reservation while
`reservations_enabled` is false" to the Reservations Unavailable message. The assistant
instructions include `Reservations enabled: {{reservations_enabled}}` so the model can judge it.
The variable edges on Reservation, Confirm Booking, and Check Or Change Booking now point at the
same message as a backstop.

**Verification:** `npm run check` passed (75/75) including tests that the greeting never rejects
and the closed-reservations edge precedes the booking edges. The live Assistant was fetched after
re-provisioning and showed 16 nodes and the expected Greeting/Identify edges. The owner then
confirmed in a live test that, with the flag off, FAQ questions are answered and a booking request
is rejected with "call back later".

**Trade-off:** This path is decided by the model for the FAQ-vs-booking split. The variable
backstop on the booking nodes covers misrouted callers. No log capture was saved for the owner's
live test, so this verification rests on the owner's report.
