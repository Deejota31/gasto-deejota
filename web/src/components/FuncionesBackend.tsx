import { useState } from 'react'
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Play, Terminal } from 'lucide-react'
import type { AppStore } from '../lib/store'
import { Button, Card } from './ui'

interface Funcion {
  nombre: string                  // nombre de la función en Code.gs
  titulo: string
  desc: string
  grupo: 'Conexión y archivos' | 'Mantenimiento de la hoja' | 'Atajo de iPhone' | 'Datos de prueba'
  cambiaHoja?: boolean            // relee los datos al terminar
  confirmar?: string              // pide confirmación antes de ejecutar
}

/** Todas las funciones de Code.gs que se ejecutaban desde el editor de Apps Script. */
export const FUNCIONES: Funcion[] = [
  { grupo: 'Conexión y archivos', nombre: 'misArchivos', titulo: 'Mis archivos', desc: 'Dónde está el proyecto, la hoja y la URL /exec. No modifica nada.' },
  { grupo: 'Conexión y archivos', nombre: 'setup', titulo: 'Instalar / verificar (setup)', desc: 'Crea las hojas que falten y devuelve el token de la API.', cambiaHoja: true },
  { grupo: 'Conexión y archivos', nombre: 'autorizarRespaldos', titulo: 'Autorizar respaldos', desc: 'Da permiso a Drive y muestra la carpeta donde se guardan.' },
  { grupo: 'Mantenimiento de la hoja', nombre: 'diagnose', titulo: 'Diagnóstico', desc: 'Filas por hoja, versión y estado.' },
  { grupo: 'Mantenimiento de la hoja', nombre: 'completarVacios', titulo: 'Completar vacíos', desc: 'Rellena las celdas vacías (Activo, Icono, Orden, Medio…).', cambiaHoja: true },
  { grupo: 'Mantenimiento de la hoja', nombre: 'migrarPlantillas', titulo: 'Migrar plantillas', desc: 'Actualiza el esquema de PLANTILLAS_MENSUALES si es antiguo.', cambiaHoja: true },
  { grupo: 'Mantenimiento de la hoja', nombre: 'actualizarCatalogo', titulo: 'Actualizar catálogo', desc: 'Agrega la columna Orden y ordena el catálogo. Crea respaldo antes.', cambiaHoja: true },
  { grupo: 'Mantenimiento de la hoja', nombre: 'repararIds', titulo: 'Reparar IDs', desc: 'Asigna ID a movimientos sin ID o repetidos. Crea respaldo antes.', cambiaHoja: true },
  { grupo: 'Mantenimiento de la hoja', nombre: 'repararHojas', titulo: 'Reparar hojas', desc: 'Compacta filas, agrega columnas y reordena medios. Crea respaldo antes.', cambiaHoja: true,
    confirmar: 'Reescribe todas las hojas (con respaldo previo). ¿Continuar?' },
  { grupo: 'Atajo de iPhone', nombre: 'crearTokenAtajo', titulo: 'Crear token del atajo', desc: 'Genera un token nuevo (reemplaza al anterior). Cópialo solo en tu iPhone.', confirmar: 'Esto reemplaza el token actual del atajo. ¿Continuar?' },
  { grupo: 'Atajo de iPhone', nombre: 'revocarTokenAtajo', titulo: 'Revocar token del atajo', desc: 'El atajo deja de funcionar hasta crear otro token.', confirmar: 'El atajo de iPhone dejará de funcionar. ¿Continuar?' },
  { grupo: 'Datos de prueba', nombre: 'generarDatosPrueba', titulo: 'Generar datos de prueba', desc: 'Agrega movimientos, catálogo y fuentes de ejemplo (marcados para borrarlos). Crea respaldo.', cambiaHoja: true,
    confirmar: 'Se agregarán datos de ejemplo a tu hoja real. ¿Continuar?' },
  { grupo: 'Datos de prueba', nombre: 'borrarDatosPrueba', titulo: 'Borrar datos de prueba', desc: 'Elimina solo lo marcado como prueba. Crea respaldo antes.', cambiaHoja: true,
    confirmar: 'Se borrarán los datos de prueba marcados. ¿Continuar?' },
]

const GRUPOS = ['Conexión y archivos', 'Mantenimiento de la hoja', 'Atajo de iPhone', 'Datos de prueba'] as const
type Resultado = { nombre: string; ok: boolean; texto: string; ms: number; secretos: string[] }

