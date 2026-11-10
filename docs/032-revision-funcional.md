# Revisión funcional — Copa San Martín 2026

Fecha de cierre: 9 de noviembre de 2026.

## 1. Alcance y resultado

Se revisó el funcionamiento existente y las modificaciones descritas en los informes 030 y 031. Esta revisión se limita a funcionamiento, estabilidad, persistencia, sincronización y compatibilidad entre módulos.

**Se encontraron dos errores funcionales nuevos y se corrigieron ambos.** No se contabilizan nuevamente los errores corregidos durante trabajos anteriores. No se modificaron la arquitectura de acceso, autenticación, contraseñas, roles, permisos, credenciales ni dependencias. Tampoco se realizaron despliegues, migraciones en producción, commits o push.

El resultado se refiere al código local y a los entornos aislados utilizados. No es una afirmación de ausencia universal de errores ni una comprobación de la versión actualmente publicada.

## 2. Funcionalidades revisadas

| Funcionalidad | Verificación realizada |
|---|---|
| Organización de la competición | Flujo existente de categorías, jornadas, creación de partidos, clasificación, semifinales, final y tercer puesto; simulación hasta el podio. El modelo representa una competición con categorías, no un gestor de múltiples campeonatos independientes. |
| Equipos y jugadores | Alta, edición, baja lógica, activación/desactivación y conservación de identificadores e historiales. |
| Dorsales | Añadir/Editar según la convocatoria persistida; 0–99; traslado automático entre listas; cancelación; duplicados dentro del mismo partido/equipo; números iguales entre equipos; edición conservando el dorsal histórico de los eventos. |
| Agenda y calendario | Fecha/hora, reprogramación, control de versiones, borradores durante actualizaciones remotas y recuperación después de un guardado con lectura fallida. |
| Control del partido | Inicio, pausa, reanudación, descanso, segundo tiempo, finalización, confirmaciones y cancelación sin escritura. |
| Cronómetros | Duraciones normales y exclusivas, recarga, reloj en pausa/finalizado, límite de fase y tiempo muerto con reanudación desde los 60 segundos. |
| Goles, tarjetas y faltas | Registro, autogoles, correcciones, reversión, estadísticas por equipo/periodo, expulsión y ausencia de duplicación en reintentos cubiertos. |
| Clasificaciones y eliminatorias | Puntos, GF/GC/DG, clasificación fija, cruces, resultados, podio y rechazo de operaciones incompatibles con resultados dependientes. |
| Goleadores e historial | Goles vigentes, atribución histórica, datos iniciales, categorías y separación de goles de penales y amistosos. |
| Amistosos | Selección manual/aleatoria, equipos distintos, duración, creación, historial, recuperación tras respuesta perdida y exclusión de las posiciones/goleadores oficiales. |
| Catálogo de tiempos | Agregar, eliminar y personalizar; persistencia; actualización al volver a la ventana; conservación de la duración de encuentros que usan una opción eliminada. |
| Penales | Tres/cinco iniciales, cierre manual 3–2 tras seis tiros reales, definición automática, empate, muerte súbita, corrección, anulación, pendientes y ganador. |
| Reapertura | Recuperación del marcador, tiempo, eventos y tiros documentados bajo la modalidad ya implementada, sin modificar los accesos existentes. Se conservan los rechazos previstos para situaciones que requieren revisión de resultados históricos o dependientes. |
| Interfaz | Navegación, formularios, selectores, confirmaciones, foco/scroll de modales, consola y adaptación a anchos de 320, 390, 768 y 1280 px. |

Los casos de creación y administración usan respuestas simuladas o una base efímera. No se registraron equipos, jugadores, partidos o resultados de prueba en el servicio real.

## 3. Errores funcionales encontrados y causas

### F01. La agenda confirmada desaparecía de su editor si fallaba la lectura siguiente

**Reproducción:** programar un partido, recibir confirmación exitosa de `reschedule_match` y provocar un fallo en la consulta posterior de `get_tournament`.

**Resultado anterior:** el editor anunciaba «Agenda guardada», pero vaciaba la fecha y la hora porque descartaba el borrador y volvía a las propiedades antiguas del calendario. Un segundo intento podía además utilizar la versión anterior del partido, pese a que el primer guardado sí había actualizado la base.

