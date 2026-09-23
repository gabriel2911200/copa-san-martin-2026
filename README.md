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

Con la migración 012, todas las transiciones de fase son MANUALES, incluso antes del límite: primer tiempo
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
`set_penalty_winner` exige empate y segundo tiempo en curso de una eliminatoria (012 permite el corte anticipado).
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

## Corte anticipado y aviso del reloj

`012_early_phase_finish.sql` permite terminar el primer tiempo, finalizar el descanso
e iniciar el segundo, y finalizar el partido antes del máximo. Conserva los eventos,
el marcador derivado, los bloqueos de fila, la comprobación de versión y los permisos.
Al cambiar de fase el reloj empieza en cero; al finalizar conserva el tiempo real.
Si está pausado, se debe reanudar antes de terminar la fase. Los empates de eliminatorias
siguen requiriendo un ganador por penales, también para finalizar anticipadamente.

Solo el control administrativo muestra el aviso desde 14:30 / 04:30 / 14:30 hasta
el límite. Intenta vibrar una vez por fase mientras el control permanece montado,
sin repetir al pausar/reanudar o refrescar datos. La vibración depende del navegador;
el aviso visual funciona sin ella. No hay avance automático ni cambios en la vista pública.

La migración 012 ya está aplicada en el proyecto Supabase autorizado.
Pruebas: `tests/browser/match-clock.spec.ts`, `tests/matchClock.test.ts` y
`supabase/tests/012_early_phase_finish.sql` (transaccional con rollback).

## Plantillas, eventos y goleadores

La migración `013_players_and_match_events.sql` se aplica después de `012`.
Agrega `players` y amplía `match_events` sin borrar ni reescribir partidos o goles.
`014_match_lineups.sql` corrige el dorsal global: crea `match_players` y elimina
únicamente `players.shirt_number`, conservando jugadores y snapshots históricos.
Las migraciones 012–014 ya se aplicaron al proyecto autorizado en ese orden, dentro de
una transacción con comprobación de huellas de los datos existentes, y se registraron
como aplicadas en el historial del CLI. Se conservaron 17 equipos, 10 partidos y 72 eventos.
Se verificaron `players` y `match_players`, sin filas, con RLS y publicación Realtime;
`players` no contiene dorsal global. No volver a ejecutar estas migraciones.
El historial anterior 001–011 sigue sin reconciliar con sus aplicaciones SQL directas:
no ejecutar un `db push` general hasta revisar ese historial.

- Administración → Equipos → Jugadores: alta, edición y activación/desactivación.
  Nombre completo, equipo fijo y estado activo, sin número de camiseta.
  Desactivar conserva su historial.
- Control → Convocatoria del partido: asigna jugadores y dorsales de 0 a 99 por encuentro.
  Se requiere al menos un convocado activo por equipo antes de registrar cualquier evento.
  `set_match_player` comprueba pertenencia, dorsal único por equipo/partido y versión vigente.
  Permite editar o retirar convocados sin eventos; una vez que tienen eventos, incluso
  anulados, bloquea cambios de dorsal o retiro. Las convocatorias finalizadas no se editan.
  El mismo jugador puede usar otro dorsal en el siguiente partido. No se inventan
  convocatorias a partir del antiguo número global: los encuentros en curso deben completar
  su convocatoria antes de nuevos eventos. Los goles y tarjetas anteriores se conservan.
- Goles y amarillas: selección obligatoria de jugador activo convocado para el partido.
  El evento conserva ID, nombre y dorsal de esa convocatoria al momento del registro,
  equipo, periodo y segundos del servidor. Se muestra el minuto de juego dentro del periodo.
- Faltas: evento de equipo, independiente de las amarillas. Los contadores se derivan
  de eventos válidos por equipo y periodo; 5 se muestran en amarillo y 6 o más en rojo.
- Tiempos muertos: un evento válido por equipo y periodo, protegido también en SQL.
  Con la migración 015, la solicitud pausa automáticamente el reloj durante un minuto.
  El administrador puede terminarla antes con «Finalizar tiempo muerto».
  El segundo tiempo tiene sus propios contadores y disponibilidad sin borrar el primero.
- `record_match_event` serializa escrituras con el control del reloj y usa un UUID por
  intención. La intención completa se conserva en sessionStorage para reintentar tras
  fallos o recargas sin duplicar eventos ni cambiar el jugador. `void_match_event` anula
  sin borrar. Los partidos finalizados mantienen bloqueados sus eventos.
