# AGENTS.md

## Repository state

- This is currently a challenge scaffold, not an implemented application. `code_challenge.md` is the requirements and submission checklist; there is no root application manifest, source tree, CI, or build/test/lint/typecheck command yet. Do not invent commands or present requirements as completed functionality. Derive commands from new project files as they are added, and update this file then.

## Required solution shape

- Preserve the required end-to-end path: phone-callable Telnyx Assistant with a multi-node Conversation Workflow (prompt nodes, at least one speak node, and conditional edges), dynamic variables from a Telnyx Edge Function, and a publicly accessible custom MCP server exposing at least three useful tools. The dynamic webhook must run on Telnyx Edge Compute, not another hosting provider.
- Dynamic variables must influence workflow routing (e.g., variable-comparison edges), not merely personalize text.
- Use KV for session data, caching, or feature flags and a Stateful Actor for per-entity state requiring single-threaded read-modify-write. TypeScript functions access KV through `env` bindings; other languages use the KV REST API. Declare bindings in the generated `func.toml`.
- Instrument every webhook with structured caller/node/outcome logs and at least one additional signal (counter, latency, or correlated trace). Preserve evidence of a real debugging investigation for the required demo.

## Design guidance

- Use speak nodes for anything that must be delivered verbatim (greetings, disclosures, compliance text).
- Scope tools per workflow node; give each node only the MCP tools it needs.
- Use variable comparisons for deterministic routing and LLM conditions for intent-based routing.
- Record why each piece of state uses an Actor, KV, or plain function logic; reviewers will ask.

## Deliverables

- See "Submission Requirements" and "What to Prepare" in `code_challenge.md`. In particular: public Edge Function and MCP URLs, a callable phone number, an architecture diagram (Assistant → Workflow → Edge Function → KV/Actor → MCP), a brief demo script, and the committed OpenCode config.
- The README must cover setup, architecture, usage, observability (including how you would know within a minute that the assistant is broken and what you would look at first), and the debugging story.

## Telnyx and OpenCode tooling

- Keep `@telnyx/opencode` enabled in `.opencode/opencode.json` and `.opencode/tui.json`; the challenge requires Telnyx-hosted models for development. Both files are submission deliverables and must be committed. Authenticate with `opencode auth login --provider telnyx --method "API Key"` and verify with `opencode auth list`. Select current models through `/telnyx` in the TUI rather than relying on example model IDs in the challenge.
- `.opencode/package.json`, `.opencode/package-lock.json`, and `.opencode/node_modules/` are tool-managed and ignored by `.opencode/.gitignore`; do not treat them as application dependencies. Application code needs its own manifest and lockfile.
- The challenge's `telnyx-edge` install command is Linux amd64 only; on macOS download the matching archive (e.g., darwin arm64) from the `team-telnyx/edge-compute` releases page.
- Scaffold TypeScript functions with `telnyx-edge new-func <name> -l typescript`; deploy from the function directory with `telnyx-edge ship`.

## Secrets

- Never commit Telnyx API keys, tokens, or other credentials. Keep them in function secrets/environment configuration or local untracked files.

## Verification

- Once checks exist, run the project's real focused and full checks. For the delivered system, exercise an actual MCP tool call, dynamic-variable routing, KV/Actor state changes, and happy, fallback, escalation, and negative workflow paths through the live assistant.
