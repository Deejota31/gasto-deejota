import { useState, type ReactNode } from 'react'
import {
  Activity, Bell, CalendarDays, CheckCircle2, CircleAlert, Coins, Database, Download, ExternalLink, FileSpreadsheet, Globe2,
  Info, KeyRound, Link2, Loader2, Palette, Plus, RefreshCw, Save, Settings, ShieldCheck, Tags, Unplug, Wallet,
} from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Caja, FiltroCampo } from '../lib/types'
import { saveConnection, type Connection } from '../lib/api'
import { Button, Card, ErrorBox, Field, inputCls, Select, Switch } from '../components/ui'
import { toCsv } from './Gastos'
import { showToast } from '../lib/toast'
import { sortMedios, medioLook } from '../lib/visual'

export const APP_VERSION = '1.4.0'
const FILTROS: FiltroCampo[] = ['Todos', 'Ámbito', 'Categoría', 'Subcategoría', 'Medio de pago']

/** Rótulo de campo con icono: misma jerarquía en todas las secciones. */
function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 [&>svg]:size-3.5 [&>svg]:text-muted">{icon}{children}</span>
}

export default function Configuracion({ store, conn, onConnect, notify, goCategorias }: {
  store: AppStore; conn: Connection | null; onConnect: (c: Connection | null) => void; notify: (m: string) => void; goCategorias: () => void
}) {
  const cfg = store.data?.config ?? {}
  const [url, setUrl] = useState(conn?.url ?? '')
  const [token, setToken] = useState(conn?.token ?? '')
  const [error, setError] = useState('')
  const [connError, setConnError] = useState('')
  const [busy, setBusy] = useState('')
  const [diag, setDiag] = useState<string>('')

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key)
    setError('')
    try { await fn(); if (ok) notify(ok) } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  function connect() {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())) return setConnError('La URL debe ser la del despliegue: https://script.google.com/macros/s/…/exec')
    if (token.trim().length < 16) return setConnError('El token parece incompleto. Cópialo del registro de setup().')
    setConnError('')
    const c = { url: url.trim(), token: token.trim() }
    saveConnection(c)
    onConnect(c)
    showToast('info', 'Conexión guardada. Sincronizando…')
  }

  // Escrituras sin bloquear: el resultado real llega como notificación arriba a la derecha.
  const saveCfg = (clave: string, valor: string) => store.track(`config:${clave}`,
    { pending: 'Guardando configuración…', ok: 'Configuración guardada correctamente.', error: 'No se pudo guardar la configuración.' },
    () => store.actions.saveConfig(clave, valor))
  const monedas = (cfg.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)
  const estado = store.error ? { tone: 'error', text: 'Con errores' } : store.loading ? { tone: 'sync', text: 'Sincronizando…' } : store.data ? { tone: 'ok', text: conn ? 'Conectado' : 'Modo demostración' } : { tone: 'idle', text: 'Sin datos' }

  return (
    <div className="space-y-4">
      {/* Encabezado compacto con el estado de la conexión */}
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-navy"><Settings className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-ink">Configuración</h1>
          <p className="text-xs text-muted">Personaliza y administra tu espacio financiero.</p>
        </div>
        <StatusPill tone={estado.tone} text={estado.text} />
      </header>

      {error && <ErrorBox message={error} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* A. Conexión */}
        <Card title="Conexión con Google Sheets" icon={<Database className="size-4 text-turquesa" />} className="lg:col-span-2">
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end">
            <Field label="URL de Apps Script (/exec)" htmlFor="cfg-url">
              <input id="cfg-url" className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" />
            </Field>
            <Field label="Token" htmlFor="cfg-token">
              <input id="cfg-token" className={inputCls} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="••••••••" />
            </Field>
            <div className="flex gap-2">
              <Button onClick={connect}><Link2 className="size-4" /> Conectar</Button>
              {conn && <Button variant="outline" onClick={() => { saveConnection(null); onConnect(null); setUrl(''); setToken(''); setConnError('') }}><Unplug className="size-4" /> Desconectar</Button>}
            </div>
          </div>
          {connError && <div className="mt-2"><ErrorBox message={connError} /></div>}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Stat icon={<Activity />} label="Estado de Apps Script" value={store.error ? 'Con errores' : store.loading ? 'Sincronizando…' : store.data ? 'Operativo' : 'Sin datos'} tone={store.error ? 'error' : 'ok'} />
            <Stat icon={<RefreshCw />} label="Última sincronización" value={store.lastSync ? store.lastSync.toLocaleTimeString('es-PE') : '—'} />
            <Stat icon={<ShieldCheck />} label="Versión backend" value={store.data?.version ?? '—'} />
          </div>
          {store.error && <p className="mt-2 text-xs text-[#9B2C24]">{store.error}</p>}
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted"><KeyRound className="size-3.5" />
            {conn ? 'Conectado a tu Apps Script.' : 'Sin conexión: estás viendo datos de demostración en memoria.'} La URL y el token se guardan solo en este navegador.
          </p>
        </Card>

        {/* B. Preferencias */}
        <Card title="Preferencias" icon={<Palette className="size-4 text-morado" />}>
          <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2">
            <Field label={<Label icon={<Coins />}>Moneda principal</Label>} htmlFor="cfg-moneda">
              <Select id="cfg-moneda" label="Moneda principal" value={cfg.moneda || 'PEN'} onChange={v => saveCfg('moneda', v)} options={monedas} />
            </Field>
            <Field label={<Label icon={<Coins />}>Monedas permitidas</Label>} htmlFor="cfg-monedas" hint="Códigos ISO separados por coma">
              <input id="cfg-monedas" className={inputCls} defaultValue={cfg.monedas || 'PEN,USD'} onBlur={e => {
                const v = e.target.value.toUpperCase().split(',').map(s => s.trim()).filter(s => /^[A-Z]{3}$/.test(s)).join(',')
                if (v && v !== cfg.monedas) void saveCfg('monedas', v)
              }} />
            </Field>
            {monedas.filter(m => m !== (cfg.moneda || 'PEN')).filter(m => m === 'USD').map(m => (
              <Field key={m} label={<Label icon={<Coins />}>{`Tipo de cambio ${m} → ${cfg.moneda || 'PEN'}`}</Label>} htmlFor={`cfg-tc-${m}`}>
                <input id={`cfg-tc-${m}`} className={`${inputCls} tabular`} type="number" step="0.0001" min="0" defaultValue={cfg[`tipo_cambio_${m}`] ?? ''}
                  onBlur={e => e.target.value !== (cfg[`tipo_cambio_${m}`] ?? '') && saveCfg(`tipo_cambio_${m}`, e.target.value)} />
              </Field>
            ))}
            <Field label={<Label icon={<Globe2 />}>Zona horaria</Label>} htmlFor="cfg-tz">
              <input id="cfg-tz" className={inputCls} defaultValue={cfg.zona_horaria || 'America/Lima'} onBlur={e => {
                const v = e.target.value.trim()
                try { new Intl.DateTimeFormat('es', { timeZone: v }) } catch { return setError('Zona horaria inválida (ej. America/Lima).') }
                if (v !== cfg.zona_horaria) void saveCfg('zona_horaria', v)
              }} />
            </Field>
            <Field label={<Label icon={<CalendarDays />}>Formato de fecha</Label>} htmlFor="cfg-fecha">
              <Select id="cfg-fecha" label="Formato de fecha" value={cfg.formato_fecha || 'dd/MM/yyyy'} onChange={v => saveCfg('formato_fecha', v)} options={['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']} />
            </Field>
            <Field label={<Label icon={<Palette />}>Tema visual</Label>} htmlFor="cfg-tema">
              <Select id="cfg-tema" label="Tema visual" value={cfg.tema || 'claro'} onChange={v => saveCfg('tema', v)} options={['claro', 'oscuro']} />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-bg/60 px-3 py-2.5">
            <Bell className="size-4 shrink-0 text-muted" />
            <Switch checked={cfg.notificaciones !== 'false'} onChange={v => saveCfg('notificaciones', String(v))} label="Mostrar notificaciones al guardar" />
          </div>
          <p className="mt-2 text-[11px] text-muted">Solo USD tiene tipo de cambio configurable. Los errores siempre se notifican.</p>
        </Card>

        {/* D. Medios de pago */}
        <Card title="Medios de pago" icon={<Wallet className="size-4 text-coral" />}>
          <MediosEditor store={store} />
        </Card>

        {/* C. Cajas y presupuestos */}
        <Card title="Cajas y presupuestos" icon={<Wallet className="size-4 text-lima" />} className="lg:col-span-2">
          <div className="grid gap-3 md:grid-cols-2">
            {[...(store.data?.cajas ?? [])].sort((a, b) => a.orden - b.orden).map(c => (
              <CajaRow key={c.id} caja={c} simbolo={(cfg.moneda || 'PEN') === 'PEN' ? 'S/' : cfg.moneda === 'USD' ? 'US$' : cfg.moneda} busy={store.pending.has(`caja:${c.id}`)}
                onSave={next => store.track(`caja:${c.id}`, { pending: `Guardando ${next.nombre}…`, ok: `${next.nombre} guardada correctamente.`, error: `No se pudo guardar ${next.nombre}.` }, () => store.actions.saveCaja(next))} />
            ))}
            {!store.data?.cajas.length && <p className="text-sm text-muted">No hay cajas configuradas.</p>}
          </div>
          <p className="mt-3 text-[11px] text-muted">El presupuesto es mensual. La caja general es el total; las demás son reservas dentro de ella. Para cambiar solo un mes usa el lápiz de la caja en el Dashboard.</p>
        </Card>

        {/* E. Datos */}
        <Card title="Administración de datos" icon={<FileSpreadsheet className="size-4 text-turquesa" />} className="lg:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Action icon={<Activity />} title="Diagnóstico" desc="Filas por hoja y estado" loading={busy === 'diag'}
              onClick={() => run('diag', async () => setDiag(JSON.stringify(await store.actions.diagnose(), null, 2)))} />
            <Action icon={<ShieldCheck />} title="Crear respaldo" desc="Copia completa en tu Drive" loading={busy === 'backup'}
              onClick={() => run('backup', async () => { const r = await store.actions.backup(); window.open(r.url, '_blank', 'noopener') }, 'Respaldo creado en tu Google Drive')} />
            <Action icon={<Download />} title="Exportar todo (CSV)" desc="Todo el historial" disabled={!store.data} onClick={() => {
              const blob = new Blob([toCsv(store.data!.gastos)], { type: 'text/csv;charset=utf-8' })
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gastos-completo.csv'; a.click(); URL.revokeObjectURL(a.href)
            }} />
            <Action icon={<Tags />} title="Administrar categorías" desc="Ámbitos, categorías y subcategorías" onClick={goCategorias} />
            {store.data?.sheetUrl
              ? <a href={store.data.sheetUrl} target="_blank" rel="noopener noreferrer" className={ACTION_CLS}><ActionBody icon={<ExternalLink />} title="Abrir hoja" desc="Google Sheets" /></a>
              : <Action icon={<ExternalLink />} title="Abrir hoja" desc="Disponible al conectar" disabled onClick={() => {}} />}
          </div>
          {diag && <pre className="mt-3 max-h-60 overflow-auto rounded-xl bg-bg p-3 text-xs">{diag}</pre>}
        </Card>

        {/* F. Acerca de */}
        <Card title="Acerca de" icon={<Info className="size-4 text-muted" />} className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div><dt className="text-muted">Aplicación</dt><dd className="font-medium">Gasto Deejota</dd></div>
            <div><dt className="text-muted">Versión web</dt><dd className="tabular font-medium">v{APP_VERSION}</dd></div>
            <div><dt className="text-muted">Versión backend</dt><dd className="tabular font-medium">{store.data?.version ?? '—'}</dd></div>
            <div><dt className="text-muted">Zona horaria</dt><dd className="font-medium">{cfg.zona_horaria || 'America/Lima'}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  )
}

