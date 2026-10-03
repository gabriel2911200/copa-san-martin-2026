# Producción: migraciones 028 y 029 aplicadas

Proyecto verificado: `kxoihaxxxddykziabmoq` (`copa san martin 2026`).

Se aplicaron en orden `028_match_duration.sql` y `029_protected_tournament_reset.sql` (la versión anónima, sin login). Cada migración se ejecutó en una transacción con bloqueos y comparación de todas las columnas anteriores de las 13 tablas públicas antes de confirmar. Ambas quedaron registradas en `supabase_migrations.schema_migrations`. No se reaplicaron migraciones anteriores ni se ejecutó `reset_tournament()`.

La verificación posterior comparó también las huellas de producción con un respaldo nuevo: se conservaron 17 equipos, 145 jugadores, 35 partidos, 230 eventos, 182 convocatorias, 19 controles previos, 26 contadores de faltas, 2 categorías y 6 jornadas. Los 31 partidos regulares finalizados y las 4 semifinales programadas permanecen intactos. Las tablas de penales y saldos iniciales continúan vacías. Los 35 partidos tienen duración 900. El estado del reinicio mantiene `last_request_id = NULL`; no existe tabla de administradores.

Respaldo local, excluido de Git: `.tools/backups/pre-028-029/production.dump`, 233202 bytes. SHA256: `217DCC7A77455B6DD35D8B8D81A31AC487A398EE2202B8E25A46838CEDFCA5DE`. Incluye esquema y datos de `public` y `supabase_migrations`. Su restauración y ambas migraciones fueron ensayadas en PostgreSQL efímero antes de modificar producción. `restore.sql` y `baseline.json` acompañan el respaldo. No es una copia integral de servicios externos o Storage.

Validación previa a publicar el frontend: TypeScript/build, lint, 20 pruebas unitarias, suite SQL completa hasta 029, simulación deportiva con 97 acciones inválidas rechazadas y 51 pruebas de navegador aprobadas. Las pruebas mutantes usan exclusivamente bases efímeras. Se conserva el aviso no bloqueante del bundle mayor a 500 kB.

Publicación del frontend mediante el repositorio existente `gabriel2911200/copa-san-martin-2026`, rama `main`, vinculado al proyecto Vercel `salas3/copa-san-martin-2026`. Dominio: `https://copa-san-martin-2026.vercel.app/`. No se requieren nuevas variables ni otro proyecto. El resultado del despliegue debe comprobarse contra el commit publicado y `/version.json`; este documento registra el estado de la base y las pruebas anteriores al envío del commit.
