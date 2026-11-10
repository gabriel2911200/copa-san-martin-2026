# Validación funcional final — Copa San Martín 2026

Fecha: 9 de noviembre de 2026. Alcance: código local, sin publicación ni conexión a la base real.

## 1. Funcionalidades verificadas

| Módulo | Cobertura funcional |
|---|---|
| Competición | Categorías, jornadas, registro de equipos y jugadores, partidos, clasificación regular, confirmación del cierre, semifinales, final, tercer puesto y podio. El modelo existente representa una competición; no ofrece creación de múltiples campeonatos independientes. |
| Agenda y control | Programación, reprogramación, duraciones, periodos, pausa, reanudación, tiempo muerto, marcador, goles, autogoles, tarjetas, resultados e historial. |
| Amistosos | Selección manual y aleatoria, equipos de la misma categoría, duración propia, agenda, control, resultados, penales opcionales e historial separado. Exclusión de clasificación y goleadores oficiales. |
| Duraciones | Altas y eliminación del catálogo personalizado, selección compartida, duración exclusiva del encuentro, persistencia y actualización al volver a la ventana. Eliminar una opción no altera encuentros existentes. |
| Penales | Tres/cinco tiros iniciales, cierre automático, cierre manual anticipado 3–2 tras tres tiros por equipo, muerte súbita, corrección, persistencia, casillas pendientes y presentación compacta. |
| Dorsales | Alta y edición, dorsal cero, listas automáticas, cancelación, duplicados, errores recuperables y conservación del dorsal histórico del evento. |
| Reapertura | Confirmación, condiciones del acceso existente, restauración en pausa y conservación de eventos/tandas; rechazo de operaciones incompatibles con resultados dependientes. |
| Interfaz | Rutas, formularios, botones, modales, foco, scroll, avisos, cronómetros y marcadores en tamaños móviles y de escritorio simulados, incluida ausencia de desbordamiento en los escenarios responsive. |

La simulación de campeonato llega desde equipos/jugadores y fase regular hasta eliminatorias, tandas, clasificación, goleadores y podio. Las suites complementarias cubren amistosos, reapertura, duración personalizada, agenda, recarga y recuperación de errores. Son escenarios distribuidos entre SQL, integración y navegador; no se presenta como una única sesión de navegador conectada al servicio remoto.

## 2. Errores encontrados

No se confirmó un nuevo defecto funcional del producto. Las dos correcciones de 032 —agenda conservada tras confirmación con lectura fallida y actualización del catálogo al recuperar foco/conexión— siguen incluidas en las pruebas de regresión.

Se detectó una interferencia de la infraestructura local: la extracción de herramientas PostgreSQL dentro de `.tools` provocó un fallo del servidor Vite al vigilar archivos auxiliares. Una ejecución posterior obtuvo 118 escenarios aprobados y un timeout de 30 segundos en la navegación de rutas a 320 px mientras se preparaban pruebas nativas. Esos intentos no se cuentan como una suite aprobada.

## 3. Correcciones realizadas

Se limitó el escaneo de dependencias de Vite de pruebas a `index.html` y se excluyeron herramientas/bases temporales de su vigilancia. El ajuste corresponde exclusivamente al entorno aislado de navegador.

Se añadió un ejecutor de PostgreSQL nativo con protección de destino: comprueba el directorio del clúster local antes de escribir, crea una base ficticia nueva en cada ensayo y utiliza únicamente `127.0.0.1`. No cambia funciones del producto ni accesos existentes. Los roles utilizados en el clúster desechable reproducen los que necesita el esquema de pruebas.

## 4. Archivos modificados en esta validación

- `tests/postgres-final-validation.mjs`: migraciones nativas, histórico ficticio, cuatro suites SQL recientes, concurrencia entre conexiones independientes y verificación después de reiniciar PostgreSQL.
- `tests/vite.isolated.config.ts`: exclusión de archivos temporales del entorno de pruebas.
- `docs/033-validacion-funcional-final.md`: este informe.

