# Gasto Deejota

Microapp personal para registrar y analizar gastos. **Google Sheets** es la base de datos, **Google Apps Script** es la API y el frontend es una web estática (Vite + React + TypeScript + Tailwind + Recharts + Zod + Lucide).

```
apps-script/   Backend: Code.gs (API + instalador) y appsscript.json
web/           Frontend estático + pruebas (Vitest, Playwright)
```

## Arquitectura en una línea por pieza

- **Registro jerárquico**: en el formulario primero se elige el ámbito; las categorías dependen del ámbito y las subcategorías de la categoría. La subcategoría es obligatoria cuando la categoría tiene opciones.
- **Hoja `GASTOS`** (16 columnas exactas): única fuente de movimientos. Además, solo `CATALOGO`, `MEDIOS_PAGO`, `CAJAS`, `PRESUPUESTOS` y `CONFIG`.
- **API**: `POST` con cuerpo `text/plain` JSON `{token, action, payload}`. Así el token nunca viaja en la URL y no hay preflight CORS. `GET` solo responde un ping de salud sin datos.
- **Lectura**: una sola llamada `data` lee cada hoja una vez (`getValues` por bloque). El resultado se guarda en `CacheService` por 10 minutos, en trozos. "Actualizar" pide `fresh` y salta la caché.
- **Escritura**: `LockService`, validación en el servidor, UUID generado por el cliente al abrir el formulario (si un reintento llega dos veces no se duplica), invalidación de caché por "generación" para que una lectura lenta no deje datos viejos.
- **Cálculos**: todos en el navegador, en céntimos enteros, con un único motor (`web/src/lib/engine.ts`) que hace una pasada por combinación de filtros. Los KPIs y todos los gráficos salen del mismo resultado, así que siempre cuadran.

### Decisiones respecto del prompt

| Prompt | Hecho | Por qué |
|---|---|---|
| Next.js + shadcn/ui | Vite + React, componentes propios pequeños | La app solo habla con Apps Script desde el navegador: el servidor de Next.js no aporta nada y suma peso y costo de hosting. |
| Catálogo completo | 5 ámbitos, 28 categorías, 178 subcategorías | Cargado por `setup` desde `CATALOGO_INICIAL` (`Code.gs`), idéntico a `web/src/lib/catalogo.ts` (una prueba lo verifica). Volver a ejecutar `setup` agrega solo lo que falte, sin reactivar lo desactivado. |
| Identidad de las capturas | Paleta del texto del prompt | Las capturas no se adjuntaron. |
| Medios de pago | 6 por defecto, en este orden: Yape, Plin, Sodexo, Transferencia, Efectivo, Otros | Editables en Configuración. Los que agregues aparecen después. |

**Excluido en v1.0 (llegó después, en v1.3 y v1.4):** Gastos mensuales (plantillas y registro masivo). `Es recurrente` sigue siendo solo un atributo del movimiento.


## Novedades v1.5.0

