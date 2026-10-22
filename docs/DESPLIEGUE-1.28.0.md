# Guía de despliegue 1.28.0 — Presupuestos inteligentes (NO ejecutada)

Depende de la rama `fix/auditoria-20261022` (PR #46, v1.27.0). Fusionar primero esa.

## 1. Respaldar
- Hoja de cálculo: Archivo → Hacer una copia (nombre con fecha).
- Copiar el `Code.gs` actual del proyecto de Apps Script.
- Anotar el estado de producción esperado: General 3000 · Aporte Pareja 200 · Sodexo 280 · Carpeta Tésis 1900 · Viaje a Ica 1414 = **6794**. Aporte Pareja **se mantiene en S/ 200** (no pasa a 400).

## 2. Verificar esquema (sin escribir)
- Nada se migra solo. `GASTOS` no cambia. Las hojas nuevas (`ASIGNACIONES_GASTOS`) y la columna 15 «Reglas» de `FONDOS_PRESUPUESTO` se crean al primer uso o con `repararHojas`.
- Los fondos antiguos se leen con reglas derivadas (`reglasLegado`): mismo comportamiento que en 1.27 hasta que los edites.

## 3. Publicar backend
Pegar `apps-script/Code.gs` (1.28.0), guardar y «Nueva versión» de la misma implementación. La web 1.27 sigue funcionando (el backend devuelve `cajas: []`, `presupuestos: []`).

## 4. Retirar Cajas (migración, con aprobación)
Desde Configuración → Funciones del backend → «Retirar cajas (migración 1.28)»:
1. **Simular** (por defecto): lista cajas, subcajas y presupuestos antiguos y qué haría. No escribe.
2. Revisar. Marcar «Ya revisé la simulación y tengo el respaldo» y **Aplicar**: crea respaldo y solo **renombra como archivo** `CAJAS` y `PRESUPUESTOS`. No borra datos ni gastos.
Las subcajas **no** se convierten en fondos (no se inventa presupuesto): crea los fondos que quieras en Presupuestos.

## 5. Publicar frontend
Build de Netlify desde `develop` tras fusionar. Solo después del paso 3.

## 6. Validar
- Configuración muestra 1.28.0 (web y backend).
- Pestaña **Presupuestos**; `#cajas` redirige a ella.
- Crear fondo con medio/cobertura; vista previa correcta.
- Registrar un gasto con un medio restringido para su categoría: se bloquea con el mensaje del medio.
- Gasto que agota un fondo: excedente → General, con etiqueta y aviso.
- Asignación manual → «Restaurar asignación automática».
- Total de octubre = 6794 con los fondos de producción.

## 7. Logs
Apps Script → Ejecuciones: sin errores `VALIDATION`/`INTERNAL` inesperados durante una semana.

## 8. Rollback
- Web: Netlify «Publish deploy» del despliegue anterior.
- Backend: reimplementar el `Code.gs` guardado.
- Si se aplicó `retirarCajas`: renombrar de vuelta las hojas archivadas (o restaurar la copia del paso 1). Las asignaciones manuales viven en `ASIGNACIONES_GASTOS` (se ignora en 1.27).