function StatusPill({ tone, text }: { tone: string; text: string }) {
  const s = tone === 'error' ? 'bg-[#FDF0EF] text-[#9B2C24]' : tone === 'sync' ? 'bg-primary-soft text-navy' : tone === 'ok' ? 'bg-[#EEF9F2] text-[#17603A]' : 'bg-bg text-muted'
  const Icon = tone === 'error' ? CircleAlert : tone === 'sync' ? Loader2 : CheckCircle2
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s}`}><Icon className={`size-3.5 ${tone === 'sync' ? 'animate-spin' : ''}`} />{text}</span>
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: 'ok' | 'error' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2">
      <span className="text-muted [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted">{label}</p>
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {tone && <span className={`size-2 shrink-0 rounded-full ${tone === 'ok' ? 'bg-lima' : 'bg-[#D2463C]'}`} aria-hidden />}{value}
        </p>
      </div>
    </div>
  )
}

const ACTION_CLS = 'flex items-start gap-3 rounded-xl border border-line bg-card p-3 text-left transition hover:border-navy/40 hover:bg-bg focus-visible:outline-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-50'
function ActionBody({ icon, title, desc, loading }: { icon: ReactNode; title: string; desc: string; loading?: boolean }) {
  return <>
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-navy [&>svg]:size-4">{loading ? <Loader2 className="animate-spin" /> : icon}</span>
    <span className="min-w-0"><span className="block text-sm font-medium text-ink">{title}</span><span className="block text-[11px] text-muted">{desc}</span></span>
  </>
}
function Action({ onClick, disabled, ...b }: { icon: ReactNode; title: string; desc: string; loading?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={ACTION_CLS} onClick={onClick} disabled={disabled || b.loading}><ActionBody {...b} /></button>
}

function CajaRow({ caja, busy, onSave, simbolo }: { caja: Caja; busy: boolean; onSave: (c: Caja) => void; simbolo: string }) {
  const [c, setC] = useState(caja)
  const [base, setBase] = useState(caja)
  // Si la caja cambia en el servidor (guardado confirmado, "Actualizar"), se sincroniza solo si no estás editando.
  if (caja !== base) { setBase(caja); if (JSON.stringify(c) === JSON.stringify(base)) setC(caja) }
  const dirty = JSON.stringify(c) !== JSON.stringify(caja)
  const general = caja.filtroCampo === 'Todos'
  return (
    <div className="rounded-xl border border-line p-3" style={{ borderLeft: `4px solid ${c.color}` }}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`Color de ${caja.nombre}`} value={c.color} onChange={e => setC({ ...c, color: e.target.value })} className="size-8 shrink-0 cursor-pointer rounded-lg border border-line bg-card p-0.5" />
        <input aria-label="Nombre" className={`${inputCls} font-semibold`} value={c.nombre} onChange={e => setC({ ...c, nombre: e.target.value })} />
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${general ? 'bg-primary-soft text-navy' : 'bg-bg text-muted'}`}>{general ? 'General' : 'Reserva'}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-muted">Presupuesto mensual
          <span className="relative mt-1 block">
            <span className="pointer-events-none absolute top-2 left-3 text-sm text-muted">{simbolo}</span>
            <input aria-label="Presupuesto" className={`${inputCls} tabular pl-8`} type="number" min="0" step="0.01" value={c.presupuesto} onChange={e => setC({ ...c, presupuesto: Number(e.target.value) })} />
          </span>
        </label>
        <label className="text-[11px] text-muted">Alcance
          <span className="mt-1 block"><Select label="Alcance" value={c.filtroCampo} onChange={v => setC({ ...c, filtroCampo: v as FiltroCampo, filtroValor: v === 'Todos' ? '' : c.filtroValor })} options={FILTROS} /></span>
        </label>
        <label className="col-span-2 text-[11px] text-muted sm:col-span-1">Valor
          <input aria-label="Valor del filtro" className={`${inputCls} mt-1`} disabled={c.filtroCampo === 'Todos'} value={c.filtroValor} placeholder={c.filtroCampo === 'Todos' ? 'Todos los gastos' : 'Ej. Auto'} onChange={e => setC({ ...c, filtroValor: e.target.value })} />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty && <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setC(caja)}>Descartar</button>}
        <Button className="px-3 py-1.5 text-xs" variant={dirty ? 'primary' : 'outline'} disabled={!dirty || busy} loading={busy} onClick={() => onSave(c)} aria-label={`Guardar ${caja.nombre}`}>
          <Save className="size-3.5" /> {busy ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Sin cambios'}
        </Button>
      </div>
    </div>
  )
}

