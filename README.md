# Gasto Deejota

Microapp personal para registrar y analizar gastos. **Google Sheets** es la base de datos, **Google Apps Script** es la API y el frontend es una web estática (Vite + React + TypeScript + Tailwind + Recharts + Zod + Lucide).

```
apps-script/   Backend: Code.gs (API + instalador) y appsscript.json
web/           Frontend estático + pruebas (Vitest, Playwright)
```

## Arquitectura en una línea por pieza

- **Hoja `GASTOS`** (16 columnas exactas): única fuente de movimientos. Además, solo `CATALOGO`, `MEDIOS_PAGO`, `CAJAS`, `PRESUPUESTOS` y `CONFIG`.
- **API**: `POST` con cuerpo `text/plain` JSON `{token, action, payload}`. Así el token nunca viaja en la URL y no hay preflight CORS. `GET` solo responde un ping de salud sin datos.
- **Lectura**: una sola llamada `data` lee cada hoja una vez (`getValues` por bloque). El resultado se guarda en `CacheService` por 10 minutos, en trozos. "Actualizar" pide `fresh` y salta la caché.
- **Escritura**: `LockService`, validación en el servidor, UUID generado por el cliente al abrir el formulario (si un reintento llega dos veces no se duplica), invalidación de caché por "generación" para que una lectura lenta no deje datos viejos.
- **Cálculos**: todos en el navegador, en céntimos enteros, con un único motor (`web/src/lib/engine.ts`) que hace una pasada por combinación de filtros. Los KPIs y todos los gráficos salen del mismo resultado, así que siempre cuadran.

### Decisiones respecto del prompt

| Prompt | Hecho | Por qué |
|---|---|---|
| Next.js + shadcn/ui | Vite + React, componentes propios pequeños | La app solo habla con Apps Script desde el navegador: el servidor de Next.js no aporta nada y suma peso y costo de hosting. |
| Catálogo completo | Solo los 5 ámbitos | El catálogo no venía en el contexto y el prompt pide no inventarlo. Se carga desde la pestaña Categorías o en `CATALOGO_INICIAL` de `Code.gs`. |
| Identidad de las capturas | Paleta del texto del prompt | Las capturas no se adjuntaron. |
| Medios de pago | Se crean 6 por defecto (Efectivo, Débito, Crédito, Yape, Plin, Transferencia) | Editables en Configuración. |

**Excluido por diseño:** cualquier lógica de Gastos mensuales (plantillas, control mensual, lotes, vínculos). `Es recurrente` es solo un atributo del movimiento.

## Despliegue

### 1. Backend (Apps Script), unos 5 minutos

1. Abre <https://script.google.com> → **Nuevo proyecto** y llámalo `Gasto Deejota API`.
2. Pega `apps-script/Code.gs` en `Código.gs`.
3. En **Configuración del proyecto**, activa "Mostrar archivo de manifiesto `appsscript.json`" y reemplázalo con `apps-script/appsscript.json`.
4. Elige la función `setup` y pulsa **Ejecutar**. Autoriza el acceso a Hojas de cálculo. Al terminar, el **registro de ejecución** muestra la URL del Spreadsheet nuevo y el `API_TOKEN`. Guarda el token.
   - `setup` es idempotente: puedes volver a ejecutarlo sin duplicar nada. Si una hoja tiene encabezados distintos, se detiene en vez de sobrescribirla.
5. **Implementar → Nueva implementación → Aplicación web**, con "Ejecutar como: **Yo**" y "Quién tiene acceso: **Cualquier persona**". Copia la URL que termina en `/exec`.

> "Cualquier persona" es necesario para que el navegador pueda llamar a la API. La protección es el `API_TOKEN`: sin él, la API solo responde un ping vacío. Para cambiar el token, edítalo en Configuración del proyecto → Propiedades del script.

### 2. Frontend

```bash
cd web
npm install
npm run build        # genera web/dist (estático)
```

Sube `web/dist` a cualquier hosting estático gratuito. La forma más rápida es arrastrar la carpeta a <https://app.netlify.com/drop>. También funcionan GitHub Pages o Vercel. No hay variables de entorno en el build: la URL y el token se ingresan en **Configuración → Conexión** y se guardan solo en tu navegador.

Sin conexión configurada, la app arranca en **modo demostración** con datos sintéticos en memoria.

### 3. Actualizar el backend sin cambiar la URL

**Implementar → Gestionar implementaciones → editar → Versión: Nueva versión.** La URL `/exec` se mantiene.

## Respaldo y rollback

- **Datos**: Configuración → *Crear respaldo* copia el Spreadsheet completo a tu Drive con fecha y hora. Para volver atrás, abre la copia y vuelve a copiar las filas a la hoja original, o apunta `SPREADSHEET_ID` (Propiedades del script) a la copia.
- **Backend**: en Gestionar implementaciones, selecciona la versión anterior. La URL no cambia.
- **Frontend**: vuelve a subir el `dist` anterior. Netlify y Vercel permiten restaurar el despliegue previo con un clic.
- **Exportación**: CSV del mes desde Gastos, o de todo el historial desde Configuración.

## Scripts

