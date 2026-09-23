# Copa San Martín 2026: cierre por categoría y eliminatorias automáticas

Implementación local de la solicitud integral. Este informe describe el estado 026 y sustituye las reglas de cierre administrativo de tanda descritas en el informe 025.

## 1–3. Archivos y migración

Creado:

- `supabase/migrations/026_automatic_playoffs.sql`.
- `supabase/tests/026_automatic_playoffs.sql` y `026_legacy_fixture.sql`.
- `tests/penalties.test.ts`.
- `tests/browser/simultaneous-phases.spec.ts`.
- `tests/local-read-api.mjs`.
- Este informe.

Modificado en esta tarea:

- `src/PenaltyShootout.tsx`, `src/lib/penalties.ts`, `src/index.css`.
- `src/MatchControlPage.tsx`, `src/ControlHub.tsx`, `src/PlayoffsAdmin.tsx`, `src/PublicPages.tsx`, `src/ScheduleEditor.tsx`.
- `src/lib/tournament.ts`, `src/lib/useTournament.ts`.
- `package.json`, `playwright.isolated.config.ts`.
- `tests/run-sql.mjs`, `tests/playoffs-simulation.mjs`.
- `tests/browser/penalty-shootout.spec.ts`, `tests/browser/upcoming.spec.ts`.

Se conservaron las migraciones 001–025 y los cambios locales anteriores. No hubo deploy, migraciones remotas, modificaciones de credenciales, cambios en `.env.local` ni escrituras en producción.

## 4–7. Cierre regular sin Fecha 4

`close_regular(category_id)` ya no comprueba una jornada concreta ni una cantidad fija de encuentros. Bloquea la categoría solicitada y comprueba:

1. Ningún partido de esa categoría con `stage='REGULAR'` puede estar en estado distinto de FINALIZADO, incluidos programados, pausados y en curso.
2. Todos sus equipos activos deben tener exactamente el mismo PJ regular finalizado. Se cuenta directamente `matches`, uniendo cada equipo como local o visitante; la prueba es `min(PJ)=max(PJ)`.
3. Deben existir al menos cuatro equipos activos para congelar los cuatro clasificados.

Los partidos contra equipos posteriormente inactivos sí cuentan para el PJ del equipo activo. Los inactivos no entran en la comparación ni en el nuevo Top 4. El orden deportivo sigue siendo el de `get_standings`: puntos, DG, GF, GC, nombre e ID. Se guardan los cuatro IDs y `regular_closed_at` solamente en la categoría indicada. Repetir el cierre conserva lo ya congelado.

Un pendiente produce un mensaje explícito. Una desigualdad muestra el motivo y una línea por equipo con sus PJ, conservando saltos de línea en la interfaz. Pasaron las pruebas 2/2/2/2, 4/4/4/4 y 10/10/10/10 sin Fecha 4; se rechazaron 4/4/3/4 y 3/3/3/3 con un encuentro pendiente.

La regla solicitada no impone un mínimo absoluto de PJ: cuatro equipos activos con 0 PJ y ningún encuentro pendiente también cumplen la igualdad. Esto está documentado y probado, sin agregar una excepción no solicitada.

## 8–10. Fase propia del partido y empate

Las reglas utilizan el `stage` guardado en `matches`, también entrando directamente a `/admin/partidos/:id`. No se deducen de categoría, ruta, sexo o jornada.

- REGULAR: conserva su finalización empatada y un punto para cada equipo.
- SEMIFINAL, FINAL y THIRD_PLACE: un empate no puede finalizar sin desempate.

Cuando el segundo tiempo alcanza sus 900 segundos y la eliminatoria sigue empatada sin ganador, el control abre automáticamente la selección del primer equipo. No hay activación manual de «usar penales». Si se cancela el modal, queda «Elegir primer equipo» para retomarlo. Elegido el equipo, la RPC existente inicia la tanda y pausa el reloj. El control requiere estar abierto para presentar el modal; no se añadió un proceso servidor que elija equipos o actúe por el administrador.

## 11–15. Cinco tiros, fórmula y cierre automático

La 026 agrega `rule_set` a `penalty_shootouts`. Las tandas nuevas usan `FIVE_ALTERNATING`. Se reutilizan las tablas, UUID, revisión, turnos, auditoría y RPC de 025.