function MediosEditor({ store }: { store: AppStore }) {
  const [nuevo, setNuevo] = useState('')
  const raw = store.data?.medios ?? []
  const medios = sortMedios(raw.map(m => m.nombre)).map(n => raw.find(m => m.nombre === n)!).filter(m => m && m.nombre.trim())
  const save = (nombre: string, activo: boolean) => store.track(`medio:${nombre.toLowerCase()}`,
    { pending: 'Guardando medio de pago…', ok: 'Medio de pago guardado correctamente.', error: 'No se pudo guardar el medio de pago.' },
    () => store.actions.saveMedio({ nombre, activo }))
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Medios de pago">
        {medios.map(m => {
          const { Icon, color } = medioLook(m.nombre)
          const busy = store.pending.has(`medio:${m.nombre.toLowerCase()}`)
          return (
            <li key={m.nombre}>
              <button type="button" onClick={() => save(m.nombre, !m.activo)} disabled={busy} aria-pressed={m.activo}
                title={m.activo ? 'Activo: toca para desactivar' : 'Inactivo: toca para reactivar'}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition ${m.activo ? 'border-line bg-card hover:bg-bg' : 'border-dashed border-line bg-bg/50 text-muted'}`}>
                <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: m.activo ? `${color}1F` : undefined, color: m.activo ? color : undefined }}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
                </span>
                <span className={`min-w-0 flex-1 truncate font-medium ${m.activo ? '' : 'line-through'}`}>{m.nombre}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (nuevo.trim()) { void save(nuevo.trim(), true); setNuevo('') } }}>
        <input aria-label="Nuevo medio de pago" className={inputCls} maxLength={40} value={nuevo} onChange={e => setNuevo(e.target.value)} placeholder="Nuevo medio de pago" />
        <Button type="submit" variant="soft" disabled={!nuevo.trim()}><Plus className="size-4" /> Agregar</Button>
      </form>
      <p className="text-[11px] text-muted">Toca un medio para activarlo o desactivarlo. “Otros” siempre va al final.</p>
    </div>
  )
}
