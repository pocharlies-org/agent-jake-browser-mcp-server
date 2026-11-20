Rol: developer · Fecha: 2026-11-20T04:30:00Z · Sesión: 9a335fc5-dc88-405f-98fd-a48477a22e13 · Estado: LISTO

# INFRA-1465 — entrega: gate `AGENT_BROWSER_FILL_SECRET_ENABLED` (comportamiento del fork)

## Qué se ha hecho

Segunda PR de la historia (la primera, `browser_save_secret`, ya está fusionada en `master` como `b527f06`, PR #18).
Esta PR cierra C1c: porta del fork `jibanez-staticduo/agent-jake-browser-mcp-server` (commits `a2396f5`/`7fcbe99`,
SC-2115/SC-2102) al layout `packages/core/` del canónico:

- **Gate doble** con el patrón de gate por env del registro (`packages/core/src/tools/index.ts`): `getAllTools()`
  no anuncia `browser_fill_secret` salvo `AGENT_BROWSER_FILL_SECRET_ENABLED === 'true'`; el wrapper `fillSecretTool`
  (`packages/core/src/tools/interaction.ts`) falla con `Secret filling is disabled on this server.` antes de parsear
  o leer. **Default: deshabilitado** (el del fork), documentado en `README.md`.
- **Lector inyectable**: `Context.readSecret?: SecretReader` en `packages/core/src/types.ts`; `fill_secret` usa
  `context.readSecret ?? readSecret`.
- **`result.typed === true` y `result.verified === true` obligatorios** (booleanos estrictos, `success === true`,
  sin `warning`); cualquier otro aviso es error.
- **Mensajes de error saneados**: ni la referencia `op://…`, ni stderr del lector, ni el texto de la extensión
  aparecen en el resultado; éxito con confirmación fija `Filled and verified the target field.`
- **`browser_type`** saca a la luz el `warning` de verificación del campo (igual que el fork).
- **Tests**: `packages/core/tests/fill-secret-safety.test.ts` (nuevo, adaptado del fork) y
  `packages/core/tests/fill-secret.test.ts` actualizado a los mensajes y acknowledgement del fork;
  `http-routes.test.ts` no hereda el gate del host.

**PR**: https://github.com/pocharlies-org/agent-jake-browser-mcp-server/pull/19 (contra `master`, lista,
head `b623540`). `packages/protocol` intacto → sin tgz vendorizado que regenerar, sin PR pareada en la extensión.

## Cómo verificar

En un clone de la rama `INFRA-1465-gate` (Node 22):

- `npm ci && npm run typecheck` → sin errores.
- `npx vitest run packages/core/tests/fill-secret-safety.test.ts packages/core/tests/fill-secret.test.ts packages/core/tests/save-secret.test.ts packages/core/tests/save-secret-wire.test.ts` → 4 files, 101 tests passed.
- `npm test` (pretest build + suite completa) → 30 files, 405 tests passed.
- `npm run test:contract` (lista del job contract) → 17 files, 206 tests passed.
- Comportamiento del gate: con la variable ausente o `false`, `getAllTools()` no incluye `browser_fill_secret`
  y la invocación directa devuelve el error `disabled` sin leer el secreto (test `fill-secret-safety.test.ts`).

## Checklist `00-spec.md`

- [x] **C1a** — el canónico contiene `browser_save_secret` (fusionado en `b527f06`) y el código del gate con el
  comportamiento del fork (en `master` al fusionar esta PR; verificado en la rama: `packages/core/src/tools/interaction.ts`,
  `packages/core/src/tools/index.ts`, `packages/core/src/types.ts`).
- [x] **C1b** — los tests del port corren en la suite del CI del canónico y pasan (medido localmente con los
  comandos exactos del job Product CI: `npm run typecheck` limpio, `npm test` 405/405; el verde en el runner
  queda a la espera del run de la PR).
- [x] **C1c** — comportamiento del gate igual que el fork: ausente/`false` ⇒ no se expone y la invocación falla con
  el mensaje del fork antes de parsear o leer; `true` ⇒ funciona. Cubierto por `fill-secret-safety.test.ts` y
  `fill-secret.test.ts`, que corren en el CI del canónico.

## Reutilizado

- **Del código existente**:
  - `packages/core/src/tools/index.ts` — el filtro del registro que la PR #18 puso para `browser_save_secret`
    (`isSaveSecretConfigured`); el gate del fill se añade a ese mismo filtro, no a uno paralelo.
  - `packages/core/src/tools/types.ts` — `createTool`/`textResult`/`errorResult` (el wrapper del gate imita el
    patrón del wrapper `saveSecretTool` ya fusionado).
  - `packages/core/tests/fake-context.ts` — `fakeContext` (firma idéntica a la del helper del fork; el test
    portado solo cambia la ruta del import).
  - `packages/core/tests/harness-fixture.ts` + `callToolViaHarness` — la prueba del endpoint negociado se
    conserva del test canónico, solo con el acknowledgement nuevo.
  - `FILL_SECRET_ARGS` de `@agent-jake-browser/protocol` — el esquema de argumentos no se toca (contrato v3 intacto).
- **Buscado** (`rg -n "FILL_SECRET_ENABLED" packages/`, `rg -n "fakeContext" packages/core/tests/*.ts`,
  `rg -n "isSaveSecretConfigured" packages/core/src`, `rg --files | rg fill-secret`): no había en el canónico
  ningún gate de fill ni helper de contexto alternativo; el único registro es `getAllTools`.
- **Escrito nuevo y por qué**: `fill-secret-safety.test.ts` (no existe en el canónico; es el test del fork que
  exige C1c); el wrapper `fillSecretTool` con gate + `hasFieldWarning` + exigencia `typed`/`verified` (el
  `fillSecretTool` canónico era la versión INFRA-721 sin gate, que el fork corrigió); `SecretReader`/`Context.readSecret`
  en `types.ts` (el lector inyectable del fork no está tipado en el canónico).
