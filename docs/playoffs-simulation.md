# Simulación local de eliminatorias y diseño de tanda

Fecha: 22 de septiembre de 2026. Resultado: **PASS**.

Este informe conserva los hallazgos del sistema anterior (001–024). Posteriormente se implementó la tanda en la migración local 025 y se actualizó el ejecutor de simulación. Para reproducir el estado actual, consultar [la implementación 025](penalty-shootouts-025.md).

## 1. Entorno y aislamiento

Se utilizó PGlite en memoria mediante `new PGlite()`, sin URL ni directorio persistente. El proyecto no tiene `supabase/config.toml` para un entorno Supabase local preparado. El ejecutor carga únicamente `supabase/schema.sql` y las migraciones locales 001–024. No importa el cliente Supabase, no carga `.env.local`, no ejecuta CLI remota ni despliega. La base desaparece al terminar.

Producción no fue tocada. La migración 024 se ejecutó exclusivamente dentro de esta base efímera. No se creó una migración 025 ni se implementó funcionalidad de tanda.

Reproducción desde la raíz, con Node 24 y la dependencia PGlite ya disponible en `.tmp-sql-check`:

```powershell
& 'C:\Program Files\nodejs\node.exe' tests/playoffs-simulation.mjs
```

El ejecutor genera `test-results/playoffs-simulation.json`: snapshots reales, clasificados, tabla regular, goleadores, resultados y mensajes de rechazos. Los partidos se operan con rol `anon` y las RPC actuales. El propietario solo crea fixtures y adelanta el reloj del segundo tiempo 901 segundos en esta base local; no se desactivan triggers. Las transiciones previas son manuales, permitidas por el código actual.

Alcance: integración SQL real en PostgreSQL embebido y ejecución de la función React/TypeScript compartida `podium`. El comportamiento visual y Realtime se determinó por inspección del código. Esta ejecución no comprueba renderizado en navegador ni transporte WebSocket Supabase.

## 2. Flujo actual y cierre por categoría

Se revisaron `PlayoffsAdmin.tsx`, `ControlHub.tsx`, `MatchControlPage.tsx`, `PublicPages.tsx`, `lib/tournament.ts`, `lib/useTournament.ts`, `lib/useLiveRefresh.ts` y las funciones y triggers de las migraciones actuales, incluida 024.

`close_regular(p_category_id)` bloquea la fila de esa categoría, rechaza partidos REGULAR pendientes de esa categoría y exige al menos un REGULAR finalizado en jornada 4. Obtiene los primeros cuatro de `get_standings(category,false)`, escribe `regular_closed_at=clock_timestamp()` y `qualified_team_ids` exclusivamente en `categories WHERE id=p_category_id`. Repetir el cierre conserva el cierre y clasificados existentes. No actualiza partidos de otras categorías. Devolver `get_tournament()` lee otras categorías, pero no las cierra.

La prueba creó MUJERES y VARONES ficticias. Tras cerrar MUJERES, la fila completa de VARONES y sus partidos permanecieron idénticos. VARONES conservó `regular_closed_at=null` y `qualified_team_ids=null`. Se programó y jugó otro regular 0–0 en jornada 3, manteniendo pendiente el de jornada 4. Intentar cerrar VARONES fue rechazado. Crear sus semifinales estando abierta también fue rechazado.

La independencia del cierre no elimina la restricción global de un solo partido activo. Además, el cierre comprueba los encuentros existentes: no detecta encuentros que nunca fueron programados.

## 3. Clasificación y cuatro UUID congelados

Se disputaron diez regulares: cada equipo venció 1–0 a todos los situados debajo. La tabla real obtenida fue:

| Equipo | PJ | GF | GC | DG | Puntos |
|---|---:|---:|---:|---:|---:|
| A | 4 | 4 | 0 | 4 | 12 |
| B | 4 | 3 | 1 | 2 | 9 |
| C | 4 | 2 | 2 | 0 | 6 |
| D | 4 | 1 | 3 | −2 | 3 |
| E | 4 | 0 | 4 | −4 | 0 |

El orden SQL utiliza puntos, diferencia y goles a favor descendentes; goles en contra, nombre e ID ascendentes para desempatar. `qualified_team_ids` quedó exactamente así, en orden A, B, C, D:

```json
[
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004"
]
```

E tiene UUID terminado en `005` y quedó fuera. Se comprobó el rechazo a incluirlo en semifinales. Lo congelado es el conjunto ordenado de cuatro IDs; no existe un snapshot persistente de toda la tabla. `get_standings` la recalcula a partir de regulares. En esta simulación, tabla completa e IDs fueron idénticos antes y después de todas las eliminatorias.

## 4. Cruces y resultados completos

La interfaz permite elegir los dos equipos de la primera semifinal; los dos restantes forman la segunda en el orden de clasificados. No hay sorteo ni imposición automática de 1.º–4.º. Elegir A y D produjo A–D y B–C mediante la RPC real `create_semifinals`. La RPC valida cuatro equipos distintos pertenecientes a los clasificados de esa categoría. Repetir la llamada no duplicó encuentros.