| Punto | Qué cambió |
|---|---|
| **Corrección: plantillas** | **Causa raíz del error “La hoja PLANTILLAS_MENSUALES tiene encabezados distintos”:** reordenar plantillas escribía la columna Orden (K) sin agregar su encabezado, y la validación exigía que la fila 1 coincidiera exactamente con la lista esperada; las celdas vacías de H–K (y los números de Orden sin encabezado) hacían fallar crear, editar, clonar y eliminar. Ahora una migración segura (`migrarPlantillasHoja_`) reconoce cada columna por su encabezado (y variantes como “Monto predeterminado”), adopta una columna sin encabezado solo si sus datos tienen el tipo correcto (Orden = enteros), agrega solo los encabezados faltantes, crea un respaldo del archivo antes del primer cambio, conserva IDs, fechas y orden, y es idempotente. Un encabezado desconocido o repetido, datos de otro tipo o IDs repetidos detienen la operación con un mensaje claro (código `SCHEMA`, sin reintentos) y sin escribir nada. Reordenar y eliminar también pasan por esta verificación. Se puede ejecutar a mano con `migrarPlantillas()`. |
| Formulario de plantilla | Espera la confirmación real de Apps Script: si falla, queda abierto con el error y lo que escribiste; reintentar usa el mismo ID (no duplica) y el doble clic no envía dos veces. Nuevo interruptor “Es un compromiso mensual”. |
| Salud financiera (Dashboard) | Cuatro vistas: **Calidad de datos** (índice 0–100 = 30 % integridad + 30 % clasificación + 20 % consistencia del catálogo + 20 % duplicados confirmados; “Revisar datos” lista problemas, clasificaciones inválidas con sugerencia, históricas reconocidas y coincidencias), **Mi presupuesto** (presupuesto, gastado, compromisos pendientes, disponible y disponible tras compromisos; alertas 70/90/100 %; cajas específicas sin sumarse al general), **Evolución** (mismo tramo del mes anterior o dos meses; por ámbito, categoría o subcategoría; “Nuevo” sin base; ahorro simulado del 15 % solo en gastos discrecionales) y **Compromisos** (previsto, cubierto, pendiente, pagos parciales, asociar o quitar movimientos). Todo se calcula en el navegador con los datos ya cargados. |
| Posibles duplicados | Se agrupan por fecha, monto, moneda, clasificación, descripción normalizada y medio (sin comparar todos contra todos). Son alertas, no errores: se pueden marcar como legítimas, pendientes o duplicado confirmado. Nunca se elimina nada. Si un movimiento revisado cambia, esa alerta vuelve a evaluarse. |
| Compromisos sin doble conteo | Un gasto registrado desde una plantilla (individual o en lote) queda vinculado a ella. Pendiente = previsto − pagos vinculados del mes (nunca negativo). Un pago sube “gastado” y baja “pendiente” en lo mismo. Anular deja de cubrir y restaurar vuelve a cubrir; clonar o editar no crean vínculos. Se usa siempre la fecha real del movimiento. |
| Hojas nuevas | `VINCULOS_PLANTILLAS` (Gasto ID, Plantilla ID, Creado en) y `REVISIONES_CALIDAD` (ID revisión, Tipo alerta, IDs movimientos, Estado revisión, Firma, Creado en, Actualizado en). Se crean solas con el primer uso. `PLANTILLAS_MENSUALES` agrega “Es compromiso”. GASTOS no cambia. |
| Móvil | Fecha y Tipo de gasto con la misma caja (44 px, mismo borde, radio y tipografía; sin estilos nativos de iOS; la fecha se muestra con el formato de Configuración y conserva su valor AAAA-MM-DD), se apilan en pantallas muy angostas; campos a 16 px en teléfonos (evita el zoom de Safari); el campo enfocado se mantiene visible con el teclado. En Gastos mensuales, Usar / Editar / Eliminar quedan centrados en una fila propia en cada tarjeta móvil. |

### Migración a v1.5.0

1. Reemplaza `Code.gs` en Apps Script y guarda.
2. **Implementar → Gestionar implementaciones → ✏️ → Nueva versión → Implementar.**
3. Listo: al primer guardado de una plantilla, la hoja se migra sola (con respaldo previo en tu Drive). Si quieres verlo antes, ejecuta `migrarPlantillas` desde el editor y revisa el registro.

## Novedades v1.4.0