- `record_goal` y `void_goal` conservan sus firmas para clientes/intenciones antiguas.
  La primera permite recuperar reintentos ya registrados; nuevos goles sin jugador
  convocado se rechazan. Los nuevos registros usan `record_match_event`.
  Los goles anteriores sin jugador siguen formando parte del marcador y la clasificación.
- Inicio, Calendario y sus detalles usan el mismo snapshot, ampliado con eventos.
  Realtime incluye jugadores y convocatorias y vuelve a consultar los datos, sin acumular estadísticas
  en el navegador. Faltas, tarjetas y tiempos muertos no modifican el marcador ni penales.
- `/goleadores` permite filtrar por categoría y cuenta goles válidos de todas las etapas,
  incluidos encuentros en vivo. No atribuye los goles antiguos sin jugador, ni cuenta
  anulados o penales. Agrupa por ID de jugador independientemente del dorsal usado.
  No existe una tabla de estadísticas editable.

Validación local: `npm run lint`, `npm run build`, `npm test` y `npm run test:browser`.
Las pruebas de navegador simulan todas las escrituras; algunas regresiones existentes
leen el proyecto autorizado. `tests/browser/players-events.spec.ts` cubre plantillas,
selección por equipo, fallos de red, periodos y estadísticas públicas.

Para probar SQL sin conectar con Supabase ni depender de Docker:

```powershell
npm.cmd install --prefix .tmp-sql-check --no-save --package-lock=false @electric-sql/pglite
node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js
```

El ejecutor crea PostgreSQL efímero en memoria y aplica esquema y migraciones.
Comprueba la conservación exacta de equipos, categorías, jornadas, partidos activos y
finalizados, goles válidos y anulados antes/después de 013, y jugadores y eventos completos
antes/después de 014, aunque el número global haya cambiado tras un gol.
Ejecuta quince suites SQL en su versión correspondiente: las anteriores a 014 prueban
el flujo histórico que admitía goles sin convocatoria; 014 verifica el nuevo requisito,
dos dorsales distintos del mismo jugador en dos encuentros, goleadores acumulados,
restricciones, reintentos y conservación del marcador. Esto verifica
SQL y configuración de publicación, pero no sustituye una prueba de entrega Realtime
de los nuevos eventos en Supabase una vez aplicadas las migraciones.

## Tiempo muerto con pausa real

La nueva migración `015_live_timeouts.sql` debe aplicarse después de 014; está pendiente
de aplicar en Supabase. Agrega `timeout_started_at`, `timeout_team_id` y el estado
`TIEMPO_MUERTO`, sin reescribir registros existentes. Los eventos históricos de tiempo
muerto se conservan y no activan pausas retroactivamente.

La solicitud guarda los segundos del partido y el periodo anterior, registra el evento
y detiene el reloj en una misma transacción. Los reintentos no duplican la solicitud ni
reinician el minuto. Durante la pausa, administración e Inicio muestran el equipo
solicitante, el reloj de juego detenido y un contador independiente de hasta 01:00.

La reanudación automática se calcula desde la fecha guardada más 60 segundos, incluso
si se cierra la pestaña. Las consultas y el reloj público muestran el estado efectivo
desde ese instante, sin escribir desde la página pública. Administración sincroniza
el estado persistido mediante `finish_match_timeout`; la siguiente operación de control
o evento también lo sincroniza si no había administrador conectado. No requiere cron:
la fila puede conservar temporalmente `TIEMPO_MUERTO`, pero el snapshot y el reloj ya
reflejan la continuación desde el vencimiento. La finalización manual reanuda desde el
instante de la petición. Ambas conservan los segundos guardados y son idempotentes.

`tests/browser/timeouts.spec.ts` prueba ambos periodos, finalización manual y automática,
y vista pública sin escrituras. `supabase/tests/015_live_timeouts.sql` comprueba reloj,
concurrencia, reintentos, disponibilidad por periodo y conservación de goles, tarjetas
y faltas. El ejecutor SQL verifica también la conservación de partidos, jugadores,
convocatorias y eventos al aplicar 015, incluido un tiempo muerto histórico.

## Acciones y estadísticas por equipo

