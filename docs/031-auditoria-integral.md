# Auditoría integral — Copa San Martín 2026

Fecha: 7 de noviembre de 2026. Alcance: repositorio y entornos locales aislados. **No se accedió a la base de producción, no se desplegó, no se modificaron usuarios o credenciales y no se crearon commits.**

## 1. Resumen ejecutivo

Se confirmaron **11 hallazgos de producto y seguridad**: **10 corregidos localmente y 1 pendiente**. La distribución es un crítico, cinco altos y cinco medios. Los cinco altos están corregidos. El crítico pendiente es el diseño previo de administración anónima: permite operaciones administrativas desde la API pública, incluido el reinicio permanente de datos. Por ese motivo **el sistema no está listo para publicarse como administración protegida**.

Los números anteriores no incluyen advertencias de tamaño de compilación, limitaciones de verificación ni mantenimiento de mocks y scripts de pruebas. Estos se detallan por separado para no inflar el recuento de errores.

Las correcciones conservan el modelo deportivo, la administración existente y los historiales. No se inventan tiros ni se reconstruyen resultados antiguos. La reapertura de un resultado histórico de penales sin lanzamientos documentados se rechaza para evitar perder su ganador.

## 2. Alcance y método

Se revisaron rutas, componentes, utilidades, modelos, consultas, almacenamiento local, actualización en vivo, las migraciones 001–031, políticas RLS, permisos de tablas y RPC, dependencias, pruebas, compilación y configuración de Vercel. Se combinaron inspección de código, inventario real de permisos en PostgreSQL embebido, simulación deportiva y pruebas de interfaz.

Las migraciones se reconstruyeron en **PGlite efímero**, desde el esquema inicial, con fixtures sintéticos e históricos del repositorio. No se usaron backups reales ni se ejecutaron pruebas destructivas contra datos reales. No se dispuso de una copia anonimizada y autorizada del destino: la compatibilidad exacta con sus datos y su historial de migraciones sigue pendiente de verificación.

## 3. Arquitectura revisada

| Capa | Implementación y observaciones |
|---|---|
| Frontend | React 19, TypeScript, React Router, Vite y Tailwind; navegación pública y administrativa en `src/App.tsx`. |
| Datos | Supabase/PostgreSQL; tablas de categorías, equipos, jornadas, partidos, jugadores, convocatorias, eventos, faltas, controles previos, goles iniciales y penales. |
| Reglas y concurrencia | RPC SQL, bloqueo del partido, revisiones de tanda, `updated_at`, restricciones e índices de unicidad; marcador calculado desde eventos vigentes. |
| Cronómetro | Segundos acumulados e instante de inicio del servidor; presentación con `performance.now()`, pausa persistida y límite por encuentro. No escribe cada segundo. |
| Actualización | Realtime y respaldo periódico, recuperación al volver a la ventana o recuperar conexión. |
| Reintentos | UUID y recibos idempotentes para eventos y penales; la auditoría añade recuperación persistida de la creación de amistosos. |
| Autorización | Administración general con rol público, por decisión previa documentada. La reapertura sí exige JWT autenticado y `app_metadata.role = admin` en SQL. |
| Despliegue | SPA en Vercel; rutas reescritas a `index.html`, recursos con hash e inmutables y `version.json` sin caché. No se publicó nada. |

El modelo representa una competición con categorías y jornadas, no múltiples campeonatos independientes. Los dorsales pertenecen a la convocatoria de un partido y equipo; cambiar un dorsal no crea otro jugador ni modifica los snapshots de eventos anteriores.

## 4. Módulos inspeccionados

