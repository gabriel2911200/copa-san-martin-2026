# Producción: esquema hasta 027 aplicado; frontend pendiente

Intervención iniciada el 22 y completada en base de datos el 23 de septiembre de 2026.

Supabase: `kxoihaxxxddykziabmoq`. Dominio existente: `https://copa-san-martin-2026.vercel.app/`.

## Respaldo y conservación

Respaldo local: `.tools/backups/production-kxoihaxxxddykziabmoq-20260922/` (carpeta ignorada por Git).

- `production.dump`: 161372 bytes, formato pg_dump; esquema y datos de `public` y `supabase_migrations`.
- `restore.sql`: 347042 bytes; `schema.sql`: 94759 bytes.
- Configuración Realtime exportada aparte; README con alcance/restauración y SHA256.json con huellas.
- Restauración ensayada en PostgreSQL aislado. No se restauró producción.
- Comprobación final remota: todas las filas originales coinciden con el respaldo, comparando los campos anteriores a las nuevas columnas. Se conservaron 17 equipos, 145 jugadores, 24 partidos, 182 eventos, 143 convocatorias, 15 controles previos, 19 contadores de faltas, 6 jornadas y 2 categorías.

## Aplicación

La reconciliación específica de 018 tomó su protección de anulaciones y conservó las ramas de autogoles de 022 y edición de jugador de 023 existentes. Se reemplazó la función antigua `void_match_event`. Para 019 se confirmó la ausencia de tabla/RPC y se añadieron su tabla vacía, importación administrativa, permisos, Realtime y consulta de goleadores. No se importaron jugadores ni saldos.

Después se aplicaron 024, 025, 026 y 027, una transacción por migración. Cada transacción bloqueó las tablas durante la operación y comparó las huellas de las filas/columnas originales antes de confirmar. Cada paso pasó una verificación independiente de solo lectura antes del siguiente. Se registró el historial 018–019 y 024–027; las entradas antiguas ausentes 001–011 no se inventaron ni repararon.

No se editaron migraciones fuente 001–027. No se ejecutó db reset, no se eliminaron datos, no se crearon partidos, tandas, goles ni W.O. ficticios en producción. No se cerraron fases. Las tres tablas de penales siguen vacías.

La copia restaurada pasó la secuencia completa y las pruebas SQL del primer lanzamiento. En producción se compararon las definiciones de todas las funciones públicas, sus propiedades de ejecución, los permisos de los RPC nuevos, el historial, Realtime, RLS, índice y trigger de generación automática. Los RPC de lectura respondieron con rol anon para las dos categorías y los 24 partidos. No se probaron operaciones mutantes sobre partidos reales.

## Frontend

Build y lint aprobados después de migrar; 19 pruebas unitarias aprobadas y simulación completa aprobada con 97 acciones inválidas rechazadas. Build conserva el aviso de bundle superior a 500 kB.

No se realizó deploy: no existe `.vercel/project.json`, no hay CLI Vercel disponible ni se encontraron sesión/token en las ubicaciones y variables consultadas. Debe iniciarse sesión con acceso al equipo propietario y vincular esta carpeta al proyecto existente que sirve el dominio indicado, sin crear otro proyecto. No hubo cambio de dominio ni de `.env.local`.

No se verificó una nueva versión publicada porque todavía no existe ese despliegue. El informe `production-preflight-027.md` documenta la verificación de la versión anterior y el estado previo a esta intervención.
