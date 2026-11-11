# Siete correcciones — Copa San Martín

10 de noviembre de 2026. Repositorio, dominio y proyecto Supabase conservados.

- Duración exclusivamente en Controlar partido: selector guindo compacto y menú adyacente; catálogo compartido y duración propia conservados. Los partidos iniciados o reabiertos mantienen su duración bloqueada.
- Reapertura desde Calendario, junto a las opciones administrativas, mediante el cliente administrativo existente y confirmación sin correo ni contraseña. Se mantienen las restricciones de W.O., clasificación cerrada y resultados con cruces dependientes.
- Amistosos creados manualmente con categoría, equipos, fecha y hora; comienzan con 15 minutos y sin configuración anticipada de penales. Los reintentos anteriores conservan sus identificadores y argumentos originales.
- Penales en Controlar: abrir el panel no escribe ni inicia una tanda. El inicio es explícito y conserva las condiciones reglamentarias, tres/cinco tiros, cierre manual, cierre automático y correcciones existentes.
- Confirmaciones de periodos con botones horizontales de igual ancho y alto.
- Amistosos integrados en En vivo y Calendario para todos sus estados, identificados como AMISTOSO, con control, eliminación confirmada y reapertura al finalizar. Clasificación y goleadores oficiales mantienen sus filtros independientes.
- Identidad permanente Copa San Martín, sin año fijo en encabezado, inicio ni título de pestaña. Fechas históricas e identificadores técnicos intactos; el logo existente no contiene año.

## Migración necesaria

`032_calendar_match_controls.sql` amplía la lectura compartida a los amistosos, permite la reapertura solicitada con el cliente administrativo actual y habilita penales en amistosos mediante la acción explícita del controlador. El actor de auditoría admite NULL cuando no hay una sesión de cuenta: no se inventa una identidad. No se agregan cuentas ni mecanismos de autenticación.

La aplicación de 032 no ejecuta reaperturas, borrados, reinicios ni actualizaciones de partidos. El procedimiento de publicación usa una transacción con bloqueo limitado y compara todas las filas y columnas preexistentes de public/private antes de confirmar. El respaldo existente mantiene su SHA-256 registrado; 030 y 031 no se reaplican.

## Verificación

- 23 pruebas unitarias aprobadas.
- 128 escenarios de navegador aprobados en ejecución completa final, incluidos diez nuevos; móvil y escritorio, reapertura sin Auth, botones iguales, amistosos compartidos y penales sin inicio automático.
- 30 suites SQL aprobadas. Los escenarios históricos 030/031 se ejecutan en su frontera de migración, antes del comportamiento solicitado en 032.
- Nueva suite 032 aprobada también en PostgreSQL 17.6 nativo aislado, con datos ficticios: reloj, duración, eventos, planillas, reapertura repetida, penales 3–2 y aislamiento estadístico.
- Simulación completa hasta el podio aprobada con 001–032 y 97 rechazos de acciones inválidas.
- Lint y compilación aprobados. Permanece el aviso de tamaño de paquete JavaScript superior a 500 kB.

Las comprobaciones de producción se limitan a lecturas y navegación, bloqueando escrituras durante la verificación del despliegue. Los ensayos de altas, eliminación y reapertura utilizan únicamente fixtures aislados.
