# Guía de despliegue 1.27.0 (NO ejecutada)

## Prerrequisitos
- PR de `fix/auditoria-20261022` revisado, CI en verde y fusionado a `develop` por el dueño.
- Copia de la hoja de cálculo (Archivo → Hacer una copia) y copia del `Code.gs` actual.

## Orden
1. **Backend**: pegar `apps-script/Code.gs` en el proyecto, guardar y volver a implementar (nueva versión de la misma implementación).
2. En el editor ejecutar `crearTokenAdmin()` y guardar el valor mostrado (gestor de contraseñas). Sin él, las funciones de mantenimiento responden `NOT_ENABLED`; el uso diario no se ve afectado.
3. **Web**: publicar el build de Netlify (solo tras el paso 1; la web nueva con backend viejo ignora `adminToken`).
4. Con las cabeceras activas, revisar en la consola del navegador que no haya reportes CSP durante una semana. Luego cambiar `Content-Security-Policy-Report-Only` por `Content-Security-Policy` en `netlify.toml`.

## Verificación
- La versión mostrada en Configuración es 1.27.0 y coincide con la del backend.
- Alta, edición y anulación de un gasto de prueba; recarga y comprobar que persiste.
- Desde Configuración: `setup` sin token de administración debe fallar; con él debe funcionar.
- Atajo de iPhone sigue registrando con su token.
- Presupuesto de octubre sin cambios respecto de la copia.

## Rollback
- Backend: reimplementar con el `Code.gs` guardado (el esquema de hojas no cambió).
- Web: en Netlify, "Publish deploy" del despliegue anterior.
- No hay migraciones de datos que revertir.
