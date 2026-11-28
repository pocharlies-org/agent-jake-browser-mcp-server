# Browser Harness negotiated wire contract (v3)

Status: **active, experimental package `0.1.0`**. Supersedes [`browser-harness-v2.md`](browser-harness-v2.md) (deprecated, kept
as it was) and, through it, `browser-harness-v1.md`. Source of truth: `packages/protocol` (`@agent-jake-browser/protocol`);
this document explains the difference with v2 and never defines a second copy.

## What changed with respect to v2

Only the tool set. Frames, state machine, identity, limits and errors are v2's, word for word.

| | v2 | v3 |
| --- | --- | --- |
| catalog | `TOOL_CATALOG_V2`, 40 tools | `TOOL_CATALOG` = v2 unchanged + `browser_fill_secret` + `browser_passkey` + `browser_find_tab` + `browser_close_window` + `browser_claim_tab` (45 tools) |
| catalog digest (`CATALOG_VERSION`) | `sha256:f7e7d2f5178afea3caa13fd262b7e1c81afe94cf550bbaceea3bd30e25cfe9b5` (`CATALOG_VERSION_V2`) | `sha256:45c70ee0c7164b34be43e83a7c6c66594d092fe9bedbc2c39249acf6869a2c0e` |
| wire version in the hello | `1` | `1` (the digest, not the wire integer, names the tool set) |

The hello compares the digest by exact equality (v2, unchanged): a browser that vendored the v2 catalog is rejected with
`hello_reject catalog_version_mismatch` and close `4406` until it vendors the v3 protocol. The v2 digest is pinned by a test
(`packages/protocol/tests/catalog-v3.test.ts`): editing it means the contract was edited, which is not allowed.

## Added tools

| tool | risk | where it runs | schema |
| --- | --- | --- | --- |
| `browser_fill_secret` | dangerous | server process (`serverSide`): reads `op read <op://ref>` locally, then sends `browser_type` with `secret: true`. The browser never receives this name or the reference. | `FILL_SECRET_ARGS` |
| `browser_passkey` | dangerous | browser, behind the `passkey` capability the browser must offer in its hello; without it the caller reads `capability_unavailable` and nothing is sent | `PASSKEY_ARGS` |

Argument schemas of the added tools live in `packages/protocol/src/tool-args.ts`. The older tools' schemas stay in core until
M1B.3, as in v2.

## Secrets

The secret value exists in the server process only between `op read` and the `tool_request` frame, and in the browser only
while it is typed. It is not in the MCP arguments or result, not in any error (the server removes it from whatever the browser
answers), not in server logs, and the extension keeps tool payloads out of its activity history. `AGENT_BROWSER_OP_BIN`
selects the executable; the deployment's wrapper chooses the 1Password backend.

## Selection of the browser

The negotiated endpoint binds per MCP session through the `SessionBroker`, exactly as in v2 (1 → auto-bind, N →
`browser_selection_required`). `AGENT_BROWSER_CONNECTION_LABELS` and `AGENT_BROWSER_DEFAULT_CONNECTION` do **not** apply
here: connection ids are server-issued per socket and a browser's label is only its own claim, so neither is an identity the
server can verify. They apply to the legacy endpoint (deprecated v1 surface), where connection ids are stable.

## Per-session tab routing (`targetTabId`)

The legacy endpoint (the deprecated v1 surface: `POST/GET/DELETE /mcp` plus the extension's plain WebSocket) routes each MCP
session to its own tab on a shared browser (`packages/core/src/session-tabs.ts`; tab ownership lives in
`packages/core/src/tab-reaper.ts`). A routed command carries that tab in the `tool_request` payload as `targetTabId`: the
session's own tab (`session-tabs.ts`, `route`), or the tab the caller named with the optional `tabId` argument.

`targetTabId` is routing metadata from server to extension, not a tool argument:

- It is in no tool's argument schema, not in the vendored protocol pack, and not in the MCP arguments. The caller names the
  target with `tabId` on commands that do not carry one of their own (`acceptsExplicitTab`); the server deletes it from the
  arguments and turns it into `targetTabId` on the wire (INFRA-1614).
- The extension strips `targetTabId` from the payload before parsing it (agent-browser-extension, `routeToTargetTab`), so no
  tool's argument parser ever sees the field.
- The tab reaper counts a command carrying `targetTabId` as use of that tab, and its protections apply to a tab routed this
  way: the URL-check before closing, the `closeById` echo, the `exclusive()` serialization and `keepUntil`
  (the `keepOpenMinutes` hold).

The field is additive and compatible in both directions. An old extension does not know it, ignores it and runs the command
on the tab it has connected, which is the one-tab behavior from before session routing. A new extension that receives a
command without it passes the payload through as before. So it bumps no protocol version (`SUPPORTED_PROTOCOL_VERSIONS`
stays `[1]`), changes no catalog digest and adds no schema to the pack, whose bytes are pinned by
`packages/protocol/tests/artifact.test.ts`. The negotiated endpoint, the surface of this document, never carries it: it
routes tabs through the broker's `tabHandle` (see the wiring comment in `packages/core/src/http/server.ts`).