| Módulo | Comprobaciones |
|---|---|
| Creación y equipos | Categoría, jornada, rivales distintos, equipos activos, duplicidad de encuentros oficiales, nombres, baja lógica, exclusión de equipos retirados de nuevas selecciones. |
| Plantillas y dorsales | Identificadores reales, 0–99, separación Añadir/Editar, duplicados por partido/equipo, edición con eventos históricos, cancelación, errores y solicitudes solapadas. |
| Agenda y calendario | Fechas/horas, hora sin fecha, control de versión, conservación de resultados y de borradores durante actualizaciones remotas. |
| Control en vivo | Inicio, pausa, reanudación, descanso, segundo tiempo, cierre anticipado, confirmación/cancelación, tiempo muerto y reapertura. |
| Cronómetros | Duraciones 15/20 y exclusivas, límite de fase, recarga, resta de hora del servidor, reloj detenido, reanudación desde vencimiento del minuto y recuperación de estado persistido. |
| Eventos y estadísticas | Goles, autogoles, amarillas, roja, doble amarilla, faltas por periodo, minutos, correcciones y reversión sin duplicar registros. |
| Posiciones y goleadores | Puntos, GF/GC/DG, desempates existentes, posiciones provisionales/definitivas, goles iniciales e independencia de amistosos y penales. |
| Clasificación y playoffs | Top 4 fijado, cruces configurados, generación automática de final/tercer puesto, ganadores por penales, podio y protección de resultados fuente. |
| Penales | Tres/cinco, definición matemática, muerte súbita, cierre administrativo desigual, empate rechazado, pendientes sin contabilizar, corrección, anulación y reapertura con tiros intactos. |
| Amistosos | Selección manual/aleatoria, configuración, historial independiente, persistencia y recuperación de una respuesta perdida. |
| Administración y caché | Borrado, reinicio, guardas de dependencias, permisos reales de API, avisos de nueva versión y preservación de formularios administrativos. |

## 5. Hallazgos confirmados y gravedad

| ID | Gravedad | Error y causa raíz | Estado |
|---|---|---|---|
| C01 | **Crítico** | Las RPC administrativas, incluido el reinicio, son ejecutables por `anon`. RLS no neutraliza una función `SECURITY DEFINER` con permiso público. Ocultar `/admin` o escribir REINICIAR no autentica. | **Pendiente: decisión de autorización y preparación de cuentas.** |
| A01 | Alto | `delete_match` no verificaba clasificación cerrada ni final/tercer puesto dependientes; era posible eliminar el resultado fuente conservando clasificados o cruces incompatibles. | Corregido. |
| A02 | Alto | `reopen_match` limpiaba `tiebreak_winner_team_id` aunque se tratara de un ganador histórico sin registros de tanda. No existían tiros desde los cuales recuperar ese resultado. | Corregido con rechazo seguro, sin reconstrucción. |
| A03 | Alto | El identificador de creación de amistosos solo vivía en un `useRef`. Tras perder la respuesta y recargar se podía crear otro encuentro con un UUID nuevo. Las lecturas anteriores a una escritura tampoco se invalidaban. | Corregido. |
| A04 | Alto | Penales marcaba una operación pendiente antes de guardar en `sessionStorage`; si el almacenamiento fallaba, bloqueaba controles aunque no hubiera enviado nada. La caché JSON tampoco validaba su estructura ni su partido. | Corregido. |
| A05 | Alto | El selector de duración estaba dentro del formulario de amistosos. Enter en su campo podía enviar el formulario exterior y crear un encuentro, en lugar de guardar la duración. | Corregido. |
| M01 | Medio | Un fallo al releer el catálogo después de modificarlo no se propagaba al flujo de guardado: el diálogo podía cerrarse con opciones obsoletas y sin una vía explícita de recarga. | Corregido. |
| M02 | Medio | El controlador filtraba jugadores expulsados antes de pasar la convocatoria al gestor de dorsales. Desaparecían dorsales realmente guardados y la validación visual ignoraba esos números ocupados. | Corregido; la expulsión sigue excluyendo al jugador de goles y tarjetas nuevas. |
| M03 | Medio | Amistosos aceptaba hora sin fecha en la interfaz y no validaba explícitamente duración nula/rango en la RPC; el error llegaba como una restricción SQL genérica. | Corregido. |
| M04 | Medio | La guarda de reversión trataba todos los partidos no regulares como eliminatorias. Anular el único gol de un amistoso finalizado podía rechazarse por producir empate, aunque no existiera tanda. | Corregido. |
| M05 | Medio | Los editores de agenda usaban `updated_at` como `key`. Una actualización del cronómetro remontaba el componente y perdía el borrador. Al conservarlo sin guardar su versión se habría podido sobrescribir un cambio remoto. | Corregido: borrador y versión originales, descarte explícito y rechazo de revisión obsoleta. |