| Comando (en `web/`) | Qué hace |
|---|---|
| `npm run dev` | Servidor local |
| `npm run build` | Tipado estricto + build |
| `npm test` | Pruebas unitarias, de integración y de rendimiento (Vitest, 45) |
| `npm run test:e2e` | E2E con Playwright contra el modo demo (7). Si Playwright no puede descargar su navegador, usa `CHROMIUM_PATH=/ruta/a/chromium`. |
| `npm run perf` | Medición del motor con 1k/5k/10k movimientos |

## Pruebas

- **Unitarias** (`engine.test.ts`): céntimos, porcentajes con divisor cero, conversión de moneda, fechas en Lima, KPIs, filtros, anulación y restauración, cajas, presupuestos con override, proyección, meses "sin datos" frente a cero, y reconciliación (la suma de cada gráfico es igual al total).
- **Integración del backend** (`backend.test.ts`): ejecuta el `Code.gs` real contra una simulación en memoria de SpreadsheetApp, CacheService, LockService y PropertiesService. Cubre el instalador idempotente, token, idempotencia de altas, edición, anulación, validaciones, inyección de fórmulas, caché e invalidación, lectura de una sola llamada por hoja, lock ocupado y upserts. Comprobé que las pruebas fallan si se quita la protección de duplicados o la de fórmulas.
- **Cliente API** (`api.test.ts`): POST `text/plain`, máximo 3 reintentos solo para errores transitorios, sin reintentos para validación, permisos o cuota, timeout, respuesta HTML de un despliegue mal configurado, y deduplicación de lecturas simultáneas.
- **E2E** (`e2e/app.spec.ts`): navegación, Dashboard y filtros, alta, edición, anulación y restauración, búsqueda, orden y CSV, categorías, tema oscuro, validación de conexión, y que no haya scroll horizontal a 375 px.

> Las pruebas de integración usan una simulación de Google, no Google real. La conexión real se verifica al desplegar: Configuración → *Diagnóstico* muestra filas por hoja, estado de caché y tiempo de lectura.

## Rendimiento (medido, local)

Datos sintéticos deterministas. Mediana de 7 corridas para el motor y de 3 para el navegador (Chromium headless). **No incluyen la latencia de Apps Script**: no se pudo medir aquí porque depende de tu cuenta de Google y del arranque en frío. Se mide en vivo con *Diagnóstico* y con el campo `ms` de cada respuesta.

| Movimientos | JSON | Parseo + validación (Zod) | Agregación completa | Carga inicial UI* | Cambio de filtro | Abrir Gastos |
|---|---|---|---|---|---|---|
| 1.000 | 192 KB | 2,1 ms | 0,7 ms | 344 ms | 85 ms | 83 ms |
| 5.000 | 964 KB | 9,2 ms | 2,6 ms | 706 ms | 110 ms | 95 ms |
| 10.000 | 1,9 MB | 22,4 ms | 2,9 ms | 751 ms | 104 ms | 98 ms |

\* Incluye generar los datos sintéticos en el navegador y se descuentan los 250 ms de latencia simulada. Los tiempos de UI incluyen la espera de Playwright y son cotas superiores.

Presupuestos aplicados: agregación < 100 ms (verificado en `npm run perf`); sin polling; una sola lectura al abrir y otra solo al pulsar Actualizar; la última copia se guarda en el navegador para pintar al instante mientras sincroniza; Recharts se carga aparte del resto (bundle inicial de 112 KB gzip).

## Errores encontrados y corregidos durante el desarrollo

1. **Caché del servidor con datos viejos** si una lectura lenta terminaba después de una escritura. Se corrigió con una caché versionada por generación (UUID), con prueba de regresión.
2. **Generación de caché con `Date.now()`**: dos escrituras en el mismo milisegundo compartían versión. Se cambió a UUID; lo detectó la prueba de edición.
3. **Ediciones hechas a mano en la hoja** podían tardar hasta 6 h en verse. El TTL bajó a 10 min y "Actualizar" lee siempre sin caché.
4. **Botón Actualizar** enviaba el evento del clic como parámetro `fresh`. Se corrigió.
5. **Token en la URL** con GET: se movieron todas las lecturas a POST.
6. **Bundle inicial de 808 KB**: Recharts entraba por un helper de colores. Se separó y quedó en 368 KB (112 KB gzip).
7. **Etiquetas cortadas** en tarjetas de cajas, eje Y y encabezado en móvil. Se corrigieron tras revisar capturas.
8. **Selector de categoría** ofrecía categorías desactivadas que tenían subcategorías activas. Se corrigió.

## Seguridad

- Token en Propiedades del script, nunca en el código del frontend. En el navegador queda en `localStorage`, aceptable para una app personal en tu propio dispositivo. No lo uses en equipos compartidos.
- Validación en el servidor: fechas reales, montos > 0 y ≤ 1e9, moneda ISO, longitudes máximas, tipo de gasto en lista cerrada, URL de comprobante solo `https`, IDs con formato UUID y claves de configuración en lista permitida.
- Textos que empiezan con `= + - @` se guardan como texto para evitar **inyección de fórmulas** en Sheets. La exportación CSV aplica la misma protección.
- Errores al usuario con mensajes comprensibles; los detalles internos van a los registros de Apps Script.

## Pendiente de tu parte

1. **Catálogo de categorías y subcategorías**: pásamelo o cárgalo en la pestaña Categorías.
2. **Capturas de referencia** si quieres ajustar el diseño al original.
3. Ejecutar `setup`, desplegar y conectar (sección Despliegue).