Los cambios de implementación y de revisiones anteriores ya estaban presentes al comenzar. No se alteraron durante esta validación. Herramientas, clúster y evidencia auxiliar quedan en `.tools`, excluido de Git; el servidor desechable se detiene al finalizar.

## 5. Resultados de pruebas

| Ejecución realizada | Resultado |
|---|---|
| `npm.cmd test` | **23/23 aprobadas**. |
| `node node_modules/@playwright/test/cli.js test --config playwright.isolated.config.ts --workers=2` | **119/119 aprobados**, ejecución completa final sin reintentos automáticos, 3,7 minutos. |
| `node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js` | **29/29 suites SQL aprobadas**, comparaciones de históricos y comprobación adicional de solicitudes solapadas. |
| `node tests/playoffs-simulation.mjs` | **Aprobada**: competición completa; 97 rechazos de acciones inválidas verificados como aserciones internas. |
| `node tests/historical-attribution.mjs` | **Aprobada**: cinco eventos, resultado 4–1 y cuatro fichas conservados; reintento sin duplicación. |
| `node tests/migration030-preflight.mjs` | **Aprobada**: duplicados sintéticos detienen 030 sin modificar datos/esquema anteriores. |
| `node tests/postgres-final-validation.mjs .tools/pg033-full/pgsql/bin/psql.exe 55433` | **Aprobada en PostgreSQL 17.6 nativo**: esquema y migraciones 001–031, histórico ficticio, cuatro suites SQL recientes y cuatro escenarios concurrentes. |
| Mismo ejecutor con `--verify-persistence`, después de reiniciar el servidor local | **Aprobado**: partido finalizado, gol, tres dorsales y un penal conservados. |
| `npm.cmd run lint` | **Aprobado**. |
| `npm.cmd run build` | **Aprobado**, TypeScript y Vite. Aviso existente no bloqueante: JavaScript 547,37 kB, 155,86 kB gzip, superior al umbral de 500 kB. |

La ejecución completa final de navegador pasó tras aislar el escaneo de Vite, incluyendo los recorridos a 320 y 1280 px. Un intento intermedio de arranque se canceló durante el diagnóstico; tampoco se cuenta como aprobado. Los errores `spawn EPERM` iniciales corresponden al aislamiento del sistema operativo; las pruebas afectadas se repitieron con autorización de ejecución de procesos. Se conservan los recuentos por tipo, sin sumar aserciones internas como pruebas independientes. La evidencia nativa se guarda en `.tools/033-native-validation.json` para evitar la limpieza de `test-results` por Playwright.

## 6. Estado de las migraciones 030 y 031

Orden comprobado: esquema base, migraciones numeradas 001–029, `030_flexible_matches.sql` y después `031_audit_integrity.sql`. 030 utiliza las convocatorias y dorsales de 014, controles/eventos posteriores, tandas de 025–027, duración de 028 y reinicio de 029. 031 reemplaza funciones sobre las estructuras anteriores y reconoce el tipo FRIENDLY introducido por 030; no debe anteponerse a ella.

Ambas se aplicaron conjuntamente en PGlite y en PostgreSQL 17.6 real aislado. Las cuatro suites recientes ejecutadas también en el servidor nativo son `030_flexible_matches`, `030_three_penalties`, `030_reopen_playoffs` y `031_audit_integrity`. Verifican lecturas, guardados, actualizaciones, amistosos, duraciones, reapertura, penales y restricciones de resultados dependientes. No se detectaron incompatibilidades.

Las comparaciones PGlite antes/después preservan partidos, eventos, jugadores, convocatorias, tandas, tiros, equipos, categorías y jornadas, descontando únicamente columnas nuevas con valores predeterminados. En PostgreSQL nativo se compararon también los objetos históricos antes/después de cada migración, con un partido finalizado, un gol y jugadores/dorsales ficticios no vacíos. Las funciones de borrado/reinicio definidas por 031 no se ejecutan al aplicar la migración.