## 6. Evidencia y causas identificadas

- **C01:** `README.md:62–63` y `README.md:137–138` documentan la administración anónima como decisión del proyecto. `supabase/migrations/029_protected_tournament_reset.sql:54` concede el reinicio a `anon`. `tests/audit-security.mjs` reconstruye el esquema e identifica **25 funciones SECURITY DEFINER accesibles por el rol público**, entre ellas control, goles, borrado y reinicio. La lista incluye preparaciones y funciones de compatibilidad; no se afirma que las 25 sean escrituras efectivas en todas sus ramas.
- **A01:** la versión anterior de `delete_match` en `011_delete_match.sql:4` comprobaba versión y bloqueaba categoría, pero borraba sin revisar dependencias. Las nuevas guardas están en `031_audit_integrity.sql:5`.
- **A02:** `030_flexible_matches.sql:97` ahora detecta el resultado histórico sin tanda antes de insertar auditoría o alterar el encuentro. La prueba conserva exactamente el snapshot y comprueba que no se insertó una reapertura fallida.
- **A03:** `src/FriendliesPage.tsx:14` recupera la solicitud, `:42` invalida lecturas antiguas y `:69` persiste la intención antes de enviar. `src/lib/friendlyRequest.ts` valida el formato. La regresión pierde la respuesta, oculta temporalmente el resultado en el historial, recarga y comprueba dos peticiones con el mismo ID y un único partido.
- **A04:** `src/PenaltyShootout.tsx:36` guarda antes de marcar/enviar la operación; los fallos previos al envío liberan los controles. `src/lib/shootoutRequest.ts` rechaza RPC ajenas, otro partido y revisiones inválidas. `src/lib/rpcErrors.ts` distingue rechazos SQL confirmados, incluidos errores de datos clase 22, de fallos de transporte.
- **A05:** `src/EventDialog.tsx:31` monta los diálogos fuera del formulario mediante portal y detiene la propagación de submit. `src/DurationSelector.tsx:50` usa un formulario propio para guardar con Enter.
- **M01:** `src/DurationSelector.tsx:15` informa si la carga falló; el guardado conserva el diálogo y permite reintentar una operación de catálogo idempotente.
- **M02:** `src/MatchControlPage.tsx:380` pasa toda la convocatoria al gestor. La selección de autores sigue filtrando expulsados. Los eventos históricos conservan su dorsal original.
- **M03:** `030_flexible_matches.sql:67–68` valida duración y agenda; `src/FriendliesPage.tsx:91` deshabilita la hora sin fecha y la limpia al quitar la fecha.
- **M04:** `031_audit_integrity.sql:21` limita la protección de resolución eliminatoria a SEMIFINAL, FINAL y THIRD_PLACE. La guarda independiente de tandas sigue protegiendo el marcador reglamentario cuando existen penales.
- **M05:** `src/ScheduleEditor.tsx:6` guarda la versión junto al borrador. Se retiraron las claves basadas en `updated_at` de `ControlHub.tsx` y `PublicPages.tsx`.

Las referencias de línea corresponden al árbol local auditado, no a un commit publicado.

## 7. Correcciones implementadas

Se aplicaron diez correcciones seguras de código local. En datos se añadieron validaciones y rechazos; no se modificaron resultados para hacer pasar pruebas. El reinicio explícito existente se adaptó a eliminar primero las etapas dependientes dentro de su transacción, después de liberar su propia clasificación; así conserva su comportamiento previsto frente a las nuevas guardas de borrado. Esto no resuelve C01 ni ejecuta un reinicio al aplicar la migración.

La reapertura de W.O., de fase regular cerrada, de semifinales con cruces dependientes y de penales históricos sin tiros documentados requiere revisión administrativa. Las tandas documentadas conservan sus lanzamientos al reabrir. La duración en curso permanece inmutable para no reiniciar accidentalmente el reloj.

