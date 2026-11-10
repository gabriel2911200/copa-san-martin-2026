# Modificaciones integrales de Copa San Martín 2026

Este informe registra la implementación inicial. La [auditoría posterior 031](031-auditoria-integral.md) documenta fallas adicionales, correcciones locales a 030, la migración complementaria 031 y un bloqueo crítico de autorización pendiente. Sus resultados y limitaciones sustituyen cualquier inferencia de preparación para producción a partir de las pruebas iniciales.

Implementación local del 7 de noviembre de 2026. No se aplicaron migraciones ni se modificaron datos de producción.

## Arquitectura y decisiones

El sistema existente usa React 19, TypeScript, React Router, Vite y Supabase. Los datos se leen con RLS y las operaciones de control se realizan mediante RPC de PostgreSQL, con bloqueo de la fila del partido, marcas de actualización y recibos idempotentes para eventos y penales. Realtime y consultas periódicas sincronizan los dispositivos. La administración existente usa el rol anónimo y no tenía inicio de sesión.

El modelo representa una competición con categorías y jornadas; no tiene una entidad de múltiples campeonatos. El catálogo de duraciones es global para todas las categorías y encuentros. Los dorsales se asignan por partido, equipo y jugador en `match_players`; no son un atributo global del jugador. Se mantiene ese ámbito para permitir dorsales distintos en plantillas independientes.

## Funcionalidades

- **Amistosos**: ruta `/admin/amistosos`, selección manual o aleatoria de equipos activos de una categoría, fecha, hora, duración y penales opcionales en caso de empate. Historial separado. Reutilizan el controlador, convocatorias, cronómetro, faltas, goles, tarjetas, penales y reapertura existentes.
- **Separación oficial**: etapa `FRIENDLY`, excluida de `get_tournament` y `get_top_scorers`. Las posiciones y eliminatorias ya filtran por etapas oficiales. Los amistosos no generan clasificados ni finales. La restricción existente de un solo encuentro activo se mantiene.
- **Duraciones**: catálogo persistente compartido, con 15 y 20 minutos predeterminados; menú de tres puntos para agregar, eliminar opciones personalizadas o elegir un tiempo exclusivo. Se admiten minutos enteros entre 1 y 180. Cada encuentro almacena sus propios segundos. Quitar una opción no modifica encuentros. Para proteger el reloj, solo se cambia la duración antes de iniciar, tanto en interfaz como en base de datos.
- **Confirmaciones**: iniciar primer tiempo; terminar primer tiempo e iniciar descanso; terminar descanso e iniciar segundo tiempo; terminar segundo tiempo y partido. Son las transiciones combinadas del modelo actual. Cada diálogo muestra equipos, marcador y estado. Cancelar no escribe. Un diálogo cuya versión quedó obsoleta no permite confirmar; el servidor comprueba nuevamente la versión y serializa las operaciones. Pausar, reanudar y terminar un minuto conservan sus controles directos.
- **Reapertura**: acceso a partidos finalizados desde Controlar. Autenticación aislada y temporal mediante Supabase Auth, con `app_metadata.role = admin`, validada por el servidor. Se guarda el estado temporal anterior a cada finalización y una auditoría privada con usuario, fecha y estados antes/después. Se restaura en pausa. En partidos anteriores a esta migración se conserva el reloj final persistido del segundo tiempo. No se recrean goles ni tarjetas. Una tanda reabierta conserva sus tiros y permite corregir o continuar sus penales.
- **Penales**: indicadores circulares de 32 px, cinco casillas visibles inicialmente, filas de cinco, marcador visible y ganador destacado. Conserva corrección y anulación del último lanzamiento. Cantidad inicial configurable en tres o cinco antes del primer tiro; mantiene muerte súbita y definición automática matemática. El cierre administrativo acepta un marcador desigual tras al menos un tiro por equipo y requiere confirmación explícita. Un 3–2 con tres tiros por equipo conserva seis registros y cuatro casillas pendientes, sin convertirlas en fallos. Se conserva el protocolo de solicitudes idempotentes y revisión de la tanda.
- **Dorsales**: pestañas Añadir/Editar derivadas de la convocatoria persistida. Selector de jugador y ventana de asignación/edición. Admite 0–99, incluido el 0; rechaza vacío, fracciones y valores fuera de rango. Los duplicados se detectan localmente y en SQL dentro del mismo partido y equipo, con mensaje que identifica al titular. Los rechazos controlados dejan la interfaz operativa y recuperan el estado del servidor. Se mantiene el índice UNIQUE parcial existente y se añade un límite de espera por bloqueos de cinco segundos. La edición no reescribe el dorsal registrado en eventos históricos. No se permite retirar una convocatoria que ya tiene eventos.

## Archivos y componentes

Componentes nuevos:

- `src/FriendliesPage.tsx`
- `src/DurationSelector.tsx`
- `src/ReopenMatch.tsx`

Componentes y utilidades modificados:

- `src/App.tsx`: ruta y navegación.
- `src/AdminPage.tsx`: duración al crear encuentros oficiales.
- `src/ControlHub.tsx`: acceso al historial oficial finalizado.
- `src/MatchControlPage.tsx`: confirmaciones, duraciones, reapertura y errores de convocatoria.
- `src/MatchLineup.tsx`: pestañas y diálogos de dorsales.
- `src/PenaltyShootout.tsx`: cierre administrativo, configuración inicial y presentación.
- `src/index.css`: controles compactos, diálogos e indicadores.
- `src/lib/matchClock.ts`: duración numérica por encuentro.
- `src/lib/penalties.ts`: casillas con tres/cinco iniciales y muerte súbita.
- `src/lib/tournament.ts`: etiqueta de amistosos.