**Causa:** `ScheduleEditor` ignoraba el snapshot devuelto por la escritura y dependía completamente de que otra lectura actualizase al componente padre. `useTournament.refresh` conserva los datos anteriores cuando falla la conexión y notifica el error sin lanzar una excepción al editor.

**Corrección:** el editor conserva la fecha, hora y versión confirmadas por la respuesta de la RPC. Una lectura fallida no borra esa confirmación; una edición posterior usa su versión correcta. Si llega una versión más reciente desde otra pantalla, vuelve a mostrarla cuando no hay un borrador pendiente. Se respeta la precisión de microsegundos de `updated_at`, sin confundir versiones diferentes dentro del mismo milisegundo. Los borradores siguen manteniendo su versión original para evitar sobrescribir modificaciones remotas inadvertidamente.

**Evidencia:** antes de la corrección la prueba falló con fecha esperada `2026-11-15` y valor recibido vacío. Después se comprueban dos guardados consecutivos con lecturas fallidas y una actualización remota posterior, conservando la versión correcta en cada escritura.

### F02. El selector conservaba indefinidamente un catálogo de tiempos anterior

**Reproducción:** abrir un encuentro programado, agregar una duración de 25 minutos en otra pantalla y regresar a la ventana inicial.

**Resultado anterior:** el selector no mostraba la nueva opción. También podía conservar opciones eliminadas en otra pantalla hasta recargar toda la página.

**Causa:** el catálogo se cargaba una sola vez mediante una referencia `loaded`. No existía recuperación del catálogo al volver a la ventana o recuperar la conexión.

**Corrección:** el selector vuelve a leer las opciones cuando recupera foco, visibilidad o conexión, mientras está habilitado. Se invalidan respuestas antiguas para que una lectura previa no sobrescriba una modificación más reciente y se retiran los manejadores al desmontar. La actualización del catálogo no ejecuta cambios de duración del partido: si una opción utilizada fue eliminada, el encuentro conserva su valor y lo muestra como duración exclusiva.

**Evidencia:** antes de la corrección la prueba esperaba una opción de 1500 segundos y recibía cero coincidencias. Después aparecen los 25 minutos al regresar a la ventana y, al eliminarlos externamente, el partido sigue guardando sus 1500 segundos.

## 4. Archivos modificados en esta revisión

- `src/ScheduleEditor.tsx`: confirmación local de agenda y versiones posteriores a la escritura.
- `src/DurationSelector.tsx`: recuperación del catálogo y descarte de respuestas antiguas.
- `tests/browser/functional-review.spec.ts`: dos pruebas de regresión nuevas para los errores reproducidos.
- `docs/032-revision-funcional.md`: este informe.

El repositorio ya contenía las modificaciones locales de 030 y 031 al iniciar esta revisión. Se conservaron. No se modificaron las migraciones 030/031, las reglas deportivas ni la configuración de acceso durante este trabajo. No fue necesaria una nueva migración para las dos correcciones.

## 5. Pruebas ejecutadas

| Comprobación | Resultado en esta revisión |
|---|---|
| `npm.cmd test` | **23/23 pruebas unitarias aprobadas.** |
| Reproducción inicial de `functional-review.spec.ts` | **2 fallos reproducidos antes de corregir el código**, correspondientes a F01 y F02. No se contabilizan como aprobados. |
| Regresión dirigida: `functional-review.spec.ts` y `audit.spec.ts` | **10/10 escenarios aprobados** tras las correcciones iniciales. La prueba de agenda se amplió después para verificar microsegundos y una actualización remota, incorporada a la ejecución completa. |
| Navegador completo: Playwright aislado, `--workers=2` | **119/119 escenarios aprobados**, sin reintentos automáticos, en 2,9 minutos. Incluye los dos casos nuevos ampliados, consola, navegación y presentación móvil/escritorio. |
| `node tests/run-sql.mjs .tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js` | **29/29 suites SQL aprobadas**, reconstrucción del esquema y migraciones 001–031, comparación de históricos y prueba adicional de solicitudes solapadas de dorsal. |
| `node tests/playoffs-simulation.mjs` | **Aprobado**: competición completa, aislamiento entre categorías, clasificación, semifinales, final, tercer puesto, penales, goleadores y podio. Verifica también el rechazo de **97 acciones inválidas**; estas aserciones no se cuentan como 97 pruebas independientes. |
| `node tests/historical-attribution.mjs` | **Aprobado**: cinco eventos de un fixture asociado, marcador 4–1 conservado, cuatro fichas y reintento sin duplicación. |
| `node tests/migration030-preflight.mjs` | **Aprobado**: una instalación sintética con dorsales duplicados detiene la migración antes de alterar sus filas o esquema anterior. |
| `npm.cmd run lint` | **Aprobado, sin avisos.** |
| `npm.cmd run build` | **Aprobado:** TypeScript y Vite. Permanece el aviso no bloqueante de paquete JavaScript superior a 500 kB: aproximadamente 547,37 kB, 155,86 kB gzip. |

