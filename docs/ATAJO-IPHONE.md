# Atajo de iPhone para registrar gastos en Gasto Deejota

Registra un gasto desde el iPhone eligiendo **Ámbito → Categoría → Subcategoría**, más descripción, monto, moneda, medio de pago y fecha. Se guarda en la misma hoja de Google Sheets y lo ves al instante en el Dashboard, Cajas y Salud financiera.

> **Estado de verificación:** la API del atajo (`atajoCatalogo`, `atajoGasto`) está probada con pruebas automáticas que ejecutan el `Code.gs` real contra una hoja simulada. **No se probó en un iPhone real ni contra tu implementación publicada.** Haz primero la prueba del paso 6 antes de usarlo a diario.

---

## 1. Cómo funciona (y por qué es seguro)

| Pieza | Detalle |
|---|---|
| Credencial | Un **token propio del atajo** (`ATAJO_TOKEN`), distinto del token de la web. Solo sirve para dos acciones: leer el catálogo activo y registrar un gasto. No puede leer tus movimientos, editar, borrar ni cambiar configuración. Se revoca en un clic. |
| Transporte | Siempre **POST HTTPS** con el token en el **cuerpo JSON**, nunca en la URL. |
| Dónde vive el token | En un archivo privado de tu iPhone (`Atajos/gasto-deejota/token.txt`), **no dentro del atajo**. Si compartes el atajo, no viaja el token. Aun así: **no compartas el atajo ya configurado ni capturas del archivo**. |
| Validación | El servidor comprueba que ámbito, categoría y subcategoría existan y estén activas y relacionadas entre sí, que el medio de pago esté activo, que la moneda esté permitida y que el monto sea mayor a 0 con hasta 2 decimales. |
| Duplicados | Cada envío lleva una **clave única**. El servidor convierte la clave en el ID del gasto: reenviar la misma clave (reintento, doble toque, falta de señal) **no crea otro gasto**, responde “Ya estaba registrado”. |
| Límites | 20 registros por minuto. 10 tokens inválidos en 10 minutos bloquean el atajo por 10 minutos. |
| Origen | Los gastos del atajo quedan con **Origen = `atajo`** en la hoja. |

> Una URL `/exec` “oculta” no es seguridad: lo que protege es el token, que debe quedar solo en tu iPhone.

---

## 2. Habilitarlo en Apps Script (una sola vez)

1. Abre tu proyecto de Apps Script, pega el `Code.gs` v1.9.0 y guarda.
2. **Implementar → Administrar implementaciones → Editar (lápiz) → Versión: Nueva versión → Implementar.** La URL `/exec` no cambia.
3. En el editor, elige la función **`crearTokenAtajo`** y pulsa **Ejecutar**.
4. Abre **Registro de ejecución**: verás `Token del atajo (…): atj_…`. Cópialo **solo** a tu iPhone (por ejemplo con AirDrop a Notas, pégalo en el atajo y luego borra la nota).
5. Copia también tu URL `/exec` (Implementar → Administrar implementaciones).

Para **revocar** (perdiste el iPhone, compartiste el token por error): ejecuta **`revocarTokenAtajo`**. Para uno nuevo, vuelve a ejecutar `crearTokenAtajo` (el anterior deja de servir).

---

## 3. Contrato de la API

Todas las llamadas: `POST <tu URL /exec>`, cuerpo JSON. Respuesta: `{ "ok": true, "data": … }` o `{ "ok": false, "error": { "code": "…", "message": "…" } }`.

**Catálogo** (una lectura por uso del atajo):

```json
{ "token": "<ATAJO_TOKEN>", "action": "atajoCatalogo", "payload": {} }
```

```json
{
  "ok": true,
  "data": {
    "hoy": "2026-10-10",
    "moneda": "PEN", "monedas": ["PEN", "USD"],
    "medios": ["Yape", "Plin", "Sodexo", "Transferencia", "Efectivo", "Otros"],
    "ambitos": ["Personal", "Trabajo", "Pareja", "Familia", "Amigos"],
    "categorias": { "Personal": ["Alimentación", "Auto", "…", "Otros"] },
    "subcategorias": { "Personal|Alimentación": ["Desayuno", "Almuerzo", "…", "Otros"] }
  }
}
```

Solo opciones activas, ordenadas y con “Otros” al final. Las subcategorías se buscan con la clave `Ámbito|Categoría`. No incluye ningún movimiento.

**Registrar gasto:**

```json
{
  "token": "<ATAJO_TOKEN>", "action": "atajoGasto",
  "payload": {
    "clave": "atajo-20261010093015-4821",
    "ambito": "Personal", "categoria": "Alimentación", "subcategoria": "Almuerzo",
    "descripcion": "Menú del día", "monto": "25.50", "moneda": "PEN", "medioPago": "Yape",
    "fecha": "2026-10-10"
  }
}
```

`fecha` vacía = hoy (America/Lima). `descripcion` vacía = la subcategoría. `monto` acepta `25.5` o `25,50`.

