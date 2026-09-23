# Inicio y control de penales — 027

El control del partido abre automáticamente la tanda al cumplirse los 15 minutos del segundo tiempo de una semifinal, final o tercer puesto empatado, sin W.O. ni ganador. No hay selector ni modal inicial.

Cada equipo muestra cinco casillas y sus acciones ✓ GOL / ✕ ERRÓ. Tras confirmar la apertura se habilitan las cuatro acciones. El primer tiro válido, convertido o fallado, determina quién comenzó; desde entonces solo está habilitado el equipo al que corresponde ejecutar.

## Persistencia y protección

La migración local `027_first_penalty_starts_order.sql` añade `open_penalty_shootout`, permite un equipo inicial nulo mientras no hay tiros y retira el permiso público de la antigua selección previa. No modifica 024–026 ni reinicia tandas existentes.

La apertura bloquea el partido y pausa el reloj. Reabrir una tanda existente devuelve su estado sin modificar orden, tiros ni revisiones.

El primer registro bloquea partido y tanda, comprueba equipo y revisión, asigna el equipo inicial y llama al motor de 026 dentro de la misma transacción. Si el tiro falla la validación, la asignación se revierte. La revisión rechaza solicitudes simultáneas obsoletas; el UUID permite reintentar una respuesta perdida sin duplicar tiros. SQL sigue imponiendo la alternancia.

Anular el único tiro registrado conserva quién comenzó y devuelve el turno a ese equipo. Las correcciones siguen usando su modal existente.

Se conserva el motor de cinco tiros, corte anticipado, rondas adicionales, ganador y cruces automáticos, historial, Realtime, W.O. y separación de categorías, goles y jugadores.

## Verificación local

- Compilación y lint.
- 19 pruebas unitarias.
- Pruebas de navegador aisladas: cuatro primeros tiros posibles (cada equipo, gol o fallo), apertura directa en las tres fases, bloqueo alternado, correcciones, respuesta perdida, vistas públicas y anchuras de 320 a 1280 px.
- Suite SQL 001–027 sobre PostgreSQL en memoria, con fixtures de preservación histórica.
- Prueba SQL 027: reversión de un primer tiro inválido, repetición idempotente, revisión obsoleta, doble tiro rechazado, reapertura y anulación del primer tiro.
- Simulación integral de campeonato con semifinal y final por penales, generaciones automáticas y categorías independientes.

La base de pruebas es efímera. No se ha aplicado 027 a una base persistente ni remota, no se ha realizado deploy y no se ha modificado `.env.local`. La aplicación conectada a una base persistente necesita 027 para usar este nuevo RPC.