Persistencia:

- `supabase/migrations/030_flexible_matches.sql`
- Tablas nuevas: `public.duration_options`, `private.match_finish_snapshots`, `private.match_reopen_audit`.
- Columnas nuevas: `matches.friendly_penalties`, `penalty_shootouts.initial_attempts`.
- Ampliación de etapa y rango de duración; unicidad del calendario oficial conserva su alcance y permite amistosos repetidos.
- Nuevas RPC: `manage_duration`, `create_friendly`, `get_friendlies`, `reopen_match`; actualización de las funciones de duraciones, convocatorias, penales, guardas y agregaciones.
- Verificación previa de dorsales duplicados: aborta e informa los ámbitos afectados sin corregir registros automáticamente. No se crea un nuevo índice de dorsales porque ya existía uno que protege el ámbito correcto.

Pruebas:

- `supabase/tests/030_flexible_matches.sql`
- `supabase/tests/030_three_penalties.sql`
- `supabase/tests/030_reopen_playoffs.sql`
- `tests/lineupConcurrency.mjs`
- `tests/browser/flexible-matches.spec.ts`
- `tests/run-sql.mjs`: integra las pruebas nuevas y compara los datos históricos antes y después de la migración.
- Adaptación de las pruebas de navegador de duraciones, reloj, control, eventos y penales al flujo confirmado y los nuevos controles.
- `tests/local-read-api.mjs`: lectura del catálogo en el servidor de pruebas aislado.

## Activación pendiente en el entorno real

1. Respaldar y revisar el estado del destino con el procedimiento operativo del proyecto.
2. Aplicar `030_flexible_matches.sql` después de 001–029. Es transaccional y no contiene borrados de registros históricos ni reconstrucciones de resultados.
3. Autorizar las cuentas que podrán reabrir mediante Supabase Auth y el atributo **de servidor** `app_metadata.role: "admin"`. El atributo `user_metadata` no concede este permiso. No se incluyeron credenciales ni claves administrativas en el frontend.
4. Desplegar la aplicación y verificar acceso real de las cuentas administradoras, Realtime y concurrencia con dos sesiones PostgreSQL independientes.

No se ejecutó ninguno de estos pasos sobre producción.

## Límites conservados deliberadamente

- La reapertura de W.O., de fase regular cuya clasificación ya está cerrada y de semifinales con final/tercer puesto existentes requiere revisión administrativa. Se rechaza sin modificar datos; no se eliminan ni regeneran cruces dependientes automáticamente.
- Una tanda reabierta continúa en penales; el marcador reglamentario permanece protegido por las guardas existentes.
- El modelo tiene dos tiempos y descanso. No se añadieron prórrogas ni una estructura de múltiples campeonatos.
- Los penales opcionales en amistosos se habilitan con empate al terminar el segundo tiempo.
- Las pruebas de solicitudes solapadas usan PGlite, cuyo motor serializa las consultas; comprueban rechazo de revisión obsoleta y el índice UNIQUE. No equivalen a una prueba de dos conexiones reales en producción.
- El acceso Auth real no se puede verificar con las credenciales de usuarios finales desde estas pruebas aisladas; se verifican permisos SQL y el flujo de navegador con respuestas simuladas.

## Comandos de verificación

```text
npm.cmd test
npm.cmd run lint
npm.cmd run build
node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js
node node_modules/@playwright/test/cli.js test --config playwright.isolated.config.ts tests/browser/flexible-matches.spec.ts tests/browser/penalty-shootout.spec.ts tests/browser/match-clock.spec.ts tests/browser/match-management.spec.ts tests/browser/players-events.spec.ts tests/browser/duration-reset-version.spec.ts
```

Las pruebas SQL crean una base efímera sin conectarse a Supabase. Las pruebas de navegador usan configuración aislada, sin leer `.env`, con API local o respuestas simuladas.

## Resultados obtenidos

- **20 pruebas unitarias** aprobadas.
- **55 escenarios de navegador distintos** aprobados entre las ejecuciones de los seis archivos indicados. La última batería reunió 40 casos de amistosos, dorsales, reapertura, control, eventos y penales, todos aprobados; los otros 15 casos de duraciones, reinicio, versión y cronómetro aprobaron en la ejecución anterior. No se ejecutó la totalidad de todos los archivos Playwright del repositorio.
- **Batería SQL completa del ejecutor** aprobada: migraciones 001–030, regresiones anteriores, las tres suites 030 y solicitudes solapadas. La comparación antes/después de 030 conservó los valores históricos de partidos, jugadores, dorsales, eventos, tandas, tiros, equipos, categorías y jornadas.
- **Lint** aprobado, sin avisos.
- **Compilación TypeScript y Vite** aprobada. Vite mantiene un aviso no bloqueante de paquete JavaScript superior a 500 kB; el resultado final es de aproximadamente 542 kB sin compresión y 154 kB gzip.
- **Inspección visual** de la captura móvil de penales y pruebas de desbordamiento a 320, 390, 768 y 1280 px aprobadas.
- Los errores intermedios detectados en pruebas se corrigieron: nombres accesibles de selectores, expectativas del diseño anterior y fixtures del nuevo catálogo. Se corrigió la deshabilitación del control tras rechazos conocidos de convocatoria y se añadió recuperación del estado actual para conflictos entre administradores.
- Windows bloqueó inicialmente procesos de Node/Vite/Playwright en el entorno restringido; las ejecuciones autorizadas fuera de ese entorno completaron las comprobaciones.