```json
{ "ok": true, "data": { "estado": "registrado", "id": "…", "mensaje": "Gasto registrado: S/ 25.50 · Almuerzo · Yape · 2026-10-10" } }
```

`estado` es `ya-registrado` si esa clave ya se había guardado. Códigos de error: `UNAUTHORIZED`, `NOT_ENABLED`, `LOCKED`, `RATE_LIMIT`, `VALIDATION`, `BUSY`.

---

## 4. Crear los atajos en la app Atajos

Son **dos atajos**: **“GD Enviar”** (auxiliar: envía un gasto y confirma) y **“Gasto Deejota”** (el que usas). Así el reenvío de un gasto pendiente reutiliza exactamente el mismo envío. Nombres de acciones en español (iOS 17/18). Las variables se crean con **“Establecer variable”** o tocando el resultado mágico de cada acción.

### 0. Atajo auxiliar “GD Enviar”

En sus ajustes (ⓘ) activa **Recibir entrada: Diccionario** y **Mostrar en la hoja de compartir: no**.

1. **Entrada del atajo** → **Establecer variable** `Envio`.
2. **Texto** (tu URL `/exec`) → variable `URL`. **Obtener archivo** `gasto-deejota/token.txt` → **Obtener texto de la entrada** → variable `Token`.
3. **Guardar archivo** `Envio` en `Atajos/gasto-deejota/pendiente.json` (sobrescribir, sin preguntar). *Antes de enviar: si se corta la señal, queda guardado con su misma clave.*
4. **Obtener contenido de la URL** → `URL`, **POST**, cuerpo **JSON**: `token` (Texto) = `Token`, `action` (Texto) = `atajoGasto`, `payload` (**Diccionario**) = `Envio`.
5. **Obtener valor del diccionario** `ok`. **Si** es verdadero → **Obtener archivo** `pendiente.json` → **Eliminar archivos** (sin confirmar) → del resultado del paso 4 **Obtener valor del diccionario** `data` → `mensaje` → **Mostrar notificación**.
6. **Si no** → `error` → `message` → **Mostrar alerta** (el pendiente se conserva). **Fin de Si**.

> Si no hay señal, iOS detiene el atajo en el paso 4; `pendiente.json` ya existe y la próxima vez se ofrece reenviarlo con la **misma clave**: nunca se duplica.

### A. Configuración y token

1. **Texto** → pega tu URL `/exec`. → **Establecer variable** `URL`.
2. **Obtener archivo** → carpeta **Atajos**, ruta `gasto-deejota/token.txt`. Desactiva **Mostrar selector de documentos** y **Error si no se encuentra**.
3. **Si** *Archivo* **no tiene ningún valor**:
   - **Solicitar entrada** (Texto) “Pega el token del atajo”.
   - **Guardar archivo** → destino `Atajos/gasto-deejota/token.txt`, desactiva **Preguntar dónde guardar**, activa **Sobrescribir si existe**.
   - **Fin de Si**.
4. **Obtener archivo** (otra vez, misma ruta) → **Obtener texto de la entrada** → **Establecer variable** `Token`.

### B. Envío pendiente (sin duplicados si falló la señal)

5. **Obtener archivo** `gasto-deejota/pendiente.json` (sin selector, sin error si no existe).
6. **Si** *Archivo* **tiene algún valor**:
   - **Elegir del menú** “Hay un gasto que no se confirmó” → opciones **Reenviar** / **Descartar**.
   - En **Reenviar**: **Obtener diccionario de la entrada** (del archivo) → **Ejecutar atajo** “GD Enviar” con ese diccionario como entrada → **Detener este atajo**.
   - En **Descartar**: **Eliminar archivos** (el archivo pendiente).
   - **Fin del menú** / **Fin de Si**.

### C. Leer el catálogo

7. **Obtener contenido de la URL** → URL: `URL`; toca **Mostrar más**: Método **POST**; Cuerpo de solicitud **JSON**; campos: `token` (Texto) = `Token`, `action` (Texto) = `atajoCatalogo`.
8. **Obtener valor del diccionario** clave `ok`. **Si** *Valor del diccionario* **es** `0`/falso → **Obtener valor del diccionario** `error` → **Obtener valor del diccionario** `message` → **Mostrar alerta** con ese texto → **Detener este atajo**. **Fin de Si**.
9. **Obtener valor del diccionario** clave `data` (del paso 7) → **Establecer variable** `Cat`.

### D. Selectores dependientes