El control muestra local, marcador y visitante en una misma fila. Cada equipo tiene
botones GOL, FALTA, AMARILLA y ROJA; los goles y tarjetas usan el mismo selector de
jugadores convocados y conservan el dorsal de ese encuentro. El botón compacto
JUGADORES abre la convocatoria. El reloj y los tiempos muertos mantienen la lógica de 015.

La migración nueva `016_red_cards.sql` requiere 015 y está pendiente de aplicar en
Supabase. Amplía los tipos permitidos y la validación de jugador en la función y el
trigger existentes; no actualiza filas, no crea tablas duplicadas ni cambia Realtime.
Las rojas guardan jugador, equipo, dorsal, periodo y segundos, igual que las amarillas.
No se introducen reglas nuevas de suspensión o expulsión automática por acumulación.

Inicio y Calendario comparten estadísticas en dos columnas, local a la izquierda:
goles, amarillas, rojas y solicitudes históricas de tiempo muerto. Los goles antiguos
sin jugador permanecen visibles y siguen contando en el marcador y la clasificación.
Las faltas por periodo aparecen compactas en las tarjetas públicas de partidos activos;
no hay bloque de faltas en Control ni indicadores de disponibilidad de tiempo muerto.

Goleadores y plantillas cargan automáticamente y conservan sus suscripciones Realtime
y recuperación periódica. Goleadores utiliza el recuadro y colores de Tabla de posiciones,
destacando únicamente la primera fila. «Eliminar jugador» utiliza la baja lógica
`active=false`: conserva convocatorias y eventos históricos y permite restaurarlo.
No existe dorsal fijo en la plantilla.

`supabase/tests/016_red_cards.sql` verifica convocatoria, equipo, snapshot, reintentos,
anulación y conservación del marcador y goleadores. El ejecutor comprueba que 016
mantiene intactas todas las filas existentes. Las pruebas de navegador cubren el
formato por equipos, tarjetas rojas, baja lógica y posición del marcador en móvil y escritorio.

## Control previo, cobros, minuto y disciplina (017)

`017_prechecks_fouls_discipline.sql` se aplica después de 016. Está pendiente de aplicar
en Supabase; no se ejecutaron cambios remotos durante esta implementación. Crea
`match_prechecks` y `match_foul_counters` con RLS y Realtime, y adapta las funciones
existentes. No reescribe partidos ni eventos anteriores.

- Antes de iniciar, administración debe responder SI/NO sobre balón y cintillo de
  ambos equipos. Se guardan las cuatro respuestas por partido, con validación de
  versión y bloqueo del inicio en SQL. No se inventan respuestas para encuentros
  que ya estaban en curso: estos pueden continuar normalmente.
- Al llegar a descanso o final, una ventana modal muestra los equipos sin balón o
  cintillo y las amarillas válidas del primer o segundo periodo, respectivamente.
  Los recordatorios se derivan del control guardado y las tarjetas; cerrar con
  «Entendido» no registra un pago. Solo se muestran en administración.
- El texto visible es MINUTO. El contador independiente baja desde 01:00 hasta
  finalizar y reanudar el reloj principal. FINALIZAR MINUTO permite anticiparlo.
  Las claves internas `TIMEOUT`/`TIEMPO_MUERTO`, límites por equipo/periodo y
  recuperación automática de 015 se conservan para mantener compatibilidad.
- Las faltas nuevas incrementan un contador por partido, equipo y periodo;
  no insertan filas en `match_events`. Las claves UUID de solicitudes se guardan
  en el contador para evitar duplicados tras fallos o recargas. La RPC existente
  admite reintentos de faltas históricas sin incrementar de nuevo. El snapshot
  suma las faltas históricas válidas y los contadores nuevos, sin reescribir el
  historial. El segundo periodo utiliza su propio contador desde cero.
- Las faltas solo se presentan compactas en partidos públicos activos: amarillo
  desde 5 y rojo con «Tiro libre acumulativo» desde 6. No aparecen en estadísticas
  ni en el control administrador.
- La roja directa conserva el reloj en marcha y no lleva la leyenda «Expulsado».
  La segunda amarilla válida representa «Expulsado por doble amarilla», incluso
  cuando la primera fue en otro periodo. Se conserva jugador, equipo, dorsal y
  periodo en las tarjetas originales; la expulsión se deriva sin duplicar eventos.
  La UI y SQL impiden nuevas acciones de ese jugador en ese partido tras roja
  directa o doble amarilla. No se modifica su plantilla ni otros encuentros.
  Anular una tarjeta recalcula la restricción a partir de los eventos válidos.
