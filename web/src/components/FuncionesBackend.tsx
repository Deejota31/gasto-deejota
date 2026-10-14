import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, KeyRound, Loader2, Maximize2, Minimize2, Play, Terminal } from 'lucide-react'
import { showToast } from '../lib/toast'
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

const GRUPO_DESC: Record<(typeof GRUPOS)[number], string> = {
  'Conexión y archivos': 'Dónde está tu proyecto y permisos',
  'Mantenimiento de la hoja': 'Diagnóstico, reparaciones y catálogo',
  'Atajo de iPhone': 'Token de tu atajo',
  'Datos de prueba': 'Ejemplos que se pueden borrar',
}

export function FuncionesBackend({ store, className = '' }: { store: AppStore; className?: string }) {
  const [busy, setBusy] = useState('')
  const [pide, setPide] = useState('')
  const [res, setRes] = useState<Resultado | null>(null)
  const [copiado, setCopiado] = useState('')
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())   // los 4 grupos inician contraídos
  const [consola, setConsola] = useState(false)                       // la consola inicia compacta
  const [estados, setEstados] = useState<Record<string, 'ok' | 'error'>>({})
  const [ancho, setAncho] = useState(false)       // consola expandida

  const alternar = (g: string) => setAbiertos(a => { const n = new Set(a); if (!n.delete(g)) n.add(g); return n })

  async function ejecutar(f: Funcion) {
    setPide(''); setBusy(f.nombre); setConsola(true)
    const t0 = performance.now()
    try {
      const r = f.nombre === 'completarVacios' ? await store.actions.completarVacios() : await store.actions.ejecutarFuncion(f.nombre, !!f.cambiaHoja)
      setEstados(e => ({ ...e, [f.nombre]: 'ok' }))
      setRes({ nombre: f.nombre, ok: true, texto: JSON.stringify(r ?? { ok: true }, null, 2), ms: Math.round(performance.now() - t0), secretos: secretos(r) })
      if (f.nombre === 'completarVacios') {
        const total = (r as { total?: number } | undefined)?.total ?? 0
        showToast('success', total ? `Hoja completada: ${total} fila(s) con valores que estaban vacíos.` : 'La hoja ya no tiene celdas vacías por completar.')
      } else showToast('success', `${f.titulo}: ejecutada correctamente.`)
    } catch (e) {
      setEstados(e => ({ ...e, [f.nombre]: 'error' }))
      setRes({ nombre: f.nombre, ok: false, texto: (e as Error).message, ms: Math.round(performance.now() - t0), secretos: [] })
      showToast('error', `${f.titulo}: ${(e as Error).message}`)
    } finally { setBusy('') }
  }
  async function copiar(texto: string, clave: string) {
    try { await navigator.clipboard.writeText(texto); setCopiado(clave); setTimeout(() => setCopiado(''), 1500) } catch { /* sin permiso de portapapeles */ }
  }

  return (
    <Card title="Funciones del backend" icon={<Terminal className="size-4 text-turquesa" />} className={className}
      info={{ title: 'Funciones del backend', body: <p>Son las funciones de tu Code.gs que antes ejecutabas desde el editor de Apps Script. Aquí las llamas con un clic y ves su respuesta (tokens, URLs, conteos…) en la consola de resultados.</p> }}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start" data-testid="funciones-backend">
        <div className="min-w-0 space-y-2">
          {GRUPOS.map(g => {
            const fs = FUNCIONES.filter(f => f.grupo === g)
            const abierto = abiertos.has(g)
            return (
              <section key={g} aria-label={g} className="rounded-xl border border-line">
                <button type="button" aria-expanded={abierto} onClick={() => alternar(g)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-bg">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{g} <span className="ml-1 rounded-full bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-muted" title="Funciones del grupo">{fs.length} función{fs.length === 1 ? '' : 'es'}</span></span>
                    <span className="block text-[11px] text-muted">{GRUPO_DESC[g]}</span>
                  </span>
                  {(() => {
                    const err = fs.filter(f => estados[f.nombre] === 'error').length, ok = fs.filter(f => estados[f.nombre] === 'ok').length
                    return err ? <span className="shrink-0 rounded-full bg-[#FDECEC] px-2 py-0.5 text-[10px] font-semibold text-[#C0362C]" data-testid="estado-grupo">{err} con error</span>
                      : ok ? <span className="shrink-0 rounded-full bg-[#E7F7F2] px-2 py-0.5 text-[10px] font-semibold text-[#0F8A6B]" data-testid="estado-grupo">{ok} ejecutada{ok === 1 ? '' : 's'}</span>
                      : <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[10px] font-medium text-muted" data-testid="estado-grupo">Sin ejecutar</span>
                  })()}
                  <ChevronDown className={`size-4 shrink-0 text-muted transition ${abierto ? 'rotate-180' : ''}`} />
                </button>
                {abierto && (
                  <ul className="space-y-1.5 border-t border-line p-2">
                    {fs.map(f => (
                      <li key={f.nombre} className="flex items-center gap-2 rounded-lg bg-bg/50 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{f.titulo} <code className="ml-1 rounded bg-card px-1 py-0.5 text-[10px] font-normal text-muted">{f.nombre}()</code></p>
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
                )}
              </section>
            )
          })}
        </div>
        {/* Consola de resultados: plegable; compacta al inicio, se abre sola al ejecutar una función */}
        <div aria-live="polite" data-testid="funcion-resultado" className="rounded-xl border border-line p-3 lg:sticky lg:top-20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" aria-expanded={consola} aria-controls="consola-cuerpo" onClick={() => setConsola(v => !v)} className="flex min-w-0 items-center gap-1.5 rounded-md text-left hover:text-ink">
              <ChevronDown className={`size-4 shrink-0 text-muted transition ${consola ? 'rotate-180' : ''}`} />
              <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">Consola de resultados</span>
              {!consola && <span className="truncate text-[11px] text-muted">{res ? `· ${res.nombre}() ${res.ok ? 'OK' : 'con error'}` : '· sin resultados'}</span>}
            </button>
            {consola && (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                {res && <button type="button" aria-label="Copiar resultado" onClick={() => void copiar(res.texto, 'todo')} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-bg">
                  {copiado === 'todo' ? <Check className="size-3" /> : <Copy className="size-3" />} Copiar
                </button>}
                <button type="button" aria-pressed={ancho} aria-label={ancho ? 'Contraer resultado' : 'Expandir resultado'} onClick={() => setAncho(v => !v)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-bg">
                  {ancho ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />} {ancho ? 'Contraer' : 'Expandir'}
                </button>
              </span>
            )}
          </div>
          {consola && (
            <div id="consola-cuerpo" className="mt-2">
              {res && <p className="mb-2 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                <code className="rounded bg-bg px-1 py-0.5">{res.nombre}()</code><span>{res.ms} ms</span>
                <span className={res.ok ? 'font-semibold text-[#0F8A6B]' : 'font-semibold text-[#C0362C]'}>{res.ok ? 'OK' : 'Error'}</span>
              </p>}
              {res?.secretos.map((s, i) => (
                <button key={i} type="button" onClick={() => void copiar(s, `s${i}`)}
                  className="mb-1.5 flex w-full items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-left text-xs font-medium text-navy">
                  <KeyRound className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate font-mono">{s}</span>{copiado === `s${i}` ? 'Copiado' : 'Copiar token'}
                </button>
              ))}
              <pre className={`${ancho ? 'max-h-[70vh]' : 'max-h-56'} min-h-16 overflow-auto rounded-xl p-3 text-xs break-words whitespace-pre-wrap ${res && !res.ok ? 'bg-[#FDECEC] text-[#C0362C]' : 'bg-bg text-ink'}`}>{res ? res.texto : 'Ejecuta una función y su respuesta aparecerá aquí.'}</pre>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