/** Busca valores que son credenciales (token, apiToken…) para ofrecer copiarlos con un clic. */
function secretos(v: unknown): string[] {
  if (!v || typeof v !== 'object') return []
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => (/token/i.test(k) && typeof x === 'string' ? [x] : []))
}

export function FuncionesBackend({ store, className = '' }: { store: AppStore; className?: string }) {
  const [busy, setBusy] = useState('')
  const [pide, setPide] = useState('')
  const [res, setRes] = useState<Resultado | null>(null)
  const [copiado, setCopiado] = useState('')

  async function ejecutar(f: Funcion) {
    setPide(''); setBusy(f.nombre)
    const t0 = performance.now()
    try {
      const r = f.nombre === 'completarVacios' ? await store.actions.completarVacios() : await store.actions.ejecutarFuncion(f.nombre, !!f.cambiaHoja)
      setRes({ nombre: f.nombre, ok: true, texto: JSON.stringify(r ?? { ok: true }, null, 2), ms: Math.round(performance.now() - t0), secretos: secretos(r) })
    } catch (e) {
      setRes({ nombre: f.nombre, ok: false, texto: (e as Error).message, ms: Math.round(performance.now() - t0), secretos: [] })
    } finally { setBusy('') }
  }
  async function copiar(texto: string, clave: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(clave); setTimeout(() => setCopiado(''), 1500) } catch { /* sin permiso de portapapeles */ }
  }

  return (
    <Card title="Funciones del backend" icon={<Terminal className="size-4 text-turquesa" />} className={className}
      info={{ title: 'Funciones del backend', body: <p>Son las funciones de tu Code.gs que antes ejecutabas desde el editor de Apps Script. Aquí las llamas con un clic y ves su respuesta (tokens, URLs, conteos…) debajo.</p> }}>
      <div className="space-y-4" data-testid="funciones-backend">
        {GRUPOS.map(g => (
          <section key={g} aria-label={g}>
            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{g}</p>
            <ul className="space-y-1.5">
              {FUNCIONES.filter(f => f.grupo === g).map(f => (
                <li key={f.nombre} className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{f.titulo} <code className="ml-1 rounded bg-bg px-1 py-0.5 text-[10px] font-normal text-muted">{f.nombre}()</code></p>
                    <p className="text-[11px] text-muted">{pide === f.nombre ? <span className="font-medium text-[#B7791F]"><AlertTriangle className="mr-1 inline size-3" />{f.confirmar}</span> : f.desc}</p>
                  </div>
                  {pide === f.nombre ? (
                    <span className="flex shrink-0 gap-1">
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setPide('')}>Cancelar</Button>
                      <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => void ejecutar(f)}>Confirmar</Button>
                    </span>
                  ) : (
                    <Button variant="soft" className="shrink-0 !px-2.5 !py-1.5 text-xs" aria-label={`Ejecutar ${f.nombre}`} disabled={!!busy || !store.data}
                      onClick={() => f.confirmar ? setPide(f.nombre) : void ejecutar(f)}>
                      {busy === f.nombre ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Ejecutar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div aria-live="polite" data-testid="funcion-resultado">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Resultado</p>
            {res && <span className="flex items-center gap-2 text-[11px] text-muted">
              <code>{res.nombre}()</code> · {res.ms} ms · <span className={res.ok ? 'font-semibold text-[#0F8A6B]' : 'font-semibold text-[#C0362C]'}>{res.ok ? 'OK' : 'Error'}</span>
              <button type="button" aria-label="Copiar resultado" onClick={() => void copiar(res.texto, 'todo')} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-bg">
                {copiado === 'todo' ? <Check className="size-3" /> : <Copy className="size-3" />} Copiar
              </button>
            </span>}
          </div>
          {res?.secretos.map((s, i) => (
            <button key={i} type="button" onClick={() => void copiar(s, `s${i}`)}
              className="mb-1.5 flex w-full items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-left text-xs font-medium text-navy">
              <KeyRound className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate font-mono">{s}</span>{copiado === `s${i}` ? 'Copiado' : 'Copiar token'}
            </button>
          ))}
          <pre className={`max-h-64 min-h-16 overflow-auto rounded-xl p-3 text-xs break-words whitespace-pre-wrap ${res && !res.ok ? 'bg-[#FDECEC] text-[#C0362C]' : 'bg-bg text-ink'}`}>{res ? res.texto : 'Ejecuta una función y su respuesta aparecerá aquí.'}</pre>
        </div>
      </div>
    </Card>
  )
}
