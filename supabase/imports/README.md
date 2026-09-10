# Carga inicial preparada

Aplicar primero las migraciones pendientes, en orden hasta 019. No ejecutar de nuevo las ya aplicadas. La carga se realiza con privilegios administrativos; no está expuesta al rol público de la aplicación.

Preparar un JSON con una fila por jugador, usando los UUID reales de equipos existentes:

```json
[
  {"team_id":"UUID_DEL_EQUIPO","player_name":"Nombre completo"},
  {"team_id":"UUID_DEL_EQUIPO","player_name":"Otro jugador","goals":3}
]
```

No incluir dorsales: se asignan exclusivamente en la convocatoria del partido. Un jugador conserva su equipo; el importador no renombra, mueve ni reactiva registros existentes. Reutiliza jugadores del mismo equipo comparando nombres sin distinguir mayúsculas y normalizando espacios. Si hay homónimos existentes exige `player_id`. Revisar previamente variantes ortográficas: no es posible identificar con seguridad que dos nombres distintos sean la misma persona.

`goals` es el saldo histórico **no representado ya en goles válidos de match_events**. Omitirlo para cargar solo plantilla. Si se dispone de un total histórico que ya incluye goles registrados, descontar esos goles antes de preparar el saldo. No se crean eventos ficticios, tiempos, partidos ni cambios de marcador o clasificación. Goleadores suma este saldo a los eventos válidos de cada jugador, incluso si está inactivo.

Ejecutar desde SQL administrativo, después de revisar el JSON:

```sql
begin;
select public.import_initial_players(
  '[]'::jsonb, -- sustituir por las filas revisadas; la plantilla vacía no carga nada
  'Planilla inicial revisada: fecha y referencia'
);
commit;
```

Repetir la misma carga no duplica jugadores ni goles. Un saldo diferente para el mismo jugador se rechaza y revierte toda la llamada; no se sobrescribe automáticamente el historial. La fuente original queda registrada. No se incluyeron nombres ni cifras inventados, ni se ejecutó esta carga en Supabase.
