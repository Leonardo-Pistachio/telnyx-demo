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