10. **Obtener valor del diccionario** `ambitos` de `Cat` → **Elegir de la lista** (Solicitud: “Ámbito”) → **Establecer variable** `Ambito`.
11. **Obtener valor del diccionario** `categorias` de `Cat` → **Obtener valor del diccionario** con clave = variable `Ambito` → **Elegir de la lista** (“Categoría”) → **Establecer variable** `Categoria`.
12. **Texto** → `Ambito|Categoria` (inserta las dos variables con una barra vertical `|` en medio) → **Establecer variable** `ClaveSub`.
13. **Obtener valor del diccionario** `subcategorias` de `Cat` → **Obtener valor del diccionario** con clave = `ClaveSub` → **Elegir de la lista** (“Subcategoría”) → **Establecer variable** `Sub`.
    - Si la lista sale vacía (categoría sin subcategorías activas), **Mostrar alerta** “Esa categoría no tiene subcategorías activas” y **Detener este atajo**.

### E. Datos del gasto

14. **Solicitar entrada** (Texto) “Descripción”, **Respuesta predeterminada** = `Sub` → variable `Desc`.
15. **Solicitar entrada** (Número) “Monto”, activa **Permitir decimales**, desactiva **Permitir negativos** → variable `Monto`.
16. **Obtener valor del diccionario** `monedas` de `Cat` → **Elegir de la lista** (“Moneda”) → variable `Moneda`.
17. **Obtener valor del diccionario** `medios` de `Cat` → **Elegir de la lista** (“Medio de pago”) → variable `Medio`.
18. **Solicitar entrada** (Fecha) “Fecha”, predeterminada **Fecha actual** → **Formatear fecha** → Formato **Personalizado** `yyyy-MM-dd` → variable `Fecha`.
19. **Fecha actual** → **Formatear fecha** personalizado `yyyyMMddHHmmss` → **Número aleatorio** entre 1000 y 9999 → **Texto** `atajo-<fecha formateada>-<número>` → variable `Clave`. *(Se genera una sola vez por gasto.)*

### F. Confirmar y enviar una sola vez

20. **Diccionario** con: `clave`=`Clave`, `ambito`=`Ambito`, `categoria`=`Categoria`, `subcategoria`=`Sub`, `descripcion`=`Desc`, `monto`=`Monto`, `moneda`=`Moneda`, `medioPago`=`Medio`, `fecha`=`Fecha` → variable `Envio`.
    - **Elegir del menú** con el resumen (“Registrar S/ `Monto` · `Sub` · `Medio` · `Fecha`”) → **Registrar** / **Cancelar** (en Cancelar: **Detener este atajo**).
21. **Ejecutar atajo** → “GD Enviar”, entrada = `Envio`. (Muestra la notificación con el resultado real del servidor.)

---

## 5. Atajo a mano

- **Pantalla de inicio:** en Atajos, mantén presionado el atajo → **Compartir → Agregar a pantalla de inicio**. (No uses “Copiar enlace de iCloud” para un atajo ya configurado.)
- **Pantalla de bloqueo / Centro de control (iOS 18):** agrega el control **Atajo** y elige “Gasto Deejota”.
- **Botón de acción** (iPhone 15 Pro o posterior): Configuración → Botón de acción → Atajo.
- **Siri:** di el nombre del atajo.

---

## 6. Checklist de prueba (hazla antes de usarlo a diario)

1. [ ] Primera ejecución: pide el token y lo guarda; la segunda ya no lo pide.
2. [ ] Al elegir **Familia** aparecen sus categorías (p. ej. Bebé); al elegir **Bebé** aparecen Pañales, Leche, etc. Cambia a otro ámbito y comprueba que la lista cambia.
3. [ ] Una categoría o subcategoría desactivada en la web **no** aparece.
4. [ ] Monto `0` o vacío → mensaje de error del servidor, no se guarda nada.
5. [ ] Registra un gasto de prueba de **S/ 1.00** → notificación “Gasto registrado…”.
6. [ ] En la web, pulsa **Actualizar**: aparece en Gastos con Origen `atajo`, y el Dashboard/Cajas suben S/ 1.00 exactamente una vez.
7. [ ] Modo avión justo antes de “Registrar” → el atajo falla. Quita el modo avión, abre el atajo → **Reenviar** → “Ya estaba registrado” o “Gasto registrado” (nunca dos).
8. [ ] Token inválido (edita `token.txt`) → “Token del atajo inválido”. Restaura el archivo.
9. [ ] Elimina el gasto de prueba desde la web.

**Si algo falla en el paso 7 del atajo:** Apps Script responde a los POST con una redirección (302) a `script.googleusercontent.com`; Atajos la sigue automáticamente. Si ves una página HTML de Google en lugar de JSON, revisa que la implementación tenga acceso **“Cualquier usuario”** y que usas la URL `/exec` (no `/dev`). Si aun así tu iOS no sigue la redirección, la alternativa es un intermediario mínimo (por ejemplo una función serverless que reenvía el POST); no está incluido porque no fue necesario en las pruebas del contrato.

---

## 7. Riesgos y mantenimiento

- Quien tenga el archivo `token.txt` puede **registrar** gastos (no leerlos). Revoca con `revocarTokenAtajo` si pierdes el iPhone.
- No pegues el token en chats, capturas, Git ni notas compartidas.
- Al crear un token nuevo, borra `token.txt` en el iPhone: el atajo te pedirá el nuevo.