| Punto | Qué cambió |
|---|---|
| Plantillas con valores | Cada plantilla guarda **Monto predeterminado** (opcional, ≥ 0), **Moneda** (de las monedas de Configuración, PEN por defecto) y **Medio de pago predeterminado**. "Usar" abre Nuevo gasto con esos valores. Las plantillas se mantienen de un mes a otro. |
| Gastos mensuales en tabla | Modal ancho con fecha de registro (hoy en Lima por defecto), búsqueda, filtro por ámbito, casillas por fila, "Seleccionar todas / visibles / Limpiar selección" (la selección sobrevive a los filtros) y edición en línea de monto, moneda y medio. **Esos cambios son temporales**: solo valen para el registro y nunca modifican la plantilla. Cabecera y resumen fijos; la lista hace scroll. |
| Registro masivo | Resumen fijo con cantidad, totales separados por moneda (calculados en céntimos), detalle desplegable y "Registrar N gastos". Una sola solicitud (`saveGastosBatch`): valida todo antes de escribir (si un gasto falla, no se inserta ninguno), inserta en el orden global de la lista con una sola escritura y es idempotente (IDs fijos por plantilla + `loteId`): reintentar no duplica. Al confirmar se limpian solo los registrados. |
| Orden de plantillas | Arrastrar ⋮⋮ (o Subir/Bajar en el menú "⋯") con una solicitud por cambio (`reorderPlantillas`, una escritura de columna). Bloqueado con búsqueda o filtro activos. Si falla, vuelve al orden anterior. |
| Clonar plantilla | Mismo formulario con los datos de la original; ID nuevo y se inserta justo debajo. Un duplicado exacto de las 7 propiedades se rechaza: "La plantilla ya existe. Modifica al menos uno de sus valores para guardar una copia." |
| Ajustar caja | "Solo para [mes]" viene activado cada vez que se abre el modal. |
| Pestaña Gastos | Botón "Gastos mensuales" (mismo modal) y **Orden personalizado**: arrastrar o ↑ ↓ en móvil, una solicitud por cambio (`reorderGastos`). Se guarda aparte en `ORDEN_GASTOS` (ID, Orden): no mueve filas ni toca GASTOS. Solo con todo el listado a la vista (sin búsqueda ni filtros). Los gastos nuevos aparecen arriba hasta que los ubiques. El orden se numera dentro del período que estás viendo: si ordenas septiembre y octubre por separado y luego miras ambos juntos, se intercalan. Bloqueado si el período tiene IDs por reparar. |
| Análisis detallado | Encabezado con período, rango de fechas, movimientos, monedas y filtros. Pestañas más claras (navegables con flechas). **Jerarquía** con barras de peso, % por nivel, expandir/contraer (se recuerda en la sesión) y resaltado. **Flujo de medios de pago** propio en SVG: al pasar el mouse por un medio, ámbito o conexión se resaltan sus enlaces y se atenúa el resto; tooltip con monto, movimientos y %, y en conexiones el % dentro del medio y del ámbito; resumen con primer/último movimiento, día de mayor gasto y medio dominante. **Frecuencia vs monto** con burbujas grandes (tamaño = monto), transparencia, borde, separación de puntos superpuestos, líneas de promedio, etiquetas y resaltado por ámbito. Se eliminó "Por medio de pago". Todo sale de los datos ya cargados: no hay consultas nuevas. |

### Migración a v1.4.0

1. Reemplaza `Code.gs` en Apps Script y guarda. No hace falta ejecutar nada: `PLANTILLAS_MENSUALES` agrega sola las columnas Monto, Moneda, Medio de pago y Orden (las plantillas existentes quedan sin monto, en PEN y en su orden actual) y `ORDEN_GASTOS` se crea con el primer reordenamiento.
2. **Implementar → Gestionar implementaciones → ✏️ → Nueva versión → Implementar.**
3. La web se publica al fusionar en `main`.

## Novedades v1.3.0

