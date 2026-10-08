# browser-harness-v3 (INFRA-721, M4b)

- **Old surface:** `docs/contracts/browser-harness-v2.md`: negotiated catalog of 40 tools, digest `sha256:f7e7d2f5…cfe9b5` (`TOOL_CATALOG_V2`, `CATALOG_VERSION_V2`). Left unchanged and marked deprecated.
- **New surface:** `docs/contracts/browser-harness-v3.md`: `TOOL_CATALOG` = v2 + `browser_fill_secret` (server-side) + `browser_passkey` (capability `passkey`), digest `sha256:5fdec80d…2f7`; argument schemas in `packages/protocol/src/tool-args.ts`. Legacy endpoint gains `AGENT_BROWSER_CONNECTION_LABELS`, `AGENT_BROWSER_DEFAULT_CONNECTION`, `AGENT_BROWSER_OP_BIN`, `BROWSER_EXTENSION_DIR` and `GET /download/latest.json` (additive).
- **Who moves:** the extension re-vendors the protocol tgz from this repo (done in the paired PR; until then a v2 browser is rejected with `catalog_version_mismatch` on `/ws/harness`, the legacy endpoint is unaffected); the image pin (INFRA-391) only after both PRs are merged. Nothing is deployed by this change.
- **Decision recorded in:** INFRA-721 `00-spec.md` (C7a-C7g) and INFRA-383 `nota-architect-plan.md`; the fork inventory is in INFRA-721 `50-entrega.md`.
