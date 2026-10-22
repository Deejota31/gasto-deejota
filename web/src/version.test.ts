// A-12 / D-03 — La versión vive en cuatro sitios que se editan a mano; esta prueba falla si alguno se desfasa.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const leer = (ruta: string) => readFileSync(resolve(__dirname, ruta), 'utf8')

describe('versión única de la aplicación', () => {
  const backend = /var APP_VERSION = '([^']+)'/.exec(leer('../../apps-script/Code.gs'))?.[1]
  const paquete = (JSON.parse(leer('../package.json')) as { version: string }).version
  const candado = (JSON.parse(leer('../package-lock.json')) as { version: string }).version
  const web = /export const APP_VERSION = '([^']+)'/.exec(leer('./tabs/Configuracion.tsx'))?.[1]
  const readme = /^## Novedades v(\d+\.\d+\.\d+)/m.exec(leer('../../README.md'))?.[1]

  it('tiene formato semántico', () => { expect(backend).toMatch(/^\d+\.\d+\.\d+$/) })
  it('Code.gs, package.json, package-lock.json, la pantalla de Configuración y la primera «Novedades» del README coinciden', () => {
    expect({ paquete, candado, web, readme }).toEqual({ paquete: backend, candado: backend, web: backend, readme: backend })
  })
})