| Punto | Qué cambió |
|---|---|
| Descripción automática | Al elegir una subcategoría, la descripción se completa con su nombre ("Moto Taxi", "ChatGPT"). Si cambias de subcategoría se actualiza solo mientras siga siendo la automática; si la escribiste tú, no se toca; si la vacías, vuelve a completarse. "Otros" y "Por Clasificar" la dejan vacía. En editar y clonar se conserva la del registro. Lógica en `autocompletar()` (`components/Clasificacion.tsx`), usada por el formulario de gasto y por el de plantillas. |
| Formato de descripciones | `formatearDescripcion()` (`lib/texto.ts`), una sola función para nuevo, editar, clonar y plantillas: mayúscula inicial en palabras principales, artículos/preposiciones en minúscula (salvo al inicio), marcas y siglas con su escritura (ChatGPT, HBO, SOAT, YouTube, iPhone, WiFi, USD…), y respeta tildes, números, signos y emojis. Se aplica al salir del campo y antes de guardar; nunca a registros antiguos. |
| Clonar | **Causa del error:** al clonar, el formulario reemplazaba la fecha por la de hoy. Ahora copia la fecha original tal cual (texto AAAA-MM-DD, sin conversiones de zona horaria) y todos los datos; el ID es nuevo al guardar y el original no cambia. |
| Configuración | Encabezado con estado de conexión, campos con iconos, cajas como tarjetas con su color, alcance y botón "Guardar cambios/Descartar", medios como botones con icono (activar/desactivar), acciones de datos agrupadas y "Acerca de" compacto. Misma lógica que antes. |
| Gastos mensuales | Botón junto a "+ Nuevo gasto" en el Dashboard. Abre un panel de **plantillas** (ámbito, categoría, subcategoría y descripción). "Usar" abre el mismo formulario de Nuevo gasto precargado (fecha de hoy, monto vacío) y se registra por el flujo normal. Editar/eliminar (con confirmación) solo afectan la plantilla. Una plantilla cuya clasificación ya no está vigente aparece como "Requiere revisión" y no se puede usar hasta editarla. Duplicados exactos rechazados (ignora mayúsculas y espacios). |
| Hoja nueva | `PLANTILLAS_MENSUALES` (ID, Ámbito, Categoría, Subcategoría, Descripción, Creado en, Actualizado en). Se crea sola con la primera plantilla (o al ejecutar `setup`). IDs con prefijo `pl-`, que el backend no acepta como ID de gasto. Nunca se escribe en GASTOS. |
| Rendimiento | Las plantillas se leen solo al abrir "Gastos mensuales" por primera vez, con una acción liviana que lee únicamente su hoja; luego quedan en memoria (se releen tras "Actualizar"). Viven fuera de los datos del dashboard, así que crear/editar/eliminar plantillas no recalcula KPIs ni gráficos, y en el backend no invalidan la caché de datos. Escrituras sin bloquear, con su notificación. |

### Migración a v1.3.0

1. Reemplaza `Code.gs` en Apps Script y guarda (no hace falta ejecutar nada: la hoja de plantillas se crea sola; si prefieres, ejecuta `setup`).
2. **Implementar → Gestionar implementaciones → ✏️ → Nueva versión → Implementar.**
3. La web se publica al fusionar en `main`.

## Novedades v1.2.0