- Las estadísticas comparten una sola cabecera local/visitante y muestran goles,
  tarjetas y minutos debajo, conservando los minutos de juego como detalle.

Pruebas: `supabase/tests/017_prechecks_fouls_discipline.sql`,
`tests/browser/match-management.spec.ts`, `tests/browser/timeouts.spec.ts` y
`tests/matchEvents.test.ts`. El ejecutor SQL verifica además un partido iniciado
antes de 017, la suma de su falta histórica y una nueva, y el reintento histórico.

## Controlar, cronología y reversión (018)

`018_event_reversal.sql` debe aplicarse después de 017. Está pendiente de aplicar
en Supabase. Solo reemplaza funciones y no modifica filas existentes al ejecutarse.

- Administrador → Controlar lista todos los partidos programados y activos, con
  agenda y acceso directo al control. Las opciones de agenda y eliminación existentes
  se conservan en «Opciones del partido». Calendario muestra únicamente finalizados.
- El control mantiene marcador, reloj, acciones, convocatoria y avisos de cobro,
  junto a una cronología compacta en «ESTADÍSTICAS EN VIVO». Cada evento dispone
  de un menú discreto ⋮ para revertirlo.
- Calendario → Estadísticas muestra una cronología única, con la hora exacta de
  cada evento y columnas local/visitante bajo una sola cabecera. Se excluyen faltas
  normales y eventos revertidos. Los goles históricos sin jugador siguen visibles.
- En Calendario administrativo cada evento tiene un menú ⋮ → Revertir evento.
  La vista pública no muestra controles de escritura. La reversión conserva la fila
  con `voided_at` y recalcula marcador, goleadores y disponibilidad del jugador.
  No elimina jugadores ni cambia su plantilla o dorsal histórico.
- Revertir el MINUTO activo termina únicamente esa pausa y reanuda desde los segundos
  guardados; también devuelve la disponibilidad de esa solicitud. Revertir un minuto
  anterior no termina otro que esté activo. Los reintentos son idempotentes.
- Las tarjetas pueden revertirse también después del final. Los goles de partidos
  finalizados admiten corrección mientras no alteren una clasificación regular cerrada,
  generen una resolución pendiente por penales o contradigan cruces dependientes.
  Esas operaciones se rechazan con un mensaje específico; no se reabre el reloj ni se
  cambian automáticamente los participantes de otros encuentros.
- La roja directa no pausa el reloj. Tras roja o doble amarilla el jugador deja de
  mostrarse como disponible en la convocatoria y el selector del partido; al revertir
  la tarjeta recupera su disponibilidad si no tiene otra sanción válida. Un rechazo
  confirmado de registro muestra el error sin bloquear los controles del reloj.
- Goleadores utiliza botones TODOS / MUJERES / VARONES con el estilo de Calendario y
  conserva actualización automática, columnas y resaltado exclusivo de la primera fila.

Pruebas nuevas: `supabase/tests/018_event_reversal.sql` y
`tests/browser/reversal-timeline.spec.ts`. Se verifican reversiones de roja, doble
amarilla, minuto y gol finalizado, conservación de filas, recuperación de jugadores,
menús móviles, cronología y separación de partidos entre Controlar y Calendario.

### Corrección: estadísticas compactas en el control

El control conserva una única sección visible «ESTADÍSTICAS EN VIVO», con goles,
amarillas y rojas en orden cronológico. Los minutos se registran internamente y se excluyen de las estadísticas. Comparte el componente de cronología
con Calendario y se actualiza desde el snapshot y la suscripción Realtime existentes.
Cada evento tiene su menú secundario ⋮ para revertirlo; sustituye el menú del último
evento y no añade listas duplicadas ni botones grandes. No requiere migración nueva.

Inicio también muestra «ESTADÍSTICAS DEL PARTIDO» bajo el partido en vivo, usando
la misma cronología y actualización Realtime. Es de solo lectura, sin menús de
reversión. Las faltas quedan como contador sobre el marcador, fuera de la cronología.
Calendario conserva las estadísticas de los partidos finalizados.


### Ajustes de estadísticas y control previo (9 de septiembre)

