# ADR-010: Planificación de horarios sin n8n (lectura directa de la planilla y reglas en TS)
Date: 2026-11-07
Status: Accepted (implementación en curso: ver "Despliegue")
Supersede en parte: ADR-008

## 1. Contexto
n8n (servicio en Railway, con su propio Postgres/Redis) corría solo tres workflows: **preview**
(leer la planilla, parsearla y llamar a `snapshot_previsualizar`), **confirmar** (`snapshot_aplicar`)
y **semanal** (domingo 01:00, `generar_semana_desde_snapshot` + mail al admin). Mantener esa
infraestructura costaba mucho para tan poco. Además, el ADR-008 marcaba como deuda técnica que las
reglas de planificación y de licencias sobre turnos vivieran en PL/pgSQL (se probaban a mano con
tests `.sql` y cada cambio era una migración que copiaba la función entera).

## 2. Decisión
El backend lee la planilla directo y toda la lógica pasa a services TS testeados con jest. La API
y la app no cambian.

- **Lectura de la planilla** (`adapters/inputs_outputs/lectorPlanillaGoogle.ts`): cuenta de servicio
  de Google (`GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`), scope
  `spreadsheets.readonly` y un único `GET .../values/{rango}?valueRenderOption=UNFORMATTED_VALUE`.
  **La planilla es solo lectura: el backend nunca la modifica.** La cuenta se comparte con permiso de
  Lector. Variables: `PLANIFICACION_SHEET_ID`, `PLANIFICACION_SHEET_RANGE`,
  `PLANIFICACION_SHEETS_TIMEOUT_MS` (20000). Si falta configuración o Google falla: 503.
- **Parser** (`planillaParser.ts`): el mismo que corría en n8n, portado a TS sin cambios de lógica.
- **Reglas** (`planificacionReglas.ts`, `licenciasTurnosReglas.ts`, `jornada.ts`, `fechaLocal.ts`):
  funciones puras, sin DB. Port 1:1 de las versiones vigentes de `snapshot_validar_payload`,
  `snapshot_calcular_diff`, `snapshot_faltantes_*`, `snapshot_armar_diff_json`,
  `planificacion_marcar_dias_vacios`, `aplicar_licencia` / `revertir_licencia`.
- **Orquestación** (`planificacionServices.ts`, `licenciasTurnosServices.ts`): el service abre la
  transacción (`pool.connect()` + `BEGIN`) y pasa el `PoolClient` a los repos
  (`planificacionRepo.ts`, `licenciasTurnosRepo.ts`). Las escrituras siguen el mismo orden que
  `snapshot_aplicar` / `generar_semana_desde_snapshot`, con el mismo advisory lock (7305101).
  "Ahora" sale siempre de la DB (`planificacion_ahora_ar()`), nunca del reloj del server.
- **Semanal:** `initGeneracionSemanalCron` (`0 1 * * 0`, hora argentina) llama a
  `generarSemanaService()` y, si falló o hay usuarios por debajo del objetivo,
  `notificarResultadoSemanal` manda el mail a `ALERTAS_EMAIL_TO` (mismo texto que el workflow).
  Una sola instancia del backend: `node-cron` alcanza.
- **Hash del snapshot:** sha256 de los turnos y objetivos ordenados (antes md5 del JSON crudo). Único
  efecto: el primer preview posterior al deploy dice `igualAlVigente = false` aunque no cambie nada.

### Helpers SQL que quedan
Se mantienen en la DB porque los usan consultas de agregación (horas trabajadas, sin-marcar, upsert
manual de horarios), donde sacarlos obligaría a traer filas al server:
`planificacion_ahora_ar`, `jornada_corrido_minutos` (migración 078; su regla de 40 h está duplicada
en `jornada.ts`, con comentario cruzado), `planificacion_fin_turno` y `planificacion_minutos_turno`.

### Se mueven al backend
Quedan eliminadas (migración 083) `snapshot_previsualizar`, `snapshot_aplicar`,
`snapshot_calcular_diff`, `snapshot_faltantes_actual`, `snapshot_faltantes_proxima`,
`snapshot_armar_diff_json`, `snapshot_validar_payload`, `generar_semana_desde_snapshot`,
`planificacion_ventana`, `planificacion_marcar_dias_vacios`, `aplicar_licencia`,
`revertir_licencia` y `aplicar_licencias_a_turnos`. Se cierra la deuda técnica del ADR-008.

## 3. Alternativas descartadas
- **Seguir con n8n:** el costo de la instancia no se justifica para tres workflows.
- **Que n8n llame a endpoints del backend:** mantiene la infraestructura que se quiere apagar.
- **Leer la planilla con Apps Script / webhook propio:** agrega un componente más fuera del repo.
- **Dejar las reglas en PL/pgSQL:** deuda técnica documentada; tests manuales y migraciones por cada cambio.
- **Scheduler externo (Railway cron, pg_cron):** innecesario con una sola instancia; `node-cron` ya se usa para el resto.

## 4. Despliegue / cutover
1. Cargar en Railway y en `.env` local: `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`,
   `PLANIFICACION_SHEET_ID`, `PLANIFICACION_SHEET_RANGE`, `ALERTAS_EMAIL_TO`. Compartir la planilla
   con la cuenta de servicio como Lector.
2. Desplegar el backend. Las funciones SQL todavía existen (no se usan).
3. Probar preview y confirmar desde la app. **Desactivar el workflow semanal en n8n antes del
   domingo 01:00** (si no, ambos generan la misma semana; es idempotente, pero llegarían dos mails).
4. Tras el primer domingo correcto: aplicar la migración `083` (después del deploy, no antes), borrar
   las variables `N8N_*` y apagar el servicio de n8n (y su Postgres/Redis). `DROP ROLE
   n8n_planificacion` se hace a mano, según el entorno.