| Punto | Qué cambió |
|---|---|
| Catálogo | Nueva lista oficial (5 ámbitos, 36 categorías, 214 subcategorías) en `CATALOGO_INICIAL` (`Code.gs`) y `web/src/lib/catalogo.ts`. Una prueba exige que ambas sean idénticas: son la misma lista en los dos lugares donde debe existir (Apps Script no puede importar archivos del frontend). Transporte = Taxi, Moto Taxi, Bus / Micro, Otros en todos los ámbitos; Alimentación usa "Snack / Antojos"; Personal → Servicios = Línea Celular y Otros. |
| Aplicar el catálogo a tu hoja | Función `actualizarCatalogo()` (se ejecuta a mano desde el editor). Crea un respaldo, agrega lo que falta y, en las filas de versiones anteriores (sin Orden), deja **inactivo** (no borra) lo que ya no está en la lista y activa lo vigente. Las filas con Orden (ya migradas o creadas desde la app) no se tocan, así volver a ejecutarla no deshace tus cambios manuales. El registro lista qué quedó inactivo. No toca la hoja GASTOS: los gastos antiguos conservan sus valores ("Antojos", "Cuidado Darielita", "Familia › Madre"…), se siguen viendo, sumando en cajas y se pueden filtrar (aparecen como "(histórica)"). Al editar un gasto antiguo, su clasificación se conserva. |
| Columna Orden | CATALOGO tiene una 7.ª columna `Orden` (se agrega sola con `setup` o `actualizarCatalogo`). La web ordena por ese número, no por la posición de la fila. Puedes reordenar a mano cambiando los números. |
| "Otros" al final | Regla central en `web/src/lib/orden.ts`: `sortCatalogo` (ámbito → categoría → subcategoría, por grupo) y `otrosAlFinal`. Se aplica al recibir datos de la hoja y después de cada alta, edición o renombrado; la usan el formulario (crear/editar/clonar), los filtros, la pestaña Categorías y Configuración (medios). Compara ignorando mayúsculas y espacios, y evita "Otros" duplicados en un mismo grupo (también el backend). |
| Escrituras sin bloquear | `store.track()`: el formulario valida, entrega la operación y se cierra; la petición sigue en segundo plano. Cada operación tiene su clave (ID del gasto, caja, opción del catálogo) para impedir envíos duplicados; la fila afectada muestra "Guardando…" y no admite otra acción hasta la respuesta. Nada se marca como guardado hasta que el backend lo confirma. Si una lectura completa ("Actualizar") termina después de un guardado, los cambios confirmados se vuelven a aplicar encima, así una respuesta tardía no borra datos nuevos. Sin polling ni consultas extra. Una operación pendiente se pierde si recargas o cierras la pestaña (no es una cola persistente). Si un alta llegó a guardarse pero la respuesta se perdió, reintentarla con el formulario corregido actualiza ese mismo registro (nunca duplica, y no pisa un gasto que ya editaste después). |
| Notificaciones | Arriba a la derecha, apiladas en orden y una por operación: "Guardando…" → verde con ✓ (se va a los ~4 s) o roja con ✕ (queda hasta que la cierres, con **Reintentar** —mismo ID, sin duplicar— y **Abrir formulario** con tus datos). Solo cada tarjeta recibe clics. Si hay un formulario abierto, las notificaciones se muestran encima de él. |
| IDs editados a mano | Si en la hoja hay gastos con el ID repetido o con caracteres no válidos, la tabla los muestra una sola vez (antes, al ordenar, se repetían filas en pantalla) y bloquea Editar/Clonar/Eliminar en esas filas, con un aviso: con un ID repetido, editar uno cambiaría el otro. La función **`repararIds()`** (editor de Apps Script) crea un respaldo y asigna un ID nuevo solo a esas filas, sin tocar ningún otro dato. |
| Dashboard | Botón **+ Nuevo gasto** junto al título; abre el mismo formulario que Gastos (un solo modal en toda la app). **Top 5 categorías** y **Top 10 subcategorías** (identificadas por categoría + subcategoría), calculados sobre los datos ya cargados y con los filtros activos. |

### Migración a v1.2.0

1. Haz un respaldo (Configuración → *Crear respaldo*).
2. Reemplaza `Code.gs` en tu proyecto de Apps Script y guarda.
3. Ejecuta **`actualizarCatalogo`** desde el editor y acepta. El registro muestra el respaldo creado y cuántas opciones se agregaron, reactivaron o desactivaron.
4. **Implementar → Gestionar implementaciones → ✏️ → Nueva versión → Implementar** (la URL no cambia).
5. La web se publica sola desde GitHub al fusionar en `main`.

Para volver atrás: versión anterior de la implementación y, si hace falta, copia la hoja CATALOGO del respaldo. GASTOS no cambia en esta migración.

## Novedades v1.1.0