## 8. Archivos modificados durante la auditoría

Implementación:

- `src/EventDialog.tsx`, `src/DurationSelector.tsx`, `src/FriendliesPage.tsx`, `src/PenaltyShootout.tsx`.
- `src/MatchControlPage.tsx`, `src/MatchLineup.tsx`, `src/ScheduleEditor.tsx`, `src/ControlHub.tsx`, `src/PublicPages.tsx`.
- Nuevos: `src/lib/friendlyRequest.ts`, `src/lib/shootoutRequest.ts`, `src/lib/rpcErrors.ts`.
- `supabase/migrations/030_flexible_matches.sql`: correcciones a la migración todavía pendiente, no aplicada en producción.
- Nueva: `supabase/migrations/031_audit_integrity.sql`: guardas de borrado y reversión, adaptación transaccional del reinicio. No cambia filas al aplicarse.

Pruebas e informe:

- Nuevos: `supabase/tests/031_audit_integrity.sql`, `tests/requestRecovery.test.ts`, `tests/audit-security.mjs`, `tests/migration030-preflight.mjs`, `tests/browser/audit.spec.ts`, `tests/browser/audit-console.spec.ts`.
- `tests/run-sql.mjs`: incorpora 031 y compara historiales antes/después de ambas migraciones nuevas.
- `tests/playoffs-simulation.mjs`: revisión explícita y ampliación del límite de migraciones 029 a 031; conserva la protección frente a migraciones futuras no revisadas.
- `tests/local-read-api.mjs`: habilita la lectura aislada de amistosos, sin habilitar escrituras.
- `tests/browser/result-dialogs.spec.ts`, `upcoming.spec.ts`, `reversal-timeline.spec.ts`, `match-management.spec.ts`: actualización de mocks de catálogo y expectativas de convocatorias visibles.
- `tests/browser/timeouts.spec.ts`: reloj virtual congelado antes de cargar y espera explícita de la confirmación asíncrona; se mantienen las aserciones exactas de los 60 segundos.
- `package.json`: incorpora las nuevas pruebas unitarias al comando habitual.
- Este informe y notas de enlace en README/documentación 030.

El árbol ya contenía las modificaciones locales de 030 al comenzar la auditoría. Se conservaron; no se generaron commits, push ni despliegues.

## 9. Seguridad revisada

Confirmado en la base aislada: RLS está habilitado en todas las tablas públicas; no hay INSERT directo anónimo en eventos; las funciones internas antiguas de escritura de penales están revocadas; el esquema privado no es accesible por `anon`; la reapertura rechaza `anon` y cuentas autenticadas sin rol administrador de servidor. Los atributos de usuario editables no conceden la reapertura.

La revisión de archivos versionados no encontró archivos privados de entorno ni backups versionados. El cliente local usa una clave de tipo publicable; no se imprimió su valor. No se cambiaron claves ni cuentas. Una clave publicable no autoriza por sí misma operaciones sensibles: el problema de C01 son los permisos y funciones del servidor.

Las consultas del frontend usan argumentos estructurados y las RPC usan parámetros SQL; no se identificaron construcción de SQL con entradas de usuario, `eval` ni sinks HTML sin escapar en el código de producto revisado. React renderiza los nombres como texto. La API usa claves/JWT enviados por el cliente, no sesiones administrativas de cookies; no se identificó un flujo administrativo basado en cookies al que atribuir un ataque CSRF clásico. Estas observaciones no equivalen a una certificación externa de penetración.

`npm audit --json` consultó el registro y reportó **0 vulnerabilidades conocidas** en las dependencias revisadas. No se actualizó ninguna dependencia para ocultar un problema ni se modificó el lockfile.

## 10. Pruebas ejecutadas y resultados

