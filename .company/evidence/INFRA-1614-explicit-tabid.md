Rol: developer · Fecha: 2026-11-27T09:20Z · Sesión: d0291773-75ea-4eb0-be0c-1cf6c31f2bae · Estado: LISTO

# Evidencia INFRA-1614 — explicitTabId llega al cable

## Reproducción en producción (antes del fix, 2026-11-27 ~08:30-08:45 UTC)

Ejecutado desde el pod de la sesión contra el servidor desplegado (`canon-94b33bb`) vía el gateway
`http://127.0.0.1:8790/browser`, fijando `connection` a atlantic (`c4f1a5d2-…`) y a casa
(`7f8bd49b-…`):

- `race.mjs` (dos sesiones MCP, cada una con su pestaña, evaluates en paralelo, fijadas al MISMO Chrome —
  verificado: la lista de A contiene la pestaña de B): `RESULTADO: PASS` (A=OK-A, B=OK-B).
- Control secuencial (evaluates uno detrás de otro): `SEQ A= OK B= OK`.
- Sesión única con una sola pestaña propia: `SOLO= OK` (lee `example.com/solo-A`, no la pestaña activa ajena).
- Casa (segundo Chrome reiniciado), sesión única: `CASA A= https://example.com/casa-A`.
- Zip publicado descargado de `/download` (2.7.1.243): el bundle del service worker
  (`assets/index.ts-DXB8n3iL.js`) contiene el ruteo (`routeToTargetTab` minificada, `TAB_GONE`,
  `connectTab` antes de ejecutar): la extensión desplegada SÍ rutea por `targetTabId`.

Conclusión: el sangrado sesión→pestaña que midió IT (00:46/00:50 UTC) no se reproduce hoy en ninguno de los
dos Chrome reiniciados. `race.mjs` de IT no fija `connection`: el default (`lastUsed`) pudo caer en una
conexión con extensión de linaje viejo sin ruteo (casa servía 2.7.2.243 sin ruteo hasta el reinicio, según
DGX-1883; hay dos Chrome de Mac conectados además). Eso queda como hipótesis no probada; lo probado es que
el stack desplegado pasa los tres controles.

## Test que falla (causa secundaria, el defecto de código real)

Nuevo test en `packages/core/tests/http-routes.test.ts`
(«honours an explicit tabId on a routed command instead of the session's own tab (INFRA-1614)»):
sesión con pestaña propia (500) + `browser_evaluate` con `tabId: 1` (pestaña del usuario).

Antes del fix (FAIL, exacto como documenta DGX-1875 §5 — el `tabId` explícito jamás llega al cable):

```
FAIL packages/core/tests/http-routes.test.ts > tools/call through an MCP session > honours an explicit tabId …
AssertionError: expected { …(3) } to match object { payload: { …(2) } }
- Expected  "targetTabId": 1
+ Received  "targetTabId": 500
Tests  1 failed | 17 passed (18)
```

## Fix

`packages/core/src/http/server.ts` (`callTool`): extraer `args.tabId` para los comandos que aceptan un
objetivo explícito (`acceptsExplicitTab`, exportado ahora desde `session-tabs.ts`) y pasarlo a
`sessionTabs.route(..., { explicitTabId })` antes de que el zod del handler lo pode. Un-shot: el `tabId`
explícito no pasa a ser la pestaña de la sesión (conducta ya documentada en `session-tabs.ts`).

## Suite tras el fix

```
$ npm run build && npx vitest run packages/core/tests/http-routes.test.ts packages/core/tests/session-tabs.test.ts
✓ packages/core/tests/session-tabs.test.ts (13 tests)
✓ packages/core/tests/http-routes.test.ts (18 tests)
Test Files  2 passed (2) · Tests  31 passed (31)

$ npm test   (suite completa, pretest incluye build)
Test Files  33 passed (33) · Tests  465 passed (465)

$ npm run typecheck   → sin errores
$ company-duplicados  → sin duplicación nueva (jscpd, umbral 12 líneas)
```

## Criterios

- C1 (race.mjs y control secuencial dan PASS, cada sesión lee SU URL): verificado en producción sobre los
  dos Chrome reiniciados (sección «Reproducción», arriba) — ya se cumple con la extensión 243 desplegada.
- C2 (`browser_evaluate` respeta la pestaña de la sesión aunque otra esté activa): verificado en producción
  (control SOLO y casa); cubierto además por los tests existentes de `session-tabs`.
- C3 (un `tabId` explícito llega al cable como `targetTabId`; `explicitTabId` deja de ser código muerto):
  test nuevo de esta PR, FAIL antes / PASS después; suite completa verde.