| Punto | Qué cambió |
|---|---|
| Registros desde la fila 1000 | **Causa:** `setup` ponía casillas de verificación en columnas enteras (`J2:J` en GASTOS, `D2:D` en CATALOGO, `B2:B` en MEDIOS_PAGO). Cada casilla vacía guarda `FALSE`, así que Sheets consideraba ocupadas las filas 2–1000 y `appendRow` escribía en la 1001. Ese `FALSE` también era la opción en blanco del selector de medios. **Corrección:** ya no se crean casillas; las escrituras van justo después de la última fila con contenido real (`appendRows_`), y las lecturas ignoran filas sin ID/clave. |
| Datos existentes | No se borra ni se mueve nada automáticamente. Con el `Code.gs` nuevo, los registros que ya están en la fila 1001+ se siguen leyendo y los nuevos van debajo de ellos. Para dejarlos desde la fila 2 existe `repararHojas()` (opcional, ver Migración). |
| Dashboard | Sin "Últimos 6 meses". "Gasto acumulado" ocupa toda la fila, con real, proyección de cierre, ritmo ideal y un panel aparte **Gasto diario**. La proyección solo aparece si el período está en curso (en uno pasado se muestra el cierre real; en uno futuro, nada). |
| Gráficos | Donut por ámbito con total al centro y leyenda que filtra; barras por categoría y Top 10 subcategorías con icono, color, % y n.º de movimientos; tooltips en todos. Cada KPI y gráfico tiene un ⓘ que explica qué muestra y cómo se calcula. |
| Filtros | Período (Este mes, Mes anterior, Últimos 3/6 meses, Este año, Personalizado) y multiselección con búsqueda en ámbito → categoría → subcategoría (dependientes), medio y tipo. Chips de filtros activos y "Limpiar filtros". Los filtros se comparten entre Dashboard y Gastos. |
| Cajas | La caja general es el presupuesto total; las subcajas son **reservas dentro de ella** (ver fórmulas). |
| Tabla | Iconos por ámbito/categoría/medio, Editar, Clonar, Eliminar (lógico, con confirmación) y Restaurar; en móvil se desliza la tarjeta para ver las acciones (el gesto nunca ejecuta nada por sí solo). 5/10/15/25/50 por página (10 por defecto) y "Mostrando 1–10 de N". |
| Catálogo | Pestañas por ámbito, tarjetas por categoría, búsqueda con resaltado, crear/editar/renombrar/desactivar/reactivar con icono y color. Renombrar actualiza también los gastos ya registrados de ese ámbito. |
| Formulario | Selección por chips (ámbito → categoría → subcategoría), monto grande, medios en botones con su color. |

### Fórmulas de cajas

Con P = presupuesto de la caja general, R = suma de lo asignado a las subcajas, Gs = gastado dentro de subcajas, Gl = gastado fuera de subcajas:

- **Libre inicial** = P − R (ej. 5 000 − (600 + 400 + 200) = 3 800)
- **Saldo libre** = P − R − Gl − exceso de subcajas (si una subcaja gasta más de lo asignado, el exceso sale del saldo libre)
- **Disponible global** = P − Gs − Gl
- Cada gasto cuenta en **una sola** subcaja (la primera que coincide según el orden), así no hay doble conteo.
- Avisos: subcajas que suman más que P, subcaja excedida, saldo libre negativo.

## Migración desde v1.0.0

1. **Antes de nada:** Configuración → *Crear respaldo* (o Archivo → Hacer una copia en Sheets).
2. Apps Script → reemplaza todo `Code.gs` por `apps-script/Code.gs` (v1.1.0) y guarda.
3. Ejecuta `setup` una vez: agrega las columnas Icono y Color a CATALOGO y los medios que falten (Sodexo, Otros). No toca GASTOS.
4. **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.** La URL `/exec` no cambia.
5. Sube el nuevo `web/dist` a Netlify (Deploys → arrastrar la carpeta).
6. *(Opcional)* Para que los registros queden desde la fila 2: ejecuta `repararHojas` desde el editor. Primero crea una copia de respaldo en tu Drive (la URL sale en el registro), luego en cada hoja quita las casillas, sube las filas con contenido al inicio sin cambiar su orden, pone ID a los gastos escritos a mano que no lo tenían y ordena los medios. **No elimina filas con contenido.** Si alguna celda tenía una fórmula, queda su valor.

