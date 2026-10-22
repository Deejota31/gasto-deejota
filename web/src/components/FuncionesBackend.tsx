import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, KeyRound, Loader2, Lock, Maximize2, Minimize2, Play, Terminal } from 'lucide-react'
import { showToast } from '../lib/toast'
import type { AppStore } from '../lib/store'
import { Button, Card, Field, SelectField, inputCls } from './ui'
import { PRUEBA_MAX_MESES, PRUEBA_MAX_REGISTROS, mesesEntre, periodoPorDefecto, validarPrueba } from '../lib/datosPrueba'
import { todayIn } from '../lib/dates'

interface Funcion {
  nombre: string                  // nombre de la función en Code.gs
  titulo: string
  desc: string
  grupo: 'Conexión y archivos' | 'Mantenimiento de la hoja' | 'Atajo de iPhone' | 'Datos de prueba'
  cambiaHoja?: boolean            // relee los datos al terminar
  confirmar?: string              // pide confirmación antes de ejecutar
  admin?: boolean                 // exige el token de administración (S-04)
  parametros?: 'datosPrueba' | 'retirarCajas'   // abre un formulario en lugar de la confirmación simple
}

/** Todas las funciones de Code.gs que se ejecutaban desde el editor de Apps Script. */
export const FUNCIONES: Funcion[] = [
  { grupo: 'Conexión y archivos', nombre: 'misArchivos', titulo: 'Mis archivos', desc: 'Dónde está el proyecto, la hoja y la URL /exec. No modifica nada.' },
  { grupo: 'Conexión y archivos', nombre: 'setup', admin: true, titulo: 'Instalar / verificar (setup)', desc: 'Crea las hojas que falten y devuelve el token de la API.', cambiaHoja: true },
  { grupo: 'Conexión y archivos', nombre: 'autorizarRespaldos', titulo: 'Autorizar respaldos', desc: 'Da permiso a Drive y muestra la carpeta donde se guardan.' },
  { grupo: 'Mantenimiento de la hoja', nombre: 'diagnose', titulo: 'Diagnóstico', desc: 'Filas por hoja, versión y estado.' },
  { grupo: 'Mantenimiento de la hoja', nombre: 'completarVacios', titulo: 'Completar vacíos', desc: 'Rellena las celdas vacías (Activo, Icono, Orden, Medio…).', cambiaHoja: true },
  { grupo: 'Mantenimiento de la hoja', nombre: 'repararIds', admin: true, titulo: 'Reparar IDs', desc: 'Asigna ID a movimientos sin ID o repetidos. Crea respaldo antes.', cambiaHoja: true },
  { grupo: 'Mantenimiento de la hoja', nombre: 'repararHojas', admin: true, titulo: 'Reparar hojas', desc: 'Compacta filas, agrega columnas y reordena medios. Crea respaldo antes.', cambiaHoja: true,
    confirmar: 'Reescribe todas las hojas (con respaldo previo). ¿Continuar?' },
  { grupo: 'Mantenimiento de la hoja', nombre: 'retirarCajas', admin: true, titulo: 'Retirar cajas (migración 1.28)', parametros: 'retirarCajas', cambiaHoja: true,
    desc: 'Primero simula: muestra qué cajas, subcajas y presupuestos antiguos hay y qué haría. Aplicar crea un respaldo y solo archiva esas hojas (no borra datos ni gastos).' },
  { grupo: 'Atajo de iPhone', nombre: 'crearTokenAtajo', admin: true, titulo: 'Crear token del atajo', desc: 'Genera un token nuevo (reemplaza al anterior). Cópialo solo en tu iPhone.', confirmar: 'Esto reemplaza el token actual del atajo. ¿Continuar?' },
  { grupo: 'Atajo de iPhone', nombre: 'revocarTokenAtajo', admin: true, titulo: 'Revocar token del atajo', desc: 'El atajo deja de funcionar hasta crear otro token.', confirmar: 'El atajo de iPhone dejará de funcionar. ¿Continuar?' },
  { grupo: 'Datos de prueba', nombre: 'generarDatosPrueba', admin: true, titulo: 'Agregar datos de prueba', desc: 'Agrega la cantidad de gastos que indiques, repartidos en el período que elijas, con un presupuesto de prueba por mes. Se marcan para poder borrarlos. Crea respaldo.', cambiaHoja: true, parametros: 'datosPrueba' },
  { grupo: 'Datos de prueba', nombre: 'generarCasosEspecialesPrueba', admin: true, titulo: 'Agregar casos especiales de Salud financiera', desc: 'Agrega los casos de ejemplo de jul–sep 2026 (compromisos, errores de calidad, duplicados). Crea respaldo.', cambiaHoja: true,
    confirmar: 'Se agregarán datos de ejemplo a tu hoja real. ¿Continuar?' },
  { grupo: 'Datos de prueba', nombre: 'borrarDatosPrueba', admin: true, titulo: 'Borrar datos de prueba', desc: 'Elimina solo lo marcado como prueba. Crea respaldo antes.', cambiaHoja: true,
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

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** Mes + año en dos listas (el selector nativo de mes no existe en todos los navegadores). Valor: AAAA-MM. */
function SelectorMes({ id, etiqueta, value, onChange, anios }: { id: string; etiqueta: string; value: string; onChange: (v: string) => void; anios: number[] }) {
  const [y, m] = value.split('-')
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-medium text-muted">{etiqueta}</legend>
      <div className="grid grid-cols-[1fr_6.75rem] gap-1.5">
        <SelectField id={`${id}-mes`} label={`${etiqueta}: mes`} value={m} onChange={v => onChange(`${y}-${v}`)}>
          {MESES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>)}
        </SelectField>
        <SelectField id={`${id}-anio`} label={`${etiqueta}: año`} value={y} onChange={v => onChange(`${v}-${m}`)}>
          {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
        </SelectField>
      </div>
    </fieldset>
  )
}

/** Retirar cajas: simulación por defecto; aplicar exige marcar que ya revisaste la simulación. */
function FormRetirarCajas({ ocupado, onCancelar, onEnviar }: { ocupado: boolean; onCancelar: () => void; onEnviar: (aplicar: boolean) => void }) {
  const [revisado, setRevisado] = useState(false)
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-card p-2.5 text-[11px] text-muted" data-testid="form-retirar-cajas">
      <p>1. <b>Simular</b> no escribe nada: lista las hojas antiguas y si se crearía un fondo General (solo cuando no existe ningún fondo).</p>
      <p>2. <b>Aplicar</b> hace un respaldo completo y renombra las hojas antiguas como archivo. No toca gastos, fondos ni importes. Hazlo después de publicar el Code.gs 1.28.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={revisado} onChange={e => setRevisado(e.target.checked)} /> Ya revisé la simulación y tengo el respaldo</label>
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onCancelar}>Cancelar</Button>
        <Button variant="soft" className="!px-2 !py-1 text-xs" disabled={ocupado} onClick={() => onEnviar(false)}>Simular</Button>
        <Button variant="danger" className="!px-2 !py-1 text-xs" disabled={ocupado || !revisado} onClick={() => onEnviar(true)}>Aplicar</Button>
      </div>
    </div>
  )
}

