# Copa San Martín 2026

React + Vite + TypeScript, Tailwind CSS y React Router. Diseño para celular.
Proyecto Supabase autorizado: `kxoihaxxxddykziabmoq` (copa san martin 2026).

## Desarrollo

- `npm run dev`: servidor local.
- `npm run lint`: revisión del código.
- `npm run build`: TypeScript y compilación.
- `node --test tests/matchClock.test.ts tests/goalRequest.test.ts`: reloj e intenciones de gol.

La conexión existente usa `src/lib/supabase.ts` y `.env.local` ignorado por Git.
La variable `VITE_SUPABASE_ANON_KEY` contiene una clave pública; nunca service_role.

## Funcionalidades actuales

- `/admin/equipos`: crear, renombrar y retirar equipos con confirmación (baja lógica).
- `/admin/crear`: crear partidos regulares con jornada, fecha individual y hora de Tarija.
- `/admin/calendario`: calendario compartido con el público y edición de agenda.
- `/admin/controlar`: encuentro activo y flujo de playoffs, sin listado redundante.
- `/admin/partidos/:id`: fases, pausas, goles, marcador derivado y anulación.
- `/`: partido activo con reloj persistente, siguiente programado, celebración de gol y eliminatorias.
- `/calendario`: seis jornadas, categorías, resultados y estadísticas de goles válidos.
- `/partidos` y `/admin/fechas` redirigen a Calendario y Crear, respectivamente.
- `/tablas`: clasificación regular en vivo y podio separado por categoría.
- `/admin`: cierre regular, cruces manuales de semifinales y generación de jornada 6.

## Control del partido

`get_match_control` lee el partido y la hora del servidor.
`control_match` valida la versión `updated_at`, bloquea la fila y aplica únicamente
acciones permitidas. No se concede UPDATE directo al navegador.
El índice existente `matches_one_active` impide dos partidos activos.

El reloj suma segundos persistidos y segundos completos desde `phase_started_at`.
Se limita a 900 / 300 / 900. Al pausar se guarda el acumulado entero y se elimina
el instante de arranque; al reanudar se conserva el acumulado con un nuevo arranque.
La precisión persistida es de un segundo, según la columna integer existente.

Todas las transiciones de fase son MANUALES al cumplir el límite: primer tiempo
→ descanso → segundo tiempo → finalizado. Ningún temporizador escribe cada segundo.
La pantalla actualiza visualmente cada segundo. Realtime dispara lecturas al cambiar
los datos; también se recuperan al volver a la pestaña o reconectar. El respaldo
consulta cada 60 segundos con Realtime conectado y cada 30 si se desconecta.
Tras un error de escritura se exige refrescar antes de volver a actuar.

## Base y pruebas

El esquema inicial y migraciones 001–010 ya se aplicaron al proyecto autorizado.
No volver a ejecutarlos. No usar `db push` sin reconciliar primero el historial
con las aplicaciones SQL directas realizadas en estas fases.

`supabase/tests/005_match_control.sql` prueba RPC con rol anon dentro de una
transacción con ROLLBACK. Crea solo datos temporales transaccionales, no borra
filas existentes y se cancela si hay un partido activo real. No es una migración.

RLS permanece activo. Las políticas de equipos, fechas y creación de partidos
siguen vigentes. El control agrega solo EXECUTE sobre las RPC para anon; no login.
Por decisión del proyecto, cualquiera con la clave pública puede usar esas acciones.

## Goles y marcador

`record_goal` y `void_goal` bloquean la misma fila de partido que `control_match`.
Solo record_goal puede crear goles desde el frontend y solo durante los tiempos.
Su reloj usa hora del servidor y el acumulado persistido, limitado a 0–900 segundos.
Se conservó el CHECK original de `period`: PRIMER_TIEMPO / SEGUNDO_TIEMPO.
La lectura expone además `period_number` 1 / 2 para mostrar 1T / 2T.

Cada intención lleva un UUID `request_id` único. Un reintento devuelve el evento
original, incluso si fue anulado, sin volver a crearlo. La pantalla conserva la
intención pendiente en sessionStorage antes de enviarla y la reutiliza tras fallos
de red o recarga en la misma pestaña. No contiene credenciales. Hasta confirmar esa
intención se bloquean nuevos goles y cambios de fase en ese control.

El marcador y la lista se calculan en get_match_control desde GOAL con voided_at
NULL. No hay columnas de marcador en matches. Anular solo establece voided_at;
las filas se conservan y desaparecen de la lista de goles válidos. Repetir una
anulación no vuelve a modificar la fila. No se anulan goles nuevos tras finalizar.

`supabase/tests/006_match_goals.sql` verifica goles, anulación y control mediante
fixtures en una transacción revertida. No es una migración. Las RPC no conceden
INSERT/UPDATE/DELETE directos en match_events y mantienen RLS activo.

## Clasificación regular

