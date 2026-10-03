# Revisión previa de producción hasta 027

Fecha de revisión: 22 de septiembre de 2026. Estado: detenido antes de aplicar migraciones o desplegar.

1. **Estado inicial:** proyecto Supabase vinculado `kxoihaxxxddykziabmoq`, nombre `copa san martin 2026`, organización `pmxxuzlqqetzblasgall`. La navegación de la web publicada confirmó solicitudes a kxoihaxxxddykziabmoq.supabase.co. Las variables internas de Vercel no se consultaron.
2. **Historial remoto registrado:** 012, 013, 014, 015, 016, 017, 020, 021, 022 y 023.
3. **Migraciones pendientes/diferencias:** 024–027 no están registradas. Tampoco 001–011, 018 y 019. Existen objetos de etapas antiguas, por lo que las ausencias de historial no justifican reaplicar todo. La ausencia de 019 sí es real: no existen `player_initial_goals` ni `import_initial_players`; `get_top_scorers` conserva una definición anterior. `void_match_event` también conserva la restricción anterior a 018 que impide anular eventos finalizados.
4. **Respaldo/restauración:** `supabase backups list` devolvió `backups: []`, `pitr_enabled: false`, `walg_enabled: true` y `physical_backup_data: {}`. No se ha verificado un respaldo restaurable ni creado un dump. WALG habilitado por sí solo no demuestra una vía utilizable de restauración.
5. **SQL aplicado:** ninguno. Solo consultas de lectura del historial y catálogos/recuentos. No se ejecutó `db push`, reparación del historial, reset, ni SQL de prueba con escrituras.
6. **024:** revisada localmente; columna W.O. y RPC ausentes remotamente; no aplicada. Contiene las correcciones acumuladas de eventos y conserva goles separados del resultado W.O.
7. **025:** revisada localmente; tablas de tandas ausentes; no aplicada. Envuelve el snapshot de 024 y añade protecciones, auditoría, revisión e idempotencia.
8. **026:** revisada localmente; no aplicada. Conserva el motor anterior para resultados históricos y redefine el motor vigente. Su reconciliación puede generar cruces de semifinales resueltas. En la consulta actual no hay eliminatorias: los 24 partidos son regulares finalizados.
9. **027:** revisada localmente; no aplicada. Añade apertura sin equipo inicial y delega en 026 el registro de tiros, con asignación atómica del primer equipo y alternancia. No se modificó ninguna migración 001–027.
10. **Datos existentes:** lectura confirmó 2 categorías, 17 equipos, 145 jugadores, 24 partidos, 182 eventos y 143 filas de convocatorias. No se realizaron escrituras sobre estos datos. Estos recuentos son inventario, no un respaldo ni una comparación criptográfica antes/después de un despliegue.
11. **Build:** no se repitió en esta fase; el usuario exige hacerlo después de preparar la base. La verificación local de la tarea anterior había aprobado.
12. **Lint:** igual que build; no se repitió en esta fase.
13. **Pruebas:** esta revisión efectuó consultas remotas de solo lectura. No creó goles, penales, W.O., partidos ni cierres. Las 19 pruebas unitarias, 81 escenarios de navegador y suites SQL/simulación aprobadas corresponden a la tarea local anterior, no a una verificación de producción actualizada.
14. **Despliegue frontend:** no realizado. Existe `vercel.json` para Vite, build `npm run build`, salida `dist` y reescritura SPA a `index.html`; no existe `.vercel/project.json` ni se encontró configuración CLI de Vercel en las ubicaciones consultadas. GitHub CLI no tiene sesión disponible.
15. **Dominio de producción:** https://copa-san-martin-2026.vercel.app, proporcionado por el usuario y verificado. Sigue sin identificarse el equipo/ID interno de Vercel.
16. **Inicio:** ruta directa HTTP 200, contenido cargado, sin alertas, errores JavaScript/HTTP ni desbordamiento horizontal a 390 y 1280 px.
17. **Calendario:** ruta directa HTTP 200, contenido cargado, sin alertas, errores JavaScript/HTTP ni desbordamiento horizontal a 390 y 1280 px.
18. **Tablas:** ruta directa HTTP 200, contenido cargado, sin alertas, errores JavaScript/HTTP ni desbordamiento horizontal a 390 y 1280 px.
19. **Goleadores:** ruta directa HTTP 200 y contenido cargado a 390 y 1280 px, sin errores observados. Sigue usando la definición SQL antigua identificada.
20. **Admin:** /admin redirige correctamente a /admin/controlar; /admin/equipos y /admin/calendario cargan con HTTP 200, sin errores observados ni desbordamiento a 390 y 1280 px. No se abrió control de partidos reales.
21. **Errores/bloqueos:** discrepancia real de esquema anterior a 024; historial incompleto; restauración no verificada; ID/equipo y commit del despliegue Vercel no identificados. La primera consulta CLI fue bloqueada por permisos de telemetría del sandbox y se completó al ejecutarla con permiso ampliado.
22. **No verificado:** configuración interna de Vercel, commit publicado, rollback de frontend, restauración de base y esquema 027 remoto. La versión publicada actual sí pasó 14 visitas de solo lectura (7 rutas × 2 anchuras), sin errores JavaScript/HTTP, alertas ni intentos de escritura. No son pruebas posteriores a un deploy. Evidencia local: .tools/production-readonly-result.json. La comprobación responsive mide desbordamiento horizontal; no sustituye una revisión visual exhaustiva.
23. **Commit:** HEAD local `1d8f816147602792a514c5a0b72b615286874135`, rama `main`, con cambios acumulados sin commit. No es una identificación del commit desplegado. Remoto Git: `https://github.com/gabriel2911200/copa-san-martin-2026.git`.
24. **Estado final:** no se puede confirmar producción compatible hasta 027; no se migró ni desplegó. El siguiente paso requiere resolver explícitamente la discrepancia de 018/019, disponer de un respaldo restaurable e identificar/acceder al proyecto Vercel existente. No debe reaplicarse 001–023 a ciegas ni modificarse 001–027 para ocultar la discrepancia.

La pausa sigue la instrucción del usuario de detenerse ante una incompatibilidad importante. No se modificó `.env.local`, el dominio ni datos del campeonato.
