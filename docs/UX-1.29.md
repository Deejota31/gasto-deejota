# Rediseño UX/UI y optimización — v1.29.0

Rama `develop` → PR a `main`. Backend: `Code.gs` (columna «Datos» de `PLANTILLAS_FINANCIERAS`, ya existente). Sin dependencias nuevas.

## A. Resumen
- **Selectores unificados**: `Combobox` (único) y `MultiSelect` (variantes `filtro` y `campo`) + `Chip` para valores quitables. Los `<select>` nativos (`SelectField`) se eliminaron del proyecto. Menús en portal dentro del `<dialog>`, con auto-flip, búsqueda, teclado (↑ ↓ Enter Esc), check en la opción elegida, iconos/colores del catálogo y ARIA.
- **Nuevo fondo** compacto en 2 columnas: Nombre|Tipo · Importe|Moneda · Periodo|Vigencia · Medios|Medios permitidos · Cobertura · Vista previa · Fondo activo|Restricción.
- **Medios**: solo «Todos los medios» y «Solo seleccionados». «Todos excepto» solo aparece (rotulado «heredado») en un fondo que ya lo usa: ningún fondo histórico se modifica.
- **Cobertura**: ámbito/categoría/subcategoría con los mismos iconos y colores que los filtros, «Otros» al final, multiselect con chips, ruta personalizada con «Agregar ruta», sin duplicados.
- **Restricción de medios**: solo con «Solo seleccionados»; si no, se guarda en falso (el backend ya rechazaba restringir sin «solo»).
- **Plantillas de fondos** con el modelo completo (tipo, vigencia, medios, cobertura, rutas, restricción) usando los mismos componentes. Desde cero / desde un fondo existente (no lo modifica) / aplicar a un mes (idempotente).
- **Fondos**: filtros por estado (Combobox) y tipo/ámbito/categoría/medio (multiselect), indicador «N filtro(s) activo(s)» y «Limpiar filtros».
- **Movimientos**: se quitó el aviso «Excedente S/ X → General». Sigue en Dashboard y en el detalle del fondo; la lógica de asignación no cambió.
- **Salud financiera**: se quitó «Mi presupuesto» (tarjeta, panel, `calcularPresupuesto` y sus pruebas). Siguen Calidad, Evolución, Compromisos y Revisión; el motor de presupuesto no se tocó.
- **Sankey**: más alto y ancho, etiquetas más largas, nodos con más separación; en pantallas angostas (<560 px) se muestra la misma información como lista por medio con barras hacia cada ámbito.
- **Jerarquía**: ya tenía divulgación progresiva en 3 niveles (ámbito → categoría → subcategoría); se dejó como estaba.

## B. Backend / Sheets
- `savePlantillaFin` acepta `datos` (`{tipo, vigencia, regla}`), validado con `validarReglas_`, y lo guarda como JSON en la columna 19 «Datos» (ya existe). `pfOut_` lo devuelve como 19.º valor.
- `aplicarPlantillasFin` crea el fondo con `tipo` y `reglas` de la plantilla (mismo ID estable ⇒ un reintento no duplica).
- Plantillas de 1.28 (sin `datos`) siguen funcionando igual. No hay migración ni cambios de esquema; publicar `Code.gs` antes que la web.

## C. Compatibilidad
- Reglas versionadas, asignaciones y medios restringidos no cambian. Historial intacto.
- Web 1.28 con backend 1.29 y viceversa: `datos` es opcional en ambos sentidos.

## D. Despliegue
1. Respaldar la hoja. 2. Pegar `apps-script/Code.gs`, nueva versión de la implementación. 3. Desplegar la web desde `main`. 4. Comprobar: crear plantilla con cobertura, aplicarla a un mes y ver el fondo con sus reglas.

## E. Pruebas
| Tipo | Ejecutadas | Aprobadas | Fallidas |
|---|---|---|---|
| vitest (40 archivos) | 546 | 546 | 0 |
| e2e Playwright (Chromium) | 239 | 239 | 0 |
`tsc -b`, lint (solo warnings previos) y build: OK. Nuevas: backend de plantillas con `datos` (reglas, validación, idempotencia), componentes de medios/cobertura, 6 e2e v1.29 (medios, rutas, filtros, sin excedente/Mi presupuesto, plantilla completa, Sankey móvil). No verificable aquí: ejecución contra el Google Sheets real.

## F. Riesgos
- Publicar `Code.gs` antes que la web; sin eso las plantillas nuevas no guardarían `datos` (la web 1.28 sigue funcionando).
- Fondos con «Todos excepto» siguen funcionando; solo se rotulan «heredado» al editarlos.
- `calcularPresupuesto` y sus 5 pruebas se eliminaron junto con «Mi presupuesto»; el motor sigue cubierto por `presupuesto.test`/`fondos.test`.
