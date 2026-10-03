# Duración, reinicio protegido y actualización de versión

Las migraciones 028 y 029 ya se aplicaron en producción sin reiniciar datos. Véase [registro de aplicación y respaldo](production-028-029-applied.md). Los pasos de aplicación siguientes quedan como referencia para otros entornos; no reaplicarlos sobre la base ya migrada.

## Duración por partido

La migración `028_match_duration.sql` añade `matches.period_duration_seconds`: entero obligatorio, valor predeterminado 900 y restricción que permite solamente 900 o 1200. Los partidos existentes reciben 900. Las migraciones anteriores permanecen intactas.

El selector de `MatchControlPage.tsx`, sobre el marcador, guarda mediante `set_match_duration`, con control de `expected_updated_at`. Solo permite cambiar partidos PROGRAMADO sin tiempo iniciado. Un trigger también bloquea cambios posteriores desde SQL. Funciona para fase regular, semifinal, tercer puesto y final. El snapshot incluye la columna mediante la serialización existente del partido y Realtime provoca su recarga.

El reloj visible ahora muestra **tiempo restante**: 15:00 o 20:00 al inicio de cada tiempo y 5:00 al empezar el descanso. Los segundos persistidos y las marcas de los eventos siguen representando tiempo transcurrido. `matchClock.ts` centraliza la duración y conserva 900 como compatibilidad para snapshots antiguos. Los minutos solicitados siguen durando 60 segundos y congelan el reloj reglamentario.

SQL centraliza límites en `match_phase_limit` y el tiempo transcurrido en `match_elapsed_seconds`. Se adaptaron `control_match`, registros de eventos/goles/autogoles, W.O., validación temporal de eventos y apertura de penales, incluida la función antigua retirada. `finish_match_timeout` conserva su cálculo de 60 segundos; no necesitaba cambiar la duración reglamentaria. El límite SQL de PROGRAMADO es cero para los segundos transcurridos; la presentación muestra la duración completa.

## Reinicio

`ResetTournament.tsx` aparece únicamente en `/admin/controlar`. Muestra advertencia permanente y exige escribir exactamente `REINICIAR`, sin login. El botón final permanece deshabilitado hasta entonces y hasta obtener la generación vigente. Solo se informa éxito después de recibir confirmación de la RPC; los errores conservan el diálogo para revisión/reintento.

La migración `029_protected_tournament_reset.sql` crea `prepare_tournament_reset` y `reset_tournament`. Aplicarla **no borra datos**. La operación explícita de reinicio es una sola transacción, serializada con bloqueos; cualquier error revierte todo. Reutiliza la eliminación protegida de partidos y las cascadas existentes sin desactivar triggers. Un identificador de petición evita repetir un borrado por reintento, y una generación rechaza confirmaciones de un campeonato ya reiniciado. El tiempo máximo de espera por bloqueos es cinco segundos; un conflicto puede devolver error sin borrado parcial.

| Tabla | Resultado del reinicio |
| --- | --- |
| `matches` | Vacía: programación, resultados, W.O. y eliminatorias |
| `match_events` | Vacía: goles, autogoles, tarjetas, faltas, minutos y anulaciones |
| `match_players` | Vacía: convocatorias |
| `match_prechecks` | Vacía: controles previos |
| `match_foul_counters` | Vacía: contadores |
| `penalty_shootouts` | Vacía: tandas |
| `penalty_shootout_attempts` | Vacía: lanzamientos |
| `penalty_shootout_operations` | Vacía: operaciones/auditoría de penales |
| `player_initial_goals` | Vacía: saldos históricos |
| `players` | Vacía |
| `teams` | Vacía |
| `categories` | Conserva todas las categorías; limpia cierre regular y clasificados congelados |
| `matchdays` | Conserva jornadas; elimina fechas |

Las tablas de posiciones, puntos, goleadores y podios se calculan desde esos datos y quedan sin resultados anteriores. Se conservan esquema, funciones, triggers, RLS y configuración estructural. No se reinician UUID. La única tabla privada nueva conserva la generación y el último identificador de petición; no contiene administradores ni identidades de usuarios.

### Protección

Ambas RPC se conceden al rol existente `anon`, usando el cliente habitual de la aplicación. No hay login, cuentas nuevas, roles nuevos ni autorización por UUID. `prepare_tournament_reset()` se conserva únicamente para leer la generación actual: no autentica. `private.tournament_reset_state` tiene RLS y carece de permisos directos para los clientes. Las funciones usan `SECURITY DEFINER` con `search_path` vacío y referencias explícitas. No se revocan permisos globales del esquema `private`.

**Alcance:** advertencia y texto exacto protegen de clics accidentales; no son control de acceso. La RPC puede invocarse sin autenticación, conforme al modelo administrativo anónimo solicitado. El identificador estable de petición y la generación conservan la protección contra reintentos y diálogos obsoletos. Se eliminaron el cliente separado y la infraestructura de login del reinicio.

Después del éxito se limpia el estado local de solicitudes pendientes de goles/penales, se recarga el centro de control y se emite `tournament-reset` para actualizar vistas montadas. Las demás sesiones mantienen el mecanismo existente de Realtime/recarga.

## Versiones y caché