`penalty_decision(home,away,attempts)` evalúa la secuencia ordenada y devuelve el ganador y el primer tiro en el que quedó definido. Durante la serie inicial:

```text
restantes_A = 5 − ejecutados_A
restantes_B = 5 − ejecutados_B
A gana si convertidos_A > convertidos_B + restantes_B
B gana si convertidos_B > convertidos_A + restantes_A
```

Tras cinco tiros por equipo, solamente se decide cuando ambos han ejecutado la misma cantidad y sus goles difieren. El primer tiro de una ronda adicional nunca decide por sí solo. Si ambos convierten o ambos fallan, continúa.

Después de RECORD, CORRECT o VOID, `manage_penalty_shootout` recalcula esta decisión dentro de la misma transacción, con los bloqueos y control de revisión anteriores. Cuando queda definida, confirma la tanda, escribe `tiebreak_winner_team_id` y finaliza el partido. No aparece confirmación de ganador ni botón de finalización administrativa en la UI. El backend rechaza tiros posteriores. FINISH se conserva como operación compatible para reconciliación, pero ya no permite cerrar antes de la definición matemática.

La selección manual antigua `set_penalty_winner` deja de admitir ganadores nuevos. Solo devuelve el estado para reintentos idénticos de un ganador que ya estaba guardado. Sus funciones auxiliares anteriores no tienen permisos públicos de ejecución.

Cada equipo muestra cinco casillas iniciales. Desde la sexta, CSS usa una cuadrícula de exactamente cinco columnas: tiros 6–10 en segunda fila, 11–15 en tercera, etc. Ambos equipos exponen posiciones correspondientes; al empatar una ronda completa se muestra la siguiente pendiente. En el cierre anticipado se conservan los huecos iniciales sin ejecutar.

Durante la tanda solo se muestran casillas, nombres de equipos y, en administración, turno y acciones. El marcador numérico de penales aparece únicamente al finalizar, debajo de «EQUIPO GANA EN PENALES». Nunca se muestran jugadores ni el término técnico de las rondas adicionales. Símbolos ✓, ✕ y ○ y etiquetas accesibles complementan los colores.

## 16–20. Cruces, agenda, Inicio y Controlar

Controlar muestra por categoría la fase regular cerrada, los cuatro clasificados y CONFIGURAR SEMIFINALES. Se mantiene la selección manual de los dos participantes de la primera semifinal; los dos restantes forman la segunda. Confirmar llama a `create_semifinals` y crea ambos registros sin pasar por Crear partido. La actualización se comparte con el listado de Controlar, eliminando su segunda suscripción al torneo.

La 026 agrega un trigger AFTER sobre resultados de semifinales. Cuando ambas tienen resultado oficial, llama a `generate_day6` dentro de la transacción y crea:

- FINAL: ganador SF1 contra ganador SF2.
- THIRD_PLACE: perdedor SF1 contra perdedor SF2.

Se usa `match_outcome`, que reconoce goles reglamentarios, penales y W.O. Se ajustó su volatilidad y la de `get_tournament` para observar correctamente el resultado recién escrito dentro del trigger, sin reemplazar sus definiciones.

Los partidos generados aparecen en Controlar con fase y categoría, y PROGRAMAR abre el editor existente exclusivamente de fecha/hora. `reschedule_match` conserva equipos, stage, identidad y resultado. Inicio utiliza los mismos registros, muestra SEMIFINAL 1/2 por su orden canónico y la agenda o su estado pendiente. No repite las tarjetas pendientes en la sección de eliminatorias. Los calendarios mantienen el comportamiento previo de mostrar encuentros finalizados, con sus resultados y tanda.

No se añadieron formularios manuales de eliminatorias a Crear. Los finales ya no necesitan el botón «Generar partidos de jornada 6».

## 21–24. Independencia, duplicados, W.O. y penales

Los cierres, clasificados y cruces siguen asociados a `category_id`. El fixture de convivencia creó dos semifinales de MUJERES y cinco regulares pendientes de VARONES. Las siete tarjetas se mostraron correctamente y una actualización simulada de una semifinal no alteró los otros cinco partidos. VARONES pudo finalizar un 1–1 sin tanda y con un punto por equipo.

La generación conserva el bloqueo por categoría y la idempotencia de las RPC originales. Además, un índice único parcial limita a una FINAL y un THIRD_PLACE por categoría. Repetir creación de semifinales/generación de jornada final no duplicó encuentros.