Los recuentos se presentan por tipo: pruebas unitarias, escenarios de navegador, suites SQL y tres integraciones/simulaciones adicionales. No se suman las aserciones internas de cada suite como si fueran pruebas individuales.

## 6. Compatibilidad funcional de 030 y 031

El ejecutor reconstruyó el esquema y aplicó ambas migraciones sobre datos sintéticos e históricos de prueba del repositorio. Las comparaciones antes y después conservaron partidos, jugadores, dorsales, eventos, tandas, tiros, equipos, categorías y jornadas anteriores.

Se verificaron las estructuras necesarias para amistosos y duraciones, las funciones de guardado/lectura, la reapertura y las protecciones de integridad de resultados dependientes. Las correcciones de esta revisión no requieren cambios de esquema y siguen usando las mismas RPC.

El ensayo no utilizó una copia de la base real. No se aplicó ninguna migración en producción ni se modificaron resultados o registros reales.

## 7. Funciones verificadas, corregidas y no probadas

**Corregidas y verificadas:** conservación de la agenda tras un guardado confirmado con lectura fallida; sincronización del catálogo al regresar a la ventana o recuperar la conexión.

**Verificadas mediante las suites existentes:** altas/ediciones y baja lógica de equipos/jugadores; convocatorias y dorsales; confirmaciones; fases y cronómetros; eventos, estadísticas y goleadores; amistosos; penales; resultados históricos; clasificaciones, cruces y podio; navegación, modales y presentación responsive.

**Límites de la verificación:**

- Las pruebas de navegador usan el canal Microsoft Edge y tamaños de pantalla simulados. No certifican dispositivos físicos, Safari/iOS o Firefox.
- La persistencia, las migraciones y el campeonato completo se probaron en base efímera. No se verificó el historial exacto de migraciones o los datos del servicio real.
- Las actualizaciones entre pantallas y los cortes de conexión se simulan en los casos de navegador. No se ensayó Realtime del servicio remoto.
- PGlite serializa consultas. Las solicitudes solapadas y el índice de unicidad se verificaron localmente, pero no se realizó una prueba con dos conexiones PostgreSQL reales independientes.
- La reapertura se prueba con las condiciones de acceso ya existentes en el código. No se utilizaron ni cambiaron cuentas reales para comprobarla contra el servicio remoto.
- No se creó una función de múltiples campeonatos que no existe en la arquitectura actual; se verificó la organización de la competición tal como está implementada.

Estos límites no se presentan como errores funcionales detectados ni como funcionalidades verificadas en producción.

## 8. Estado final y siguiente etapa

**Revisión funcional completada: dos errores encontrados, dos corregidos y ninguno confirmado pendiente en el alcance probado.** Las modificaciones revisadas funcionan en la versión local con el esquema 001–031 y los escenarios descritos. Las pruebas unitarias, de navegador, SQL, las tres integraciones/simulaciones, lint y compilación completaron su ejecución satisfactoriamente.

**La página está funcionalmente lista para continuar con la siguiente etapa de validación**, con los límites indicados en este informe. No se afirma que la versión publicada tenga ya estas correcciones ni que se hayan verificado los dispositivos, las conexiones o los datos reales.

La siguiente etapa funcional es comprobar la misma versión contra una copia autorizada representativa y después validar los flujos con dispositivos y servicio reales, manteniendo los accesos actuales y con autorización separada para cualquier publicación o aplicación de migraciones. Este trabajo no ejecuta esos pasos.