No se utilizó una copia autorizada representativa de producción: no había una identificada para este trabajo. La conservación comprobada corresponde a fixtures locales; no certifica los registros exactos ni el historial de migraciones del servicio real. No se aplicaron migraciones remotas.

## 7. Integraciones verificadas

En PostgreSQL nativo, cada operación usa un proceso `psql` independiente. El ensayo observa en `pg_stat_activity` que la primera sesión mantiene la transacción y la segunda espera un bloqueo, antes de comprobar el resultado:

1. Dos asignaciones del dorsal 8 con la misma versión: una aceptada, otra rechazada con error controlado P0001; una sola asignación. Inserción duplicada directa rechazada por UNIQUE 23505.
2. Dos inicios con la misma versión: una transición aceptada y otra rechazada por versión desactualizada.
3. Dos envíos del mismo gol/UUID: reintento idempotente, un evento y marcador 1–0.
4. Dos envíos del mismo penal/UUID/revisión: reintento idempotente, un tiro y revisión 1.

Se verificaron lecturas desde sesiones nuevas y persistencia después de reiniciar el servidor. Esto amplía la cobertura de 032: ya hay evidencia de concurrencia entre conexiones PostgreSQL reales, además de PGlite.

El navegador usa una API local de lectura y respuestas controladas para escrituras, errores, pérdida de respuesta, reconexión, cambios entre pantallas y notificaciones. Las integraciones Auth/Realtime existentes se comprueban funcionalmente mediante simulación de sus respuestas/eventos; no mediante cuentas ni canales remotos reales. Se mantuvieron sin cambios el acceso, los permisos y las credenciales de la aplicación.

## 8. Limitaciones del entorno

- No se ensayó sobre una copia autorizada de la base real.
- No se ejecutó una sesión completa de interfaz con escrituras contra Supabase real o una réplica completa de sus servicios.
- No se comprobó entrega real de Realtime, renovación de sesión Auth ni desconexión física de red entre dispositivos.
- Navegador Microsoft Edge con viewport simulado; pendientes dispositivos físicos y otros motores, incluido Safari/iOS.
- Las cuatro carreras nativas cubren los casos descritos; no equivalen a una prueba de carga ni a todas las combinaciones simultáneas posibles.

## 9. Problemas funcionales pendientes

No se confirmó un defecto nuevo del producto en las pruebas completadas. Las verificaciones remotas, copia representativa y dispositivos físicos indicadas arriba quedan pendientes y no se cuentan como aprobadas. La creación de múltiples campeonatos independientes no existe en el alcance actual ni se añadió.

## 10. Preparación funcional para publicar

Las migraciones 030 y 031 funcionan conjuntamente en los entornos aislados probados; los históricos de prueba se conservaron y las cuatro operaciones concurrentes verificadas no perdieron ni duplicaron información.

**El código local está funcionalmente preparado para publicar dentro del alcance comprobado:** 23 pruebas unitarias, 119 escenarios de navegador, 29 suites SQL, tres integraciones adicionales, cuatro suites recientes también en PostgreSQL nativo, cuatro carreras reales, persistencia tras reinicio, lint y compilación aprobados. No hay un defecto funcional confirmado pendiente en ese alcance.

Quedan pendientes las verificaciones con copia autorizada, Auth/Realtime remotos y dispositivos físicos. Por ello, este resultado no certifica el entorno de destino ni sustituye su comprobación previa a publicar. La publicación y la aplicación de migraciones reales requieren una acción posterior autorizada. Este trabajo no realizó auditorías de seguridad, cambios de acceso, despliegues, commits, push ni operaciones sobre datos reales.

Respuestas finales: las funcionalidades existentes solicitadas funcionan en los escenarios probados; no se encontraron errores nuevos del producto que requirieran corrección; se corrigió la interferencia del entorno de pruebas; 030 y 031 funcionan juntas; se preservaron los históricos ficticios; las pruebas externas enumeradas siguen pendientes; la preparación funcional local es satisfactoria con esas limitaciones.