| Verificación | Resultado |
|---|---|
| Unitarias: `npm.cmd test` | **23 aprobadas**, incluidas las tres nuevas de recuperación y errores SQL. |
| SQL: `node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js` | **Aprobado**: esquema, migraciones 001–031, regresiones previas, suites 030/031, preservación histórica y solicitudes solapadas de dorsal. |
| Simulación: `node tests/playoffs-simulation.mjs` | **Aprobado**: campeonato completo hasta podio/goleadores; **97 acciones inválidas rechazadas**. |
| Atribución histórica: `node tests/historical-attribution.mjs` | **Aprobado**: cinco eventos de un fixture, 4–1 intacto, cuatro fichas sin dorsal y reintento sin duplicados. |
| Preflight: `node tests/migration030-preflight.mjs` | **Aprobado**: una instalación sintética sin su índice UNIQUE y con dorsales duplicados hace abortar 030 sin cambiar sus filas ni su esquema anterior. |
| Seguridad: `node tests/audit-security.mjs` | Diagnóstico completado; **reproduce C01** y verifica las otras restricciones descritas. No representa una aprobación de seguridad global. |
| Dependencias: `npm.cmd audit --json` | **0 avisos conocidos**: 0 críticos, altos, moderados o bajos. |
| Lint | **Aprobado**, sin avisos en la comprobación final. |
| Compilación | **Aprobada**: TypeScript y Vite. Paquete principal de 546,35 kB, 155,54 kB gzip; aviso no bloqueante por superar 500 kB. |
| Navegador completo | **117/117 aprobados**, ejecución final completa con `--config playwright.isolated.config.ts --workers=2`, sin reintentos automáticos, en 2,4 minutos. Incluye navegación/consola sin errores en 320 y 1280 px. |

Primera ejecución amplia: **104/107**. Se corrigieron dos mocks que desconocían el catálogo y una expectativa de presentación anterior. La siguiente ejecución: **114/115**; quedaba otra expectativa antigua de ocultar al expulsado, actualizada manteniendo la prueba que prohíbe seleccionarlo para anotar. Las diez pruebas nuevas de auditoría y consola se incorporaron a la ejecución final completa. No se contabilizan intentos fallidos como aprobados.

Una ejecución completa posterior alcanzó **116/117** y detectó inestabilidad del fixture del cronómetro público: el reloj virtual seguía avanzando durante navegación y las comprobaciones del servidor podían preceder a la RPC asíncrona de asentamiento. Se corrigió el arnés, sin cambiar el cálculo del producto ni ampliar tolerancias: reloj fijado antes de cargar y espera de la confirmación de servidor. Después aprobaron **15/15 ejecuciones** de los cinco casos de tiempo muerto repetidos tres veces. La última ejecución completa se registra en la tabla anterior.

Los casos nuevos prueban Enter sin escritura exterior, respuesta perdida/recarga sin duplicar amistosos, recuperación de lecturas, almacenamiento bloqueado, caché corrupta, dorsales de expulsados, borrador/versionado de agenda y error al releer el catálogo. Las pruebas existentes cubren móvil/tableta/escritorio, penales largos, tres/cinco, muerte súbita, W.O., cancelaciones, cambios de fase, red, recargas, estadísticas y actualizaciones simuladas entre vistas.

## 11. Datos históricos y migraciones

Las comparaciones antes/después de 030 y 031 conservaron los valores históricos de partidos, jugadores, dorsales, eventos, tandas, tiros, equipos, categorías y jornadas de los fixtures. Las operaciones negativas se prueban en transacciones revertidas. No se corrigieron duplicados históricos borrando filas.

030 mantiene el índice UNIQUE de dorsales y detecta inconsistencias antes de continuar. Amplía rangos y etapas sin cambiar los valores previos. Las nuevas tablas privadas tienen RLS y no conceden acceso directo a roles públicos. 031 reemplaza funciones; no ejecuta su contenido destructivo al migrar.

**Estado real:** 030 sigue sin aplicarse en producción; 031 también es exclusivamente local. Pasar una reconstrucción sintética no autoriza un `db push` ni certifica el historial remoto. No se ha revisado una copia representativa anonimizada del destino.

## 12. Riesgos potenciales y verificaciones pendientes

Se distinguen de los once errores confirmados:

- **Concurrencia real:** PGlite serializa peticiones en un único motor. Se verificaron UUID, revisiones, rechazos y UNIQUE, pero falta una prueba con dos conexiones PostgreSQL independientes y dos administradores reales.
- **Entorno real:** no se verificaron cuentas Auth reales, sus atributos de servidor, políticas desplegadas, Realtime de Supabase ni latencia/caídas del servicio remoto. Las rutas y eventos de navegador usan API local o mocks.
- **Datos representativos:** falta ensayo de migración y restauración en copia autorizada anonimizada, con el mismo historial de aplicaciones parciales del destino.
- **Navegadores:** se verifica el canal Microsoft Edge configurado en Playwright. No se certifican Safari/iOS ni Firefox desde este entorno Windows. Los anchos de 320, 390, 768 y 1280 px no sustituyen dispositivos físicos.
- **Carga:** no se ejecutó una prueba de volumen de un campeonato mucho mayor ni un perfil prolongado de memoria. `get_tournament` devuelve snapshots completos y hay suscripciones por vista; requieren medición con volumen representativo.
- **Bundle:** Vite advierte del paquete principal superior a 500 kB. Es una advertencia de rendimiento, no un error de compilación; no se hizo una refactorización de rutas para ocultarla.
- **Reglas administrativas:** la aplicación no puede inferir partidos regulares que nunca se programaron. El cierre valida los encuentros existentes y el número de partidos de los equipos, no una cobertura de calendario no almacenada. No se cambió esta regla por suposición.
- **HTTP y defensa adicional:** no se certificaron cabeceras efectivas del alojamiento, protección frente a abuso/rate limiting ni pruebas externas de penetración. Los rechazos conocidos y los reintentos se revisaron, pero no se garantiza disponibilidad indefinida de la red.

## 13. Decisión pendiente sobre C01

La documentación previa autoriza explícitamente la administración anónima. Cambiarla requiere acordar quién administra y provisionar cuentas; hacerlo solo en los botones rompería la operación existente y dejaría la API expuesta. No se cambiaron permisos de usuarios reales ni se decidió una política nueva por suposición.

La opción recomendada antes de publicar es Supabase Auth con rol administrativo **asignado por servidor**, sesión de administración y control de acceso tanto en RLS como en cada RPC sensible. Implica revocar las escrituras/RPC a `anon`, permitir lectura pública, impedir que cuentas autenticadas sin rol administrativo escriban, proteger rutas de administración y probar expiración, cierre de sesión y cuentas no autorizadas. Deben revisarse también los permisos por columna de equipos, jugadores, jornadas y creación de partidos; proteger solo el reinicio sería insuficiente.

Como alternativa, un backend de confianza puede custodiar esas operaciones y validar los mismos permisos. Mantener deliberadamente las escrituras públicas deja C01 abierto; una clave pública renombrada, una contraseña solo en React o esconder la ruta no lo resuelve.

## 14. Acciones antes del despliegue

1. Resolver C01 con una política administrativa acordada e implementada en servidor y cliente; verificarla con cuentas permitidas y denegadas.
2. Disponer de copia anonimizada autorizada, respaldo y restauración comprobada; reconciliar el historial remoto sin reaplicar migraciones a ciegas.
3. Ensayar 030 corregida y 031 en esa copia, comparar historiales y probar dos sesiones PostgreSQL concurrentes, cortes de red y recuperación.
4. Verificar Realtime real, Auth, móviles/navegadores objetivo y rendimiento con datos representativos.
5. Revisar las diferencias locales y autorizar por separado commit, publicación y migraciones. Ninguna de esas acciones fue ejecutada durante la auditoría.

## 15. Conclusión de preparación

**No listo para producción.** Diez errores confirmados tienen corrección local y pruebas. C01 sigue siendo crítico y permite acceso administrativo sin autenticar. Además, aún falta verificar la migración contra una copia autorizada representativa y la concurrencia real. 030 tiene validaciones y evidencia local de preservación, pero **no se certifica segura para aplicarse a producción en su estado de verificación actual**.

El informe no declara ausencia total de defectos: documenta lo confirmado, lo corregido, lo pendiente y los límites efectivos de las pruebas.