| Partido | Jornada | stage | Resultado | Ganador | Perdedor |
|---|---:|---|---|---|---|
| Semifinal 1 | 5 | SEMIFINAL | A 2–1 D | A | D |
| Semifinal 2 | 5 | SEMIFINAL | B 1–1 C | C por penales | B |
| Final | 6 | FINAL | A 2–2 C | A por penales | C |
| Tercer puesto | 6 | THIRD_PLACE | D 3–1 B | D | B |

Se eligió A como ganador ficticio de la final. Todos terminaron `FINALIZADO`, con `resolved=true`, ganador y perdedor correctos en `match_outcome` y `get_tournament`.

`generate_day6` lee las dos semifinales en orden `created_at,id`, exige ambas resueltas y enfrenta ganador 1–ganador 2 y perdedor 1–perdedor 2. Se rechazó generar la jornada antes de resolverlas. Repetir la generación completa no duplicó final ni tercer puesto. El podio calculado por la función real fue **A, C, D, B**; antes de resolver ambos partidos todavía era `null`.

Los 23 goles reglamentarios quedaron como goles normales: diez regulares y trece eliminatorios. Con una persona ficticia por equipo, los goleadores sumaron A=8, B=5, C=5, D=5. Seleccionar el ganador por penales, incluso repitiendo la selección, conservó íntegros los eventos, goleadores y tabla. Las eliminatorias tampoco entran en la tabla regular. Todos estos partidos conservaron `walkover_loser_team_id=null`; con la 024 cargada no hubo interferencia en este recorrido. Esto no sustituye la suite específica de W.O.

## 5. Empate y penales actuales: respuestas exactas

En una eliminatoria empatada en SEGUNDO_TIEMPO aparece automáticamente la sección **Ganador por penales**, con botones de ambos equipos. No existe un botón INICIAR PENALES ni una tanda interactiva. La UI explica que el marcador reglamentario permanece empatado y pide seleccionar quién ganó.

No hay transición automática a penales al agotarse el reloj. La opción ya puede aparecer antes: la implementación actual no exige consumir los 900 segundos. La RPC `set_penalty_winner(match,team)` exige eliminatoria, SEGUNDO_TIEMPO, empate y equipo participante; actualiza `matches.tiebreak_winner_team_id`. No registra lanzamientos ni modifica GOAL. No acepta un partido pausado o ya finalizado. No recibe `request_id` ni versión esperada; una nueva selección válida antes de finalizar puede sustituir la anterior.

La selección conserva SEGUNDO_TIEMPO y no congela por sí sola el reloj. El partido todavía no está resuelto para `match_outcome`: se debe pulsar finalizar. En las dos eliminatorias empatadas la prueba verificó que finalizar sin ganador produce un rechazo SQL; después de seleccionar C o A se pudo finalizar manteniendo 1–1 y 2–2 respectivamente. Un nuevo gol o la anulación de uno puede limpiar la selección mediante el trigger correspondiente.

| Pregunta | Respuesta actual |
|---|---|
| 1. ¿Marcador de penales? | No. |
| 2. ¿Cantidad convertida por equipo? | No. |
| 3. ¿Cada lanzamiento almacenado? | No. |
| 4. ¿Convertido/fallado? | No. |
| 5. ¿Orden? | No. |
| 6. ¿Corrección de un lanzamiento? | No hay lanzamientos que corregir. |
| 7. ¿Inicio? | La tarjeta muestra «equipo gana por penales» cuando existe ganador y empate. |
| 8. ¿Calendario? | La misma etiqueta, en partidos finalizados. |
| 9. ¿Mientras ocurre? | Solo la etiqueta después de seleccionar ganador, incluso antes de finalizar; no progreso de tanda. |
| 10. ¿Realtime? | El UPDATE de matches provoca recarga del snapshot; únicamente existe el ganador, no datos de lanzamientos. Verificado por código, no por WebSocket en PGlite. |
| 11. ¿Afecta goleadores? | No; no se crean GOAL. Los goles reglamentarios de eliminatorias sí cuentan. |
| 12. ¿Afecta GF/GC? | No; no modifica el marcador reglamentario ni la tabla regular. |
| 13. ¿Campo equivalente? | `matches.tiebreak_winner_team_id`. |

## 6. Propuesta futura, sin implementar

Separar las tandas de `match_events` y no atribuirlas a jugadores:

| Tabla propuesta | Datos principales |
|---|---|
| `match_shootouts` | `match_id` PK/FK, estado, equipo inicial, revisión, regla/versionado una vez acordado, inicio, fin y ganador. |
| `shootout_kicks` | ID, partido FK, equipo FK, orden global, convertido booleano, fecha/hora del servidor y `request_id` único. |
| Historial de correcciones | Lanzamiento, valor anterior/nuevo, fecha y operación para no borrar evidencia. |

Unicidad de partido+orden, validación de equipo participante y orden consecutivo. Los pendientes son posiciones de presentación; no se almacenan como fallados. El total de la tanda se deriva exclusivamente de lanzamientos convertidos vigentes. Sin columnas player_id ni inserciones en GOAL.