La revisión no encontró Service Worker, PWA ni registro de Service Worker en el proyecto. No se añadió ninguno. La inspección HTTP del despliegue existente encontró `public, max-age=0, must-revalidate` tanto en HTML como en el asset consultado: no demostró que un TTL largo de HTML fuera la causa. Una pestaña restaurada o que conserva JavaScript ya cargado es una explicación compatible; no se inspeccionó el dispositivo afectado y no se atribuye una causa definitiva.

- HTML y rutas SPA: `no-cache, max-age=0, must-revalidate`.
- `/assets/*`: `public, max-age=31536000, immutable`, aprovechando nombres con hash de Vite.
- `/version.json`: `no-store`; identificador nuevo generado por Vite en cada compilación.
- La reescritura SPA excluye `/assets`, `/brand` y `/version.json`; un asset ausente no se sustituye por HTML.
- `VersionRefresh.tsx` comprueba la versión al cargar, recuperar foco/visibilidad, volver mediante `pageshow`, recuperar conexión y cada 60 segundos mientras la página esté visible.
- En público recarga automáticamente una vez por versión/pestaña, con protección contra bucles. En administración muestra aviso y botón para evitar interrumpir formularios o controles de partido.
- Sin conexión o ante respuesta inválida se conserva la página funcionando. La comprobación no puede actuar dentro de una versión antigua que todavía no contiene este código: hay que cargar esta primera entrega al menos una vez.

Referencias: [Vercel Cache-Control](https://vercel.com/docs/caching/cache-control-headers), [configuración Vercel](https://vercel.com/docs/project-configuration/vercel-json).

## Archivos

- Interfaz: `src/MatchControlPage.tsx`, `src/PublicPages.tsx`, `src/ControlHub.tsx`, `src/App.tsx`, `src/index.css`.
- Nuevos componentes: `src/ResetTournament.tsx`, `src/VersionRefresh.tsx`.
- Bibliotecas: `src/lib/matchClock.ts`, `src/lib/useLiveRefresh.ts`; el reinicio utiliza `src/lib/supabase.ts` sin modificarlo.
- Despliegue: `vite.config.ts`, `vercel.json`.
- SQL: migraciones y pruebas `028_match_duration.sql`, `029_protected_tournament_reset.sql` en sus respectivas carpetas de Supabase.
- Pruebas: `tests/matchClock.test.ts`, `tests/run-sql.mjs`, `tests/local-read-api.mjs`, `tests/playoffs-simulation.mjs`; nuevo navegador `duration-reset-version.spec.ts` y ajustes de expectativas en `match-clock`, `timeouts`, `tournament`, `reversal-timeline`. Se eliminó el fixture de autenticación, ya innecesario.
- Documentación: este archivo y enlace en `README.md`.

No hay nuevas dependencias ni cambios de credenciales. El nombre de archivo `029_protected_tournament_reset.sql` se conserva; su protección actual es transaccional y contra accidentes/reintentos, sin autenticación.

## Verificación local

- TypeScript de aplicación y configuración: aprobado; compilación de producción aprobada.
- Lint: aprobado.
- Pruebas unitarias: 20 aprobadas.
- Suite SQL efímera con migraciones hasta 029: aprobada. Incluye duración, límites, tres etapas eliminatorias, permisos de reinicio, fallo provocado a mitad del borrado con reversión íntegra, conservación estructural, reintentos y rechazo de generaciones antiguas.
- Simulación deportiva completa: aprobada, 97 acciones inválidas rechazadas.
- Playwright de la entrega inicial: 51 pruebas aprobadas. En la revisión sin login pasaron las 9 pruebas de `duration-reset-version`, incluido reinicio anónimo sin llamadas de autenticación, actualización pública y conservación de formularios administrativos ante una versión nueva. También se repitieron y aprobaron TypeScript/build, lint, las 20 pruebas unitarias y la suite SQL completa hasta 029.
- La compilación mantiene el aviso de JavaScript superior a 500 kB. No impide generar `dist`.

Estas pruebas no sustituyen comprobar las RPC y cabeceras en el despliegue real.

## Pasos del propietario antes de publicar

1. Guardar una copia de seguridad y verificar que la base remota tiene el esquema y funciones esperados hasta 027. Reconciliar el historial real antes de ejecutar herramientas de migración; no reaplicar migraciones antiguas ni hacer un `db push` general a ciegas.
2. Aplicar y revisar **028 y luego 029**. No ejecutar la RPC de reinicio como prueba sobre el campeonato real. Ambas migraciones son necesarias antes de publicar esta interfaz.
3. No crear cuentas ni autorizar UUID: el reinicio conserva el modelo anónimo existente. No usar una clave de servicio en Vercel ni en el frontend.
4. Conservar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Vercel. No se necesitan nuevas variables: `VITE_APP_VERSION` se genera durante el build.
5. Publicar normalmente en Vercel con `npm run build` y directorio `dist`. Comprobar las cabeceras de `/`, una ruta profunda, `/version.json` y un asset con hash; confirmar que un asset inexistente devuelve 404 y no `index.html`.
6. En un entorno de prueba, verificar dos pestañas con duración 20, recuperación de foco tras un segundo despliegue y reinicio con advertencia y texto exacto. Las pruebas locales del reinicio usan una base efímera, nunca producción.