- Inicio, Calendario y Controlar comparten una cronología de goles, amarillas y rojas; excluye MINUTO y faltas. Las faltas se muestran como contador, también en administrador. El minuto conserva su contador independiente, reanudación automática y límite por equipo y periodo.
- Control previo confirma «Control previo guardado correctamente». Ante un rechazo o respuesta perdida, consulta la versión actual y reintenta una vez con las mismas respuestas y los mismos equipos. Conserva el control de concurrencia SQL y no exige actualización manual. Si cambiaron los equipos, restablece las preguntas para evitar asignar respuestas al equipo incorrecto.
- Cobros pendientes se muestra solo con respuestas NO; las amarillas permanecen en la cronología y no provocan por sí solas el aviso.
- Equipos permite TODOS / MUJERES / VARONES; editar desde TODOS conserva la categoría del equipo. Para agregar se selecciona la categoría. Goleadores destaca únicamente la primera fila en dorado.

No se añade migración: se requieren las existentes, en orden, hasta `018_event_reversal.sql`. En una base que esté en 014 faltan `015_live_timeouts.sql`, `016_red_cards.sql`, `017_prechecks_fouls_discipline.sql` y `018_event_reversal.sql`. La 016 admite RED_CARD en la restricción y RPC; la 017 añade control previo y contadores; la 018 completa reversión. Aplicar solo las pendientes. No se aplicaron migraciones al proyecto remoto durante estos ajustes.

Validación SQL con PostgreSQL efímero: `node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js`. Los fixtures verifican preservación de datos, roja sin pausa, doble amarilla y reversiones. Las pruebas de navegador usan respuestas simuladas y no escriben datos reales.

Archivos ajustados en esta revisión: `src/EquiposPage.tsx`, `src/GoleadoresPage.tsx`, `src/MatchChecks.tsx`, `src/MatchControlPage.tsx`, `src/lib/matchEvents.ts`, `src/index.css`; pruebas en `tests/matchEvents.test.ts`, `tests/browser/match-management.spec.ts`, `tests/browser/players-events.spec.ts`, `tests/browser/reversal-timeline.spec.ts`; y este README. Se conservaron los demás cambios locales previos.

Validación: lint y TypeScript correctos; build correcto con aviso de paquete JS superior a 500 kB; 17 pruebas unitarias y regresiones SQL correctas. Suite de navegador: 35 casos existentes más 3 nuevos, comprobados entre ejecución completa y repeticiones de los casos ajustados. Sin commit, push, deploy ni escrituras en Supabase remoto.

### Ajustes de cronología, minuto y arbitraje (solicitud posterior)

- Las estadísticas públicas y administrativas no repiten equipos: cada hora queda encima de su acción y en su mismo lado. Local a la izquierda y visitante a la derecha, también en móvil.
- La cronología pública muestra goles y tarjetas. La administrativa incluye además MINUTO con menú ⋮ para revertirlo. Ambas excluyen faltas; el marcador en curso conserva el contador por periodo y muestra «TIRO LIBRE SIN BARRERA» desde la sexta.
- MINUTO público aparece debajo del marcador, centrado, sin borde, con icono de pausa y contador de mayor tamaño. Se conserva el reloj independiente, fin anticipado y reanudación automática.
- Control previo mantiene respuestas ante errores y permite volver a guardar sin pedir actualización ni mostrar instrucciones de migración. Se conserva la RPC, la protección de concurrencia y la comprobación de equipos antes del reintento.
- ARBITRAJE durante el descanso incluye tarjetas válidas del primer tiempo y faltas de balón/cintillo. AVISO PENDIENTE al finalizar solo incluye tarjetas válidas del segundo tiempo. Los datos del primero y el equipamiento no se repiten al final; sin pendientes no hay ventana.
- Los selectores de Tabla, Calendario, Goleadores y Equipos comparten las mismas reglas CSS. Goleadores conserva la primera fila dorada y los demás estilos de tabla. Controlar mantiene visibilidad inmediata de partidos programados y activos.

No se modificaron migraciones ni se realizaron escrituras en Supabase en esta revisión. Las migraciones 015–017 fueron aplicadas en la tarea anterior; la 018 sigue siendo necesaria para la reversión completa, especialmente de partidos finalizados, y no se aplica como parte de estos cambios locales.

Validación de esta revisión: lint, TypeScript/build, 17 pruebas unitarias y regresiones SQL aprobadas. Navegador: 39 de 40 casos aprobaron en la ejecución completa; el caso restante se actualizó al ancho compartido de selectores y aprobó al repetirlo (40 casos verificados). Build conserva el aviso de paquete JS superior a 500 kB. Sin commit, push ni deploy.

