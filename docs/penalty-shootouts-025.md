# Tandas de penales — implementación local 025

## Alcance y archivos

Implementación local, sin deploy, escritura remota ni cambios en `.env.local` o migraciones 001–024.

Creado:

- `supabase/migrations/025_penalty_shootouts.sql`: modelo, permisos, RPC, snapshots y protecciones.
- `supabase/tests/025_penalty_shootouts.sql`: integración SQL, permisos, W.O. y cruces.
- `src/PenaltyShootout.tsx`: visualización y control compartidos, modales y reintentos.
- `src/lib/penalties.ts`: tipos de tanda y lanzamiento.
- `tests/browser/penalty-shootout.spec.ts`: tanda, correcciones, respuesta perdida, notificaciones, calendarios y cuatro anchos.
- `tests/vite.isolated.config.ts` y `playwright.isolated.config.ts`: servidor de pruebas sin archivos `.env`, con URL de API ficticia `127.0.0.1:59999`.
- Este informe.

Modificado en esta implementación: `MatchControlPage.tsx`, `PublicPages.tsx`, `index.css`, `lib/tournament.ts`, `lib/useLiveRefresh.ts`, `tests/run-sql.mjs`, `tests/playoffs-simulation.mjs`, `tests/browser/tournament.spec.ts` y `tests/browser/match-clock.spec.ts`. Se conservaron los cambios locales de la tarea anterior.

## Modelo SQL y permisos

`penalty_shootouts`: un registro por partido, primer equipo, revisión, request de inicio y fechas de inicio/finalización. El ganador definitivo se conserva en `matches.tiebreak_winner_team_id`, sin duplicarlo en la tabla.

`penalty_shootout_attempts`: UUID, partido, equipo, secuencia, convertido booleano, request_id único, created_at, updated_at y voided_at. Índice único parcial por partido/secuencia para tiros vigentes. No tiene player_id y nunca inserta GOAL.

`penalty_shootout_operations`: recibos inmutables de las operaciones, payload, snapshots anterior/posterior y fecha. Sirve para idempotencia y auditoría de correcciones. No se concede lectura pública de esta tabla. RLS en las tres tablas; anon solo lee las dos tablas de visualización y ejecuta las RPC autorizadas. Las mutaciones directas están revocadas. Se mantiene el modelo de acceso anon existente; esta tarea no agrega autenticación administrativa.

Las correcciones no hacen DELETE. Anular marca voided_at y deja reutilizable esa posición para el siguiente tiro. El borrado completo de un partido mediante el mecanismo existente elimina sus registros dependientes por FK cascade, como los demás datos del encuentro.

## RPC y flujo

- `start_penalty_shootout(match_id, first_team_id, request_id, expected_updated_at)`: bloquea el partido, comprueba versión, eliminatoria empatada sin ganador y segundo tiempo cumplido (900 segundos), excluye W.O. y guarda quién inicia. Se admite segundo tiempo corriendo o pausado desde ese período.
- `manage_penalty_shootout(match_id, action, team_id, attempt_id, converted, request_id, expected_revision)`: operaciones RECORD, CORRECT, VOID y FINISH bajo bloqueo de partido/tanda.
- `penalty_shootout_snapshot(match_id)`: lectura compartida con equipo inicial, revisión, turno, marcador, tiros ordenados y ganador confirmado.

Se reutiliza PAUSADO para detener el reloj durante la tanda, evitando cambiar el enum y los índices de partido activo. El snapshot `shootout` identifica la fase visual PENALES. Un trigger adicional bloquea reanudar/finalizar por las acciones ordinarias durante la tanda. También se bloquean nuevos eventos reglamentarios y anulaciones de goles que alterarían el empate. La cronología, tarjetas y estadísticas continúan visibles.

La alternancia se deriva del primer equipo y del número de tiros vigentes. El servidor comprueba el equipo de turno. No se fijan tres/cinco tiros, rondas máximas, muerte súbita ni cierre automático.

Idempotencia: UUID de solicitud, recibo con payload exacto y revisión esperada. Un reintento idéntico devuelve el snapshot vigente sin repetir la mutación; reutilizar el UUID con otro payload se rechaza. La revisión evita aplicar un segundo envío obsoleto. El navegador bloquea botones durante la solicitud y conserva la operación pendiente en sessionStorage para reintentar el mismo UUID tras una respuesta perdida o recarga.

El marcador se calcula contando exclusivamente tiros vigentes convertidos por equipo. GF/GC, DG, puntos, goleadores y marcador reglamentario no utilizan estas tablas.

## Correcciones y finalización

Se puede cambiar convertido/fallado en cualquier tiro vigente. Solo se puede anular el último tiro vigente, restaurando su turno. Ambas operaciones quedan auditadas.