W.O. permanece incompatible con tanda. Dos semifinales resueltas por W.O. generaron automáticamente los cruces correctos en una prueba SQL. El cierre por penales utiliza el campo compatible `tiebreak_winner_team_id`, por lo que `match_outcome`, cruces y podio reciben el ganador oficial.

Realtime sigue usando las tablas publicadas y el hook existentes de 025. No se agregaron canales; se eliminó uno redundante en Controlar. Las actualizaciones recargan el snapshot del torneo, manteniendo separados los partidos y sin tratar lanzamientos como GOAL.

## 25–30. Verificación y simulación

| Verificación | Resultado |
|---|---|
| `npm run build` | PASS; conserva aviso de bundle de aproximadamente 522 kB |
| `npm run lint` | PASS |
| Unitarias | 19/19 PASS |
| Suite SQL PGlite 001–026 | PASS; fixtures históricos en su versión y pruebas actuales 026 |
| Navegador aislado | 77 casos validados; se corrigió y repitió una expectativa antigua de etiquetas |
| Responsive | 320, 390, 768 y 1280 px; hasta tercera fila y nombres largos, sin desbordamiento |
| Simulación integral | PASS; 75 rechazos esperados de operaciones inválidas |

La suite completa de navegador se ejecutó sin omitir las pruebas que antes requerían lecturas del backend: `tests/local-read-api.mjs` carga los datos semilla en PGlite en memoria y expone únicamente lecturas en loopback. Sus escrituras HTTP se rechazan; las pruebas de mutación interceptan sus peticiones. Vite no carga `.env.local` y usa exclusivamente esa dirección local.

| Partido simulado | Reglamentario | Tanda | Ganador |
|---|---|---|---|
| Semifinal 1 | A 2–1 D | — | A |
| Semifinal 2 | B 1–1 C | 0–3, corte tras tres por equipo | C |
| Final | A 2–2 C | 7–6, después de cinco empatados y rondas adicionales | A |
| Tercer puesto | D 3–1 B | — | D |

Final A–C y tercer puesto D–B existían antes de cualquier llamada manual a `generate_day6`. Después solo se asignaron fecha/hora. Podio A, C, D, B. La clasificación regular se conservó y las goleadoras ficticias siguieron sumando exactamente los 23 goles reglamentarios: A=8, B=5, C=5, D=5. Los tiros de tanda no crearon eventos, GF, GC, DG ni puntos.

Evidencia: `test-results/playoffs-simulation.json`, regenerada por el ejecutor. Comandos:

```text
npm run build
npm run lint
npm test
node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js
node tests/playoffs-simulation.mjs
npx playwright test --config playwright.isolated.config.ts
```

## 31. Correcciones, migración y límites

Las correcciones siguen auditadas y solo se anula el último tiro vigente. Cada modificación recalcula también el primer punto de definición matemática. Se rechaza una corrección que deje tiros posteriores innecesarios, reabra una tanda finalizada o cambie al ganador confirmado. No se alteran silenciosamente los cruces posteriores. Una rectificación que cambie el ganador sigue necesitando un flujo administrativo específico, como en la protección de 025.

Las tandas ya terminadas con 025 se identifican como LEGACY_ADMIN y conservan sus resultados, tiros y reglas de corrección históricas. La migración no inventa tiros para convertirlas en series de cinco. Las tandas abiertas adoptan la nueva regla; si el último tiro ya es decisivo, se cierran mediante la RPC. Si un historial abierto contiene tiros posteriores al punto en que debería haber terminado, la migración se detiene para revisión en lugar de borrar datos.

La 026 también reconcilia semifinales previamente resueltas creando los cruces que faltaban. Por tanto, su futura aplicación puede crear partidos pendientes locales/remotos según el entorno donde se autorice; en esta tarea se ejecutó únicamente en bases efímeras. La prueba de preservación comprobó que no cambian las filas ni lanzamientos de resultados históricos.

La independencia de fases no elimina el límite existente de un solo partido activo a la vez. Se conservó el modelo de permisos anon del proyecto; no se añadió autenticación administrativa. Realtime se verificó mediante publicación SQL y notificaciones entregadas al hook real, no mediante un servidor WebSocket Supabase remoto. Ninguna de estas pruebas contactó producción.
