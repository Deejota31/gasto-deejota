# Seguridad — notas operativas (1.27.0)

- **Tokens**: `API_TOKEN` (uso diario), `ATAJO_TOKEN` (iPhone, con límites 10 fallos / 20 por minuto) y `ADMIN_TOKEN` (mantenimiento). El de administración debe ser distinto del diario; vive solo en memoria en la web.
- **Rotación**: ejecutar `rotarTokenApi()` en el editor; reconfigurar la conexión en cada dispositivo. `revocarTokenAdmin()` desactiva el mantenimiento.
- **Riesgo residual (S-02)**: el token diario se guarda en `localStorage`; un XSS lo leería. Mitigan la CSP (sin scripts inline ni orígenes externos) y que el token diario ya no permite acciones administrativas. Alternativa más fuerte (pedir el token en cada sesión) aumenta la fricción; decisión del dueño.
- **CSP**: hoy en *Report-Only*; pasar a *enforcing* tras observar sin violaciones. Se validó en navegador local con respuesta de Apps Script simulada, no con la redirección real a googleusercontent.
- **Fórmulas**: toda celda de texto se escapa con apóstrofo inicial. Comportamiento en Sheets real pendiente de verificar con un valor `=1+1` de prueba.
- **Secretos**: `scripts/check-secretos.mjs` corre en CI.
- **Lint**: 76 advertencias aceptadas (only-export-components, set-state-in-effect, purity en handlers); no son defectos funcionales.