### TOP 5, gestión de jugadores y carga inicial — 10 de septiembre

Goleadores muestra como máximo cinco jugadores por filtro, con el título TOP 5 GOLEADORES y el primer renglón dorado. El orden estable y los empates siguen siendo calculados por la RPC existente; el límite visual no modifica estadísticas almacenadas.

La plantilla ofrece Editar, Activar/Desactivar y Eliminar jugador. Eliminar pide confirmación y realiza una baja lógica (`active=false`); no hace DELETE. Activar recupera disponibilidad para convocatorias. Ninguna acción modifica el equipo ni asigna dorsal. El minuto administrativo también queda sin borde interior, conservando ambos relojes.

Se preparó `019_initial_players_and_scorers.sql`: tabla de saldos iniciales, lectura pública con RLS, carga administrativa no expuesta al navegador y suma de saldos más goles válidos para Goleadores. La carga normaliza espacios/mayúsculas para reutilizar jugadores del mismo equipo, exige ID ante homónimos y rechaza saldos contradictorios. Es atómica e idempotente; no modifica partidos, eventos ni jugadores existentes. La suscripción de saldos usa un canal separado para conservar compatibilidad con bases anteriores a 019.

Formato y procedimiento: [supabase/imports/README.md](supabase/imports/README.md). No se recibieron nombres ni cifras para cargar, por lo que no se inventaron datos. Los saldos deben excluir goles ya representados en match_events para no contarlos dos veces. No se necesitan tiempos ficticios de gol.

Migraciones pendientes según la última verificación remota: 018 para reversión completa y 019 para carga inicial. Esta tarea no aplica migraciones ni escribe en Supabase. Conserva los ajustes existentes de estadísticas públicas, alineación, faltas por periodo, control previo, arbitraje y acceso directo a partidos programados desde Controlar.

Archivos de esta revisión: `src/GoleadoresPage.tsx`, `src/TeamPlayers.tsx`, `src/MatchControlPage.tsx`, `supabase/migrations/019_initial_players_and_scorers.sql`, `supabase/imports/README.md`, `supabase/tests/019_initial_players_and_scorers.sql`, `tests/run-sql.mjs`, `tests/browser/players-events.spec.ts`, `tests/browser/reversal-timeline.spec.ts` y este README.

Validación: lint y TypeScript/build finales aprobados; 17 pruebas unitarias y toda la suite SQL (incluida 019 y conservación de datos) aprobadas; 40 pruebas de navegador aprobadas. Se añadió después una comprobación específica del evento Realtime de saldos iniciales, pero su ejecución adicional fue rechazada por el usuario; ese nuevo caso queda sin ejecutar. Build mantiene el aviso de paquete JS mayor a 500 kB. No hubo cambios en datos remotos, commit, push ni deploy.

Verificación adicional completada: el usuario volvió a autorizar la prueba pendiente del TOP 5 y Realtime. Se ejecutó `playwright test tests/browser/reversal-timeline.spec.ts --grep "goleadores filtra"`: 1 prueba aprobada. Confirma filtros, límite de cinco filas, resaltado del primer puesto y actualización ante un evento simulado de `player_initial_goals`. No se modificaron datos en Supabase.

### Carga real: San Martin 4–1 San Judas — 6 de septiembre, jornada 1, Varones

Se asociaron únicamente los cinco eventos de gol existentes del partido `bd6cf1c6-ba27-4590-89fb-24f4e9a9b757`: Leyson Nain Camacho (2), Juan José Colque Moncada (1), Dylan Mamani (1) y Angelo David Martínez (1). Se crearon sus cuatro fichas en sus equipos sin dorsal. Se conservaron IDs, periodos, tiempos originales, request_id, marcador y todas las filas de partidos; ningún otro evento fue modificado.

Aplicada la migración 020 para permitir un GOAL atribuido sin dorsal conocido. Es compatible desde 014 y se aplicó sin aplicar las pendientes 018/019. No se cargaron saldos iniciales: Goleadores calcula estos cinco goles directamente desde match_events. No volver a sumarlos con la carga de saldos de 019.