FINISH exige al menos un tiro de cada equipo y marcadores diferentes. La UI muestra confirmación con ganador derivado del resultado. La RPC vuelve a validar bajo bloqueo; no recibe un ganador elegible manualmente. Confirma la tanda, escribe `tiebreak_winner_team_id` y finaliza el partido en la misma transacción.

En una tanda ya finalizada, se admiten correcciones y anulación del último tiro únicamente si siguen existiendo tiros de ambos equipos y el mismo ganador con marcador desigual. Se rechaza empatar o cambiar el ganador incluso si todavía no se generaron los siguientes cruces. Rectificar un ganador confirmado requiere un flujo posterior explícito; no se reabren encuentros ni se regeneran cruces automáticamente.

## Compatibilidad y snapshots

La definición completa de `get_match_control` de 024 se conserva como `get_match_control_before_025`. Una envoltura agrega `shootout`. `match_outcome` y `get_tournament` ya consumen ese snapshot; reciben los nuevos datos sin consultas HTTP por tarjeta ni reemplazar su lógica acumulada. Las pruebas comprueban esa propagación real.

No se sustituye `guard_tournament_match` ni `guard_tournament_event`: se agregan protecciones específicas de tanda. Así permanecen las funciones añadidas en 022–024, incluidos W.O., autogoles y correcciones históricas.

`set_penalty_winner` permanece para compatibilidad con partidos sin tanda registrada. Con tanda registrada se rechaza: el ganador debe proceder de FINISH. Los resultados históricos conservan su etiqueta, sin inventar tiros ni marcador de penales.

## Interfaz y Realtime

INICIAR PENALES abre el modal del primer equipo. El control muestra marcador separado, símbolos ✓/✕ con nombres accesibles, pendiente ○, siguiente equipo y botones GOL/CONVERTIDO y FALLÓ/FALLADO. Tocar un tiro abre el modal de corrección. FINALIZAR TANDA está deshabilitado con empate o sin tiro de ambos equipos.

Inicio muestra la tanda durante el partido y conserva estadísticas/cronología. Calendario público muestra el reglamentario, marcador de penales, tiros y ganador. `/admin/calendario` reutiliza el mismo componente con correcciones habilitadas. No hay recarga completa de página.

`penalty_shootouts` y `penalty_shootout_attempts` se agregan a `supabase_realtime` y a `useLiveRefresh` dentro de su canal existente. Las notificaciones refrescan snapshots; no se tratan como GOAL ni disparan celebraciones de gol. Se mantienen recarga al reconectar y sondeo de respaldo.

## Simulación y verificaciones

La simulación PGlite carga 001–025 en memoria y utiliza las RPC con rol anon:

| Partido | Reglamentario | Penales | Ganador |
|---|---|---|---|
| Semifinal 1 | A 2–1 D | — | A |
| Semifinal 2 | B 1–1 C | 2–3 | C |
| Final | A 2–2 C | 3–2 | A |
| Tercer puesto | D 3–1 B | — | D |

Podio A, C, D, B. Se conserva la tabla regular y los 23 goles normales, con goleadores A=8, B=5, C=5 y D=5. MUJERES cierra independientemente de VARONES. La simulación verifica 48 rechazos de operaciones inválidas, reintentos, correcciones y snapshots. La suite SQL comprueba además selección del visitante para comenzar, permisos, exclusión de regulares/W.O., prohibición de iniciar antes de tiempo o sin empate y publicación Realtime.

Evidencia reproducible: `test-results/playoffs-simulation.json`, generado por `node tests/playoffs-simulation.mjs`. No es una base persistente.

Resultado final de validación:

- Build y lint: PASS.
- Pruebas unitarias existentes: 17/17 PASS.
- Navegador: 10 escenarios nuevos y 44 regresiones relevantes, todos PASS tras repetir los fixtures corregidos. Se actualizaron las expectativas del selector manual antiguo; los fixtures del reloj ahora devuelven hora de servidor actualizada durante el sondeo y controlan explícitamente el tiempo simulado.
- Suite SQL local 001–025, incluido test 025 y conservación de datos anteriores: PASS.
- Simulación completa con dos tandas, podio e independencia de categorías: PASS, 48 rechazos esperados verificados.
- Se inspeccionó también una captura móvil de la tanda para comprobar contraste y símbolos.

Comandos locales:

```text
npm run build
npm run lint
npm test
node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js
node tests/playoffs-simulation.mjs
npx playwright test tests/browser/penalty-shootout.spec.ts --config playwright.isolated.config.ts
```

Limitación de validación: PGlite comprueba SQL y publicación; Playwright entrega notificaciones al hook real con API simulada. No se probó el transporte WebSocket de Supabase real. El build conserva el aviso de bundle mayor de 500 kB. La 025 sigue exclusivamente local y requiere aplicarse junto con el frontend cuando se autorice una publicación futura.