RPC propuestas: `start_penalty_shootout`, `record_penalty_kick`, `correct_penalty_kick` y `complete_penalty_shootout`. Bloqueo de la tanda con `FOR UPDATE`, revisión esperada e idempotencia por `request_id`; rechazar órdenes simultáneas obsoletas o reutilización de un request con contenido distinto. Definir corrección de resultado frente a anulación del último lanzamiento para no dejar huecos de orden.

Recomiendo un estado explícito PENALES en el partido para detener el reloj reglamentario y bloquear goles ordinarios, sin liberar la restricción de un partido activo. Esto requiere modificar las restricciones de estados, índice de partido activo, triggers, control del reloj y acciones permitidas: no basta con agregar dos tablas. Iniciar exigiría eliminatoria empatada y tiempo reglamentario terminado según la política que acordemos; excluir W.O.

El ganador calculado/validado de la tanda sería la autoridad. Su finalización sincronizaría `tiebreak_winner_team_id` en la misma transacción, conservando compatibilidad con `match_outcome`, `generate_day6` y podio. La RPC antigua de selección manual debe bloquearse cuando exista una tanda registrada. Los resultados históricos mantendrían su ganador manual y la etiqueta «detalle no registrado», sin inventar lanzamientos.

Una corrección que cambie el ganador cuando ya existan cruces dependientes debe bloquearse y exigir un flujo explícito de rectificación. No regenerar silenciosamente final o tercer puesto ni cambiar equipos de encuentros ya disputados.

**Pendiente de acordar:** cantidad inicial de tiros, quién comienza, condiciones de victoria anticipada, empate/muerte súbita y política de corrección/finalización. El ejemplo visual de cinco casillas y 3–2 no establece esas reglas. No se implementará detección automática de ganador hasta definirlas.

## 7. Interfaz, React y Realtime futuros

Al terminar empatado: **INICIAR PENALES**. Después, equipo de turno con botones **GOL / FALLÓ**, alternando entre equipos según las reglas acordadas. Encima, marcador reglamentario inmutable; debajo PENALES y el total separado. Cada equipo muestra convertido, fallado y pendiente con color, símbolo y texto accesible. Deshabilitar registro durante una solicitud pendiente; reintentos deben conservar el request_id.

Usar un componente compartido de visualización para administración, Inicio y Calendario; el control de captura sería otro componente. El público recibe el mismo snapshot, sin permisos de escritura nuevos. `get_match_control` y `get_tournament` incluirían objeto `shootout` con estado, revisión, total y lanzamientos ordenados. Publicar tablas nuevas en Realtime y actualizar `useLiveRefresh`; cada notificación refresca el snapshot completo para no sumar dos veces por eventos repetidos. Recuperación al reconectar mediante nueva lectura.

Archivos previsibles: `MatchControlPage.tsx`, `PublicPages.tsx`, `MatchDetails.tsx`, `src/lib/tournament.ts`, `src/lib/matchClock.ts`, `src/lib/useLiveRefresh.ts`, tipos/snapshots de control y estilos; componentes nuevos para control y marcador de tanda. Revisar `PlayoffsAdmin.tsx`, `ControlHub.tsx` y `useTournament.ts` para acciones, estados activos y consumo del snapshot.

SQL futuro: nueva migración, tablas/FK/índices/RLS/grants, RPC de tanda, snapshots, `set_penalty_winner`, control/transiciones/triggers y publicación Realtime. Revisar `match_outcome` y `generate_day6` para exigir tanda concluida sin alterar la lógica de cruces. `get_standings` y `get_top_scorers` deben seguir ignorando totalmente estas tablas.

## 8. Pruebas necesarias antes de utilizar la tanda

- SQL: inicio válido e inválido, alternancia, orden, equipo ajeno, reglas definitivas, empate, victoria y finalización; invariantes del marcador reglamentario, GF/GC y goleadores.
- Concurrencia: doble clic, mismo request repetido, request reutilizado con payload diferente, dos operadores, revisión obsoleta y respuesta perdida.
- Correcciones: cambio/retirada del tiro, historial, recálculo, protección de encuentros dependientes, prohibición de edición silenciosa de ganadores históricos.
- Integración: semifinales, final, tercer puesto, podio, W.O., categorías independientes, partido activo global y compatibilidad con ganadores manuales antiguos.
- UI/Playwright local: iniciar tanda, turno visible, botones GOL/FALLÓ, colores y símbolos accesibles, marcador separado, acciones ordinarias bloqueadas, errores y reconexión.
- Supabase local: permisos reales, publicación Realtime, dos clientes sincronizados y recuperación de notificaciones perdidas; PGlite por sí solo no prueba este transporte.
- Migración: conservar partidos, eventos, goleadores y resultados previos; no fabricar lanzamientos de tandas históricas.

En esta tarea solo se añadieron este informe y el ejecutor local. No se modificaron componentes, reglas SQL ni migraciones de la aplicación.