**Revertir:** en Gestionar implementaciones elige la versión anterior; en Netlify, *Publish deploy* sobre el despliegue previo. Si ejecutaste `repararHojas` y quieres volver, abre la copia de respaldo que creó (o la de Configuración) y copia sus hojas de vuelta.

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
| `npm test` | Pruebas unitarias, de integración y de rendimiento (Vitest, 103) |
| `npm run test:e2e` | E2E con Playwright contra el modo demo (41), incluido Apps Script lento (`?latencia=`) y caído (`?falla=1`). Si Playwright no puede descargar su navegador, usa `CHROMIUM_PATH=/ruta/a/chromium`. |
| `npm run perf` | Medición del motor con 1k/5k/10k movimientos |

## Pruebas

- **Unitarias** (`engine.test.ts`): céntimos, porcentajes con divisor cero, conversión de moneda, fechas en Lima, KPIs, filtros, anulación y restauración, cajas, presupuestos con override, proyección, meses "sin datos" frente a cero, y reconciliación (la suma de cada gráfico es igual al total).
- **Integración del backend** (`backend.test.ts`): ejecuta el `Code.gs` real contra una simulación en memoria de SpreadsheetApp, CacheService, LockService y PropertiesService. Cubre el instalador idempotente, token, idempotencia de altas, edición, anulación, validaciones, inyección de fórmulas, caché e invalidación, lectura de una sola llamada por hoja, lock ocupado y upserts. Comprobé que las pruebas fallan si se quita la protección de duplicados o la de fórmulas.
- **Cliente API** (`api.test.ts`): POST `text/plain`, máximo 3 reintentos solo para errores transitorios, sin reintentos para validación, permisos o cuota, timeout, respuesta HTML de un despliegue mal configurado, y deduplicación de lecturas simultáneas.
- **Backend v1.1** (`backend.test.ts`): inserción en filas 2, 3, 4…; ninguna fila de relleno; hoja heredada con `FALSE` en 999 filas y datos en la 1001 → el nuevo registro va justo debajo sin tocar lo existente; `repararHojas` compacta, crea respaldo, asigna IDs y ordena medios; renombrar en cascada y rechazo de duplicados.
- **Análisis** (`components/analisis.test.tsx`): solo 3 pestañas, encabezado de contexto, % de jerarquía por nivel, estado vacío en las 3 vistas, disposición del Sankey (enlaces dentro de sus nodos) y separación de burbujas.
- **E2E** (`e2e/app.spec.ts`): pestañas y ausencia de "Últimos 6 meses"; ⓘ en los 8 KPIs; multiselección, chips, filtros dependientes, limpiar y presets; fórmulas de cajas en pantalla; orden de medios sin opción en blanco; registrar, editar, clonar, eliminar y restaurar; paginación 5–50; crear subcategoría y usarla; renombrar categoría con cascada; móvil sin scroll horizontal y deslizar para ver acciones sin borrar por accidente; caso 10 (Familia + Bebé + Yape) cuadra tabla y KPI.

> Las pruebas de integración usan una simulación de Google, no Google real. La conexión real se verifica al desplegar: Configuración → *Diagnóstico* muestra filas por hoja, estado de caché y tiempo de lectura.

## Rendimiento (medido, local)

Datos sintéticos deterministas. Mediana de 7 corridas para el motor y de 3 para el navegador (Chromium headless). **No incluyen la latencia de Apps Script**: no se pudo medir aquí porque depende de tu cuenta de Google y del arranque en frío. Se mide en vivo con *Diagnóstico* y con el campo `ms` de cada respuesta.