/** Formulario de «Agregar datos de prueba»: cuántos registros y para qué meses. Valida igual que el backend antes de enviar. */
function FormDatosPrueba({ ocupado, onCancelar, onEnviar }: { ocupado: boolean; onCancelar: () => void; onEnviar: (p: { cantidad: number; desde: string; hasta: string }) => void }) {
  const hoy = todayIn()
  const [cantidad, setCantidad] = useState('60')
  const [per, setPer] = useState(periodoPorDefecto(hoy))
  const [intento, setIntento] = useState(false)
  const anioActual = Number(hoy.slice(0, 4))
  const anios = Array.from({ length: 12 }, (_, i) => anioActual - 9 + i)
  const v = validarPrueba({ cantidad, desde: per.desde, hasta: per.hasta })
  const err = !v.ok && intento ? v.errores : {}
  const n = v.ok ? v.meses : mesesEntre(per.desde, per.hasta).length
  const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1].toLowerCase()} de ${m.slice(0, 4)}`
  return (
    <form data-testid="form-datos-prueba" noValidate className="mt-2 space-y-3 border-t border-line pt-3"
      onSubmit={e => { e.preventDefault(); setIntento(true); if (v.ok) onEnviar(v.valor) }}>
      <Field label="Cantidad de registros" htmlFor="prueba-cantidad" error={err.cantidad} hint={`Entre 1 y ${PRUEBA_MAX_REGISTROS}. Se reparten parejo entre los meses del período.`}>
        <input id="prueba-cantidad" inputMode="numeric" autoComplete="off" className={inputCls} value={cantidad} aria-invalid={!!err.cantidad || undefined}
          onChange={e => setCantidad(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectorMes id="prueba-desde" etiqueta="Desde" value={per.desde} anios={anios} onChange={d => setPer(p => ({ ...p, desde: d }))} />
        <SelectorMes id="prueba-hasta" etiqueta="Hasta" value={per.hasta} anios={anios} onChange={h => setPer(p => ({ ...p, hasta: h }))} />
      </div>
      {err.periodo && <p role="alert" className="text-xs text-danger">{err.periodo}</p>}
      <p className="text-[11px] text-muted" data-testid="resumen-datos-prueba">
        {v.ok
          ? `Se agregarán ${v.valor.cantidad} gastos entre ${nombreMes(v.valor.desde)} y ${nombreMes(v.valor.hasta)} (${n} mes${n === 1 ? '' : 'es'}), más un presupuesto de prueba por mes. Máximo ${PRUEBA_MAX_MESES} meses.`
          : 'Completa la cantidad y el período para ver el resumen.'}
      </p>
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" className="!px-2.5 !py-1.5 text-xs" onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
        <Button type="submit" variant="primary" className="!px-2.5 !py-1.5 text-xs" disabled={ocupado}>
          {ocupado ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Agregar datos de prueba
        </Button>
      </div>
    </form>
  )
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
  const [adminToken, setAdminToken] = useState('')    // solo en memoria: nunca se guarda ni se envía en funciones que no lo piden

  const alternar = (g: string) => setAbiertos(a => { const n = new Set(a); if (!n.delete(g)) n.add(g); return n })

  async function ejecutar(f: Funcion, payload?: Record<string, unknown>) {
    setPide('')
    if (f.admin && !store.isDemo && !adminToken.trim()) {
      showToast('error', `${f.titulo}: escribe el token de administración (arriba). Se crea con crearTokenAdmin() en el editor de Apps Script.`)
      return
    }
    setBusy(f.nombre); setConsola(true)
    const t0 = performance.now()
    try {
      const r = f.nombre === 'completarVacios' ? await store.actions.completarVacios() : await store.actions.ejecutarFuncion(f.nombre, !!f.cambiaHoja, payload, f.admin ? adminToken.trim() : undefined)
      setEstados(e => ({ ...e, [f.nombre]: 'ok' }))
      setRes({ nombre: f.nombre, ok: true, texto: JSON.stringify(r ?? { ok: true }, null, 2), ms: Math.round(performance.now() - t0), secretos: secretos(r) })
      if (f.nombre === 'completarVacios') {
        const total = (r as { total?: number } | undefined)?.total ?? 0
        showToast('success', total ? `Hoja completada: ${total} fila(s) con valores que estaban vacíos.` : 'La hoja ya no tiene celdas vacías por completar.')
      } else if (f.nombre === 'generarDatosPrueba') {
        const x = r as { gastos?: number; desde?: string; hasta?: string } | undefined
        showToast('success', `Se agregaron ${x?.gastos ?? 0} gastos de prueba (${x?.desde} a ${x?.hasta}). Puedes borrarlos con «Borrar datos de prueba».`)
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
          <div className="rounded-xl border border-line p-3">
            <label htmlFor="fb-admin" className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted"><Lock className="size-3.5" /> Token de administración</label>
            <input id="fb-admin" type="password" autoComplete="off" spellCheck={false} className={inputCls} value={adminToken} onChange={e => setAdminToken(e.target.value)}
              placeholder="adm_…" />
            <p className="mt-1 text-[11px] text-muted">Las funciones marcadas con <Lock className="inline size-3" /> lo exigen además del token de la API. Se crea y revoca solo desde el editor de Apps Script (<code>crearTokenAdmin()</code>); aquí no se guarda: se borra al cerrar o recargar la página.</p>
          </div>
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
                    return err ? <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-semibold text-danger" data-testid="estado-grupo">{err} con error</span>
                      : ok ? <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success" data-testid="estado-grupo">{ok} ejecutada{ok === 1 ? '' : 's'}</span>
                      : <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[10px] font-medium text-muted" data-testid="estado-grupo">Sin ejecutar</span>
                  })()}
                  <ChevronDown className={`size-4 shrink-0 text-muted transition ${abierto ? 'rotate-180' : ''}`} />
                </button>
                {abierto && (
                  <ul className="space-y-1.5 border-t border-line p-2">
                    {fs.map(f => (
                      <li key={f.nombre} className="rounded-lg bg-bg/50 px-2.5 py-2">
                       <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{f.titulo} <code className="ml-1 rounded bg-card px-1 py-0.5 text-[10px] font-normal text-muted">{f.nombre}()</code>{f.admin && <Lock className="ml-1 inline size-3 text-muted" aria-label="Requiere token de administración" />}</p>
                          <p className="text-[11px] text-muted">{pide === f.nombre && f.confirmar ? <span className="font-medium text-warning"><AlertTriangle className="mr-1 inline size-3" />{f.confirmar}</span> : f.desc}</p>
                        </div>
                        {pide === f.nombre && f.confirmar ? (
                          <span className="flex shrink-0 gap-1">
                            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setPide('')}>Cancelar</Button>
                            <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => void ejecutar(f)}>Confirmar</Button>
                          </span>
                        ) : (
                          <Button variant="soft" className="shrink-0 !px-2.5 !py-1.5 text-xs" aria-label={`Ejecutar ${f.nombre}`} disabled={!!busy || !store.data}
                            onClick={() => f.parametros || f.confirmar ? setPide(f.nombre) : void ejecutar(f)}>
                            {busy === f.nombre ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Ejecutar
                          </Button>
                        )}
                       </div>
                       {pide === f.nombre && f.parametros === 'retirarCajas' && (
                         <FormRetirarCajas ocupado={busy === f.nombre} onCancelar={() => setPide('')} onEnviar={aplicar => void ejecutar(f, aplicar ? { aplicar: true } : {})} />
                       )}
                       {pide === f.nombre && f.parametros === 'datosPrueba' && (
                         <FormDatosPrueba ocupado={busy === f.nombre} onCancelar={() => setPide('')} onEnviar={p => void ejecutar(f, p)} />
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
                <span className={res.ok ? 'font-semibold text-success' : 'font-semibold text-danger'}>{res.ok ? 'OK' : 'Error'}</span>
              </p>}
              {res?.secretos.map((s, i) => (
                <button key={i} type="button" onClick={() => void copiar(s, `s${i}`)}
                  className="mb-1.5 flex w-full items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-left text-xs font-medium text-navy">
                  <KeyRound className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate font-mono">{s}</span>{copiado === `s${i}` ? 'Copiado' : 'Copiar token'}
                </button>
              ))}
              <pre className={`${ancho ? 'max-h-[70vh]' : 'max-h-56'} min-h-16 overflow-auto rounded-xl p-3 text-xs break-words whitespace-pre-wrap ${res && !res.ok ? 'bg-danger-soft text-danger' : 'bg-bg text-ink'}`}>{res ? res.texto : 'Ejecuta una función y su respuesta aparecerá aquí.'}</pre>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
