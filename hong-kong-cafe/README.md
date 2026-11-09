# hong-kong-cafe Edge Function

Deployable Telnyx Edge backend for the Hong Kong Cafe voice assistant. See the repository
root `README.md` for architecture, endpoints, state design, deployment, and observability.

## Commands

```bash
npm install
npm run check
telnyx-edge types
telnyx-edge ship --yes
```

## Layout

| Path | Purpose |
| --- | --- |
| `telnyx.toml` | Generated function identity, actor bindings, KV binding |
| `src/index.ts` | Actor exports and Edge fetch entrypoint |
| `src/app.ts` | Hono route composition |
| `src/actors/` | `DayBookings` and `CallSession` actors |
| `src/core/` | Pure reservation, availability, callback, and token logic |
| `src/routes/` | Dynamic variables, MCP, and signed misunderstanding routes |
| `src/mcp/` | JSON-RPC transport and six MCP tools |
| `src/lib/` | Logging, auth, secrets, signatures, and time helpers |
| `tests/` | Vitest unit and local integration tests |