Carga exacta y verificaciones transaccionales: `supabase/imports/san-martin-san-judas-2026-09-06.sql`. Requiere privilegios de propietario y 020; conserva las protecciones de eventos después de la transacción. Prueba local: `node tests/historical-attribution.mjs` (usa PGlite en .tmp-sql-check). Verifica marcador 4–1, idempotencia, cuatro jugadores sin dorsal y restauración del trigger. Verificación posterior en Supabase y navegador contra datos reales: las estadísticas muestran los cinco goleadores y Goleadores muestra acumulados 2/1/1/1. Sin crear partidos o goles nuevos, sin cargar otros encuentros, sin commit, push ni deploy.


## Modales, autogol, W.O. y correcciones históricas — implementación local 024

El control selecciona jugadores en un diálogo con lista desplazable, error interno,
cancelación y devolución del foco. Calendario administrativo reutiliza ese selector
para corregir el jugador de un gol, amarilla o roja finalizados. La corrección conserva
ID, equipo, tipo, periodo y tiempo; solo cambia jugador y snapshot de nombre/dorsal.
En partidos finalizados admite jugadores actualmente inactivos que conservan su
convocatoria. Se mantienen restricciones de equipo y disciplina. Autogoles y minutos
se anulan con confirmación; no tienen autor editable. El público sigue sin controles.

AUTOGOL pregunta qué equipo lo cometió y confirma el gol para su rival. Conserva
record_own_goal, sin jugador, y el UUID persistido para reintentos.

Walkover (W.O.) pregunta qué equipo pierde y confirma 0–3 / 3–0. La migración
supabase/migrations/024_walkover_and_event_corrections.sql agrega a matches:
walkover_loser_team_id, walkover_request_id y walkover_recorded_at. La RPC record_walkover
valida versión, bloquea el partido, guarda resultado final y detiene el reloj. Reintentar
el mismo UUID/equipo devuelve el resultado existente. No crea GOAL ni jugadores.
get_match_control y get_standings calculan el resultado administrativo; match_outcome y
get_tournament lo reciben mediante el snapshot. get_top_scorers no cambia: W.O. no aporta
goles individuales y no altera los goles de otros partidos.

Protecciones conservadas:

- W.O. rechaza cualquier evento válido o contador de faltas. Los eventos pueden anularse
  por el mecanismo existente; los contadores requieren revisión especial. No se borra
  nada automáticamente y los eventos anulados se conservan.
- No se cambia un W.O. ya confirmado desde esta interfaz.
- No se altera el marcador regular después del cierre de fase, ni se permiten correcciones
  que dejen penales pendientes o cambien un ganador con cruces dependientes.
- Cambiar únicamente el autor sí está permitido con clasificación cerrada.
- No se aplica W.O. a semifinales con final/tercer puesto ya generados.
- Se conservan reloj 15–5–15, faltas, minutos, convocatorias y desempates normales.

Funciones reemplazadas en 024: guard_tournament_match, get_match_control, get_standings,
guard_tournament_event, edit_match_event_player y void_match_event. RPC nueva:
record_walkover. Se consolidan las protecciones de 018, autogoles de 022 y correcciones de
023 sin editar migraciones anteriores. Se mantienen permisos, RLS y Realtime; no se añade login.

Pruebas locales: npm test, npm run lint, npm run build, Playwright de eventos/reloj/cronología
y tests/browser/result-dialogs.spec.ts. Este último verifica 320/390/768/1280 px, listas largas,
foco, scroll, errores, W.O., edición finalizada y notificaciones Realtime simuladas entre páginas.
El ejecutor tests/run-sql.mjs usa PGlite efímero, incluye 022–024 y comprueba conservación de datos.

Pendiente para el propietario (no ejecutado): revisar historial y definiciones reales de Supabase
antes de aplicar 024. La reconstrucción local usa 001–023 en orden; las notas anteriores no
certifican el estado remoto actual. No ejecutar db push general ni reaplicar archivos a ciegas:
018 puede reemplazar ampliaciones de 022/023. Tras reconciliar dependencias, revisar/aplicar 024,
comprobar resultados y publicar el frontend por separado. W.O. y edición finalizada requieren
esa migración. No se necesitan nuevas variables ni dependencias. Sin migración remota ni deploy.

Resultado de esta revisión: build y lint aprobados, 17 pruebas unitarias aprobadas,
44 escenarios Playwright aprobados y suite SQL local completa (incluida 024) aprobada.
Se conserva el aviso de bundle JS mayor a 500 kB (aproximadamente 518 kB).
Sin cambios en credenciales, dependencias o migraciones 001–023; sin deploy ni SQL remoto.