| Movimientos | JSON | Parseo + validación (Zod) | Agregación completa | Carga inicial UI* | Cambio de filtro | Abrir Gastos |
|---|---|---|---|---|---|---|
| 1.000 | 191 KB | 2,9 ms | 3,8 ms | 344 ms | 85 ms | 83 ms |
| 5.000 | 960 KB | 8,5 ms | 8,9 ms | 706 ms | 110 ms | 95 ms |
| 10.000 | 1,9 MB | 21,9 ms | 14,9 ms | 751 ms | 104 ms | 98 ms |

Agregación v1.1 medida con el rango "Este año" (más trabajo que un mes). Las columnas de UI son de la v1.0 y no se volvieron a medir.

\* Incluye generar los datos sintéticos en el navegador y se descuentan los 250 ms de latencia simulada. Los tiempos de UI incluyen la espera de Playwright y son cotas superiores.

Presupuestos aplicados: agregación < 100 ms (verificado en `npm run perf`); sin polling; una sola lectura al abrir y otra solo al pulsar Actualizar; la última copia se guarda en el navegador para pintar al instante mientras sincroniza; Recharts se carga aparte del resto (bundle inicial de 131 KB gzip en v1.1).

## Errores encontrados y corregidos durante el desarrollo

1. **Caché del servidor con datos viejos** si una lectura lenta terminaba después de una escritura. Se corrigió con una caché versionada por generación (UUID), con prueba de regresión.
2. **Generación de caché con `Date.now()`**: dos escrituras en el mismo milisegundo compartían versión. Se cambió a UUID; lo detectó la prueba de edición.
3. **Ediciones hechas a mano en la hoja** podían tardar hasta 6 h en verse. El TTL bajó a 10 min y "Actualizar" lee siempre sin caché.
4. **Botón Actualizar** enviaba el evento del clic como parámetro `fresh`. Se corrigió.
5. **Token en la URL** con GET: se movieron todas las lecturas a POST.
6. **Bundle inicial de 808 KB**: Recharts entraba por un helper de colores. Se separó y quedó en 368 KB (112 KB gzip).
7. **Etiquetas cortadas** en tarjetas de cajas, eje Y y encabezado en móvil. Se corrigieron tras revisar capturas.
8. **Selector de categoría** ofrecía categorías desactivadas que tenían subcategorías activas. Se corrigió.
9. **Filas desde la 1001 y medio en blanco** (v1.1): casillas de verificación en columnas completas. Ver Novedades.
10. **Deslizar en móvil** (v1.1): el clic que el navegador emite al soltar el dedo cerraba la tarjeta recién abierta. Lo detectó la prueba E2E; se ignora el clic que sigue a un arrastre.
11. **Rango de fechas inválido** (v1.1) hacía fallar la agregación; ahora se trata como período vacío.

## Seguridad

- Token en Propiedades del script, nunca en el código del frontend. En el navegador queda en `localStorage`, aceptable para una app personal en tu propio dispositivo. No lo uses en equipos compartidos.
- Validación en el servidor: fechas reales, montos > 0 y ≤ 1e9, moneda ISO, longitudes máximas, tipo de gasto en lista cerrada, URL de comprobante solo `https`, IDs con formato UUID y claves de configuración en lista permitida.
- Textos que empiezan con `= + - @` se guardan como texto para evitar **inyección de fórmulas** en Sheets. La exportación CSV aplica la misma protección.
- Errores al usuario con mensajes comprensibles; los detalles internos van a los registros de Apps Script.

## Pendiente de tu parte

1. **Capturas de referencia** si quieres ajustar el diseño al original.
2. Seguir la sección *Migración desde v1.0.0* (reemplazar `Code.gs`, `setup`, nueva versión, subir `dist`).