`get_standings(p_category_id, p_include_live = true)` centraliza el cálculo y solo
lee datos bajo RLS. Cuenta GOAL sin voided_at de partidos REGULAR finalizados y,
en modo provisional, activos. PROGRAMADO y todas las eliminatorias se excluyen.
Con `p_include_live = false` devuelve únicamente la definitiva.
Los equipos activos sin partidos aparecen en cero; los inactivos conservan las
estadísticas de partidos incluidos. Orden oficial: PTS, DG, GF descendentes y GC
ascendente. Solo para estabilidad técnica se usan después nombre e ID
ascendentes. El ID solo estabiliza un eventual empate completo de nombre.

`supabase/tests/007_standings.sql` verifica ambas categorías y la clasificación
con fixtures revertidos. No es una migración y no deja datos de prueba.

## Realtime y eliminatorias

La migración `008_tournament_final.sql` publica matches, match_events, categories,
teams y matchdays. Conserva RLS y no concede escrituras generales nuevas.
Los clientes vuelven a leer snapshots; los eventos no se usan como marcador acumulado.

`close_regular` exige que no queden regulares pendientes, que exista un partido
finalizado de Fecha 4 y que haya cuatro clasificados. El administrador debe comprobar
que ya cargó el calendario completo antes de cerrar: la base no puede detectar
partidos que nunca se programaron. Guarda el Top 4 definitivo en categories y bloquea
los cambios de resultados regulares. El orden es el mismo de get_standings(false).

`create_semifinals` acepta los cuatro clasificados exactamente una vez. El administrador
elige el primer cruce; los otros dos forman el segundo. No impone 1–4 / 2–3.
`set_penalty_winner` exige empate y segundo tiempo completado de una eliminatoria.
No agrega goles. Cualquier cambio del marcador limpia la selección. Una eliminatoria
empatada no puede finalizar sin ganador por penales.

`generate_day6` deriva FINAL y THIRD_PLACE de las dos semifinales finalizadas y resueltas.
Los reintentos no duplican cruces. `match_outcome` centraliza ganador/perdedor.
El podio público muestra los cuatro puestos cuando ambos encuentros están resueltos.

## Verificación del bloque final

- `npm test`: ocho pruebas de reloj e idempotencia de intenciones de gol.
- `npm run test:browser`: Edge local, viewport móvil, servidor en 127.0.0.1:5174.
  Comprueba rutas con lecturas reales y escenarios simulados sin escrituras.
- `supabase/tests/008_tournament_final.sql`: flujo completo y rechazos con ROLLBACK.
- Las regresiones SQL 005 y 006 también pasan con las nuevas protecciones.
- El fixture histórico 007 precede al bloqueo de eventos finalizados; la prueba 008
  verifica ahora la clasificación definitiva y su conservación al completar playoffs.

Las suscripciones reales a matches y match_events se verificaron con clave pública.
Las notificaciones de gol/anulación del navegador se simulan: transacciones revertidas
no producen eventos Realtime confirmados. No se dejaron equipos, partidos ni goles
de prueba. No hay autenticación por decisión del proyecto: las RPC administrativas
están disponibles para anon y ocultar /admin no restringe su acceso.

## Rediseño y conservación de datos

Los PNG originales de referencias se copian sin modificación a public/brand.
La interfaz utiliza bordó institucional, naranja cálido y superficies oscuras.
La navegación pública y administrativa es exclusivamente inferior.

010_schedule_and_team_archive agrega scheduled_date y scheduled_time a matches:
son agenda individual en hora local de Tarija, independientes de matchdays.number.
No se rellenan fechas antiguas por suposición. La fecha de jornada existente se
muestra como referencia. reschedule_match cambia exclusivamente la agenda y exige
updated_at vigente; conserva resultados, eventos, estado, jornada y rivales.

Eliminar equipo invoca archive_team después de confirmación. Marca deleted_at y
active=false; no elimina filas ni relaciones. Se oculta en la gestión de equipos
y en nuevas programaciones. Los partidos y clasificaciones históricas lo conservan.
El nombre permanece reservado por la restricción de unicidad existente.

MatchDetails es común a Inicio y Calendario. Recibe los mismos goles válidos del
snapshot get_tournament/get_match_control y no muestra anulados. Realtime sigue
actualizando estas lecturas, el control y standings sin una segunda fuente de datos.

Las pruebas 010_schedule_and_team_archive y 010_playoffs_regression se revierten.
Las pruebas de navegador del rediseño simulan escrituras; las lecturas son reales.
Los fixtures históricos 009 que exigen cero partidos no deben ejecutarse sobre
un campeonato ya iniciado. Al verificar este rediseño se conservaron íntegros los
17 equipos, 1 partido y 6 eventos reales (huellas antes/después coincidentes).

## Eliminar un partido

011_delete_match habilita delete_match(id, updated_at), sin borrar datos al aplicar
la migración. El calendario administrativo solicita confirmación con Cancelar/Eliminar.
La RPC bloquea el partido, comprueba su versión y elimina únicamente sus eventos
(válidos y anulados) y después el partido, dentro de la misma transacción.
No concede DELETE directo a anon. La protección contra borrado individual de goles
permanece activa fuera del contexto restringido de la RPC.
Standings y vistas públicas se vuelven a leer mediante Realtime y el respaldo existente.
No modifica equipos, jornadas, clasificados fijados ni otros cruces ya generados.
Las pruebas SQL 011 se ejecutan con rollback; la prueba de navegador simula la RPC.
