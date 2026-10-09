import { useState } from 'react'
import { Activity, Database, Download, ExternalLink, Info, Plus, Save, Tags, Wallet } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { Caja, FiltroCampo } from '../lib/types'
import { saveConnection, type Connection } from '../lib/api'
import { Button, Card, ErrorBox, Field, inputCls, Select } from '../components/ui'
import { toCsv } from './Gastos'
import { sortMedios, medioLook } from '../lib/visual'

export const APP_VERSION = '1.1.0'
const FILTROS: FiltroCampo[] = ['Todos', 'Ámbito', 'Categoría', 'Subcategoría', 'Medio de pago']

export default function Configuracion({ store, conn, onConnect, notify, goCategorias }: {
  store: AppStore; conn: Connection | null; onConnect: (c: Connection | null) => void; notify: (m: string) => void; goCategorias: () => void
}) {
  const cfg = store.data?.config ?? {}
  const [url, setUrl] = useState(conn?.url ?? '')
  const [token, setToken] = useState(conn?.token ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [diag, setDiag] = useState<string>('')

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key)
    setError('')
    try { await fn(); if (ok) notify(ok) } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  function connect() {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())) return setError('La URL debe ser la del despliegue: https://script.google.com/macros/s/…/exec')
    if (token.trim().length < 16) return setError('El token parece incompleto. Cópialo del registro de setup().')
    const c = { url: url.trim(), token: token.trim() }
    saveConnection(c)
    onConnect(c)
    notify('Conexión guardada. Sincronizando…')
  }

  const saveCfg = (clave: string, valor: string) => run(clave, () => store.actions.saveConfig(clave, valor), 'Configuración guardada')
  const monedas = (cfg.monedas || 'PEN,USD').split(',').map(s => s.trim()).filter(Boolean)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {error && <div className="lg:col-span-2"><ErrorBox message={error} /></div>}

      <Card title="Conexión con Google Sheets" icon={<Database className="size-4 text-turquesa" />} className="lg:col-span-2">
        <div className="grid gap-2 md:grid-cols-[2fr_1fr_auto] md:items-end">
          <Field label="URL de Apps Script (/exec)"><input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" /></Field>
          <Field label="Token"><input className={inputCls} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button onClick={connect}><Save className="size-4" /> Conectar</Button>
            {conn && <Button variant="outline" onClick={() => { saveConnection(null); onConnect(null); setUrl(''); setToken('') }}>Desconectar</Button>}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          {conn ? 'Conectado a tu Apps Script.' : 'Sin conexión: estás viendo datos de demostración en memoria.'} La URL y el token se guardan solo en este navegador.
        </p>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <Status label="Estado de Apps Script" value={store.error ? 'Con errores' : store.loading ? 'Sincronizando…' : store.data ? 'Operativo' : 'Sin datos'} ok={!store.error} />
          <Status label="Última sincronización" value={store.lastSync ? store.lastSync.toLocaleTimeString('es-PE') : '—'} ok />
          <Status label="Versión backend" value={store.data?.version ?? '—'} ok />
        </div>
      </Card>

      <Card title="Preferencias">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Moneda principal"><Select label="Moneda principal" value={cfg.moneda || 'PEN'} onChange={v => saveCfg('moneda', v)} options={monedas} /></Field>
          <Field label="Monedas permitidas">
            <input className={inputCls} defaultValue={cfg.monedas || 'PEN,USD'} onBlur={e => {
              const v = e.target.value.toUpperCase().split(',').map(s => s.trim()).filter(s => /^[A-Z]{3}$/.test(s)).join(',')
              if (v && v !== cfg.monedas) void saveCfg('monedas', v)
            }} />
          </Field>
          {monedas.filter(m => m !== (cfg.moneda || 'PEN')).filter(m => m === 'USD').map(m => (
            <Field key={m} label={`Tipo de cambio ${m} → ${cfg.moneda || 'PEN'}`}>
              <input className={inputCls} type="number" step="0.0001" min="0" defaultValue={cfg[`tipo_cambio_${m}`] ?? ''}
                onBlur={e => e.target.value !== (cfg[`tipo_cambio_${m}`] ?? '') && saveCfg(`tipo_cambio_${m}`, e.target.value)} />
            </Field>
          ))}
          <Field label="Zona horaria"><input className={inputCls} defaultValue={cfg.zona_horaria || 'America/Lima'} onBlur={e => {
            const v = e.target.value.trim()
            try { new Intl.DateTimeFormat('es', { timeZone: v }) } catch { return setError('Zona horaria inválida (ej. America/Lima).') }
            if (v !== cfg.zona_horaria) void saveCfg('zona_horaria', v)
          }} /></Field>
          <Field label="Formato de fecha"><Select label="Formato de fecha" value={cfg.formato_fecha || 'dd/MM/yyyy'} onChange={v => saveCfg('formato_fecha', v)} options={['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']} /></Field>
          <Field label="Tema visual"><Select label="Tema visual" value={cfg.tema || 'claro'} onChange={v => saveCfg('tema', v)} options={['claro', 'oscuro']} /></Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.notificaciones !== 'false'} onChange={e => saveCfg('notificaciones', String(e.target.checked))} /> Mostrar notificaciones al guardar
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">Solo USD tiene tipo de cambio configurable; otros códigos requieren agregar su clave en el backend.</p>
      </Card>

      <Card title="Cajas y presupuestos" icon={<Wallet className="size-4 text-lima" />} className="lg:col-span-2">
        <div className="space-y-2">
          {[...(store.data?.cajas ?? [])].sort((a, b) => a.orden - b.orden).map(c => <CajaRow key={c.id} caja={c} busy={busy === c.id} onSave={next => run(c.id, () => store.actions.saveCaja(next), 'Caja guardada')} />)}
        </div>
        <p className="mt-2 text-xs text-muted">El presupuesto es mensual. Para cambiar solo un mes usa el lápiz de la caja en el Dashboard.</p>
      </Card>

      <Card title="Medios de pago">
        <MediosEditor store={store} onError={setError} notify={notify} />
      </Card>

      <Card title="Datos" icon={<Activity className="size-4 text-morado" />}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={busy === 'diag'} onClick={() => run('diag', async () => setDiag(JSON.stringify(await store.actions.diagnose(), null, 2)))}>Diagnóstico</Button>
          <Button variant="outline" loading={busy === 'backup'} onClick={() => run('backup', async () => {
            const r = await store.actions.backup()
            window.open(r.url, '_blank', 'noopener')
          }, 'Respaldo creado en tu Google Drive')}>Crear respaldo</Button>
          <Button variant="outline" disabled={!store.data} onClick={() => {
            const blob = new Blob([toCsv(store.data!.gastos)], { type: 'text/csv;charset=utf-8' })
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gastos-completo.csv'; a.click(); URL.revokeObjectURL(a.href)
          }}><Download className="size-4" /> Exportar todo (CSV)</Button>
          <Button variant="outline" onClick={goCategorias}><Tags className="size-4" /> Administrar categorías</Button>
          {store.data?.sheetUrl && <a className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-turquesa hover:underline" href={store.data.sheetUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" /> Abrir hoja</a>}
        </div>
        {diag && <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-bg p-2 text-xs">{diag}</pre>}
      </Card>

      <Card title="Acerca de" icon={<Info className="size-4 text-muted" />}>
        <p className="text-sm">Gasto Deejota v{APP_VERSION} · backend {store.data?.version ?? '—'}</p>
        <p className="text-xs text-muted">Zona horaria predeterminada America/Lima. Datos en tu Google Sheet.</p>
      </Card>
    </div>
  )
}

function Status({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-line p-2">
      <p className="text-muted">{label}</p>
      <p className="flex items-center gap-1.5 font-medium"><span className={`size-2 rounded-full ${ok ? 'bg-lima' : 'bg-red-500'}`} aria-hidden />{value}</p>
    </div>
  )
}

function CajaRow({ caja, busy, onSave }: { caja: Caja; busy: boolean; onSave: (c: Caja) => void }) {
  const [c, setC] = useState(caja)
  const dirty = JSON.stringify(c) !== JSON.stringify(caja)
  return (
    <div className="grid grid-cols-[auto_1fr_6rem] items-end gap-2 rounded-xl border border-line p-2 sm:grid-cols-[auto_1fr_6rem_8rem_8rem_auto]">
      <input type="color" aria-label="Color" value={c.color} onChange={e => setC({ ...c, color: e.target.value })} className="h-8 w-8 rounded" />
      <input aria-label="Nombre" className={inputCls} value={c.nombre} onChange={e => setC({ ...c, nombre: e.target.value })} />
      <input aria-label="Presupuesto" className={`${inputCls} tabular`} type="number" min="0" step="0.01" value={c.presupuesto} onChange={e => setC({ ...c, presupuesto: Number(e.target.value) })} />
      <Select label="Filtrar por" value={c.filtroCampo} onChange={v => setC({ ...c, filtroCampo: v as FiltroCampo, filtroValor: v === 'Todos' ? '' : c.filtroValor })} options={FILTROS} />
      <input aria-label="Valor del filtro" className={inputCls} disabled={c.filtroCampo === 'Todos'} value={c.filtroValor} onChange={e => setC({ ...c, filtroValor: e.target.value })} />
      <Button variant={dirty ? 'primary' : 'outline'} disabled={!dirty} loading={busy} onClick={() => onSave(c)} aria-label={`Guardar ${caja.nombre}`}><Save className="size-4" /></Button>
    </div>
  )
}

function MediosEditor({ store, onError, notify }: { store: AppStore; onError: (m: string) => void; notify: (m: string) => void }) {
  const [nuevo, setNuevo] = useState('')
  const raw = store.data?.medios ?? []
  const medios = sortMedios(raw.map(m => m.nombre)).map(n => raw.find(m => m.nombre === n)!).filter(m => m && m.nombre.trim())
  const save = async (nombre: string, activo: boolean) => {
    try { await store.actions.saveMedio({ nombre, activo }); notify('Medio de pago guardado') } catch (e) { onError((e as Error).message) }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {medios.map(m => (
          <button key={m.nombre} onClick={() => save(m.nombre, !m.activo)} title={m.activo ? 'Desactivar' : 'Reactivar'}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${m.activo ? '' : 'bg-bg text-muted line-through'}`}
            style={m.activo ? { background: `${medioLook(m.nombre).color}1A`, color: medioLook(m.nombre).color } : undefined}>
            {(() => { const { Icon } = medioLook(m.nombre); return <Icon className="size-3.5" /> })()}{m.nombre}</button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (nuevo.trim()) { void save(nuevo.trim(), true); setNuevo('') } }}>
        <input aria-label="Nuevo medio de pago" className={inputCls} maxLength={40} value={nuevo} onChange={e => setNuevo(e.target.value)} placeholder="Nuevo medio de pago" />
        <Button type="submit" variant="outline"><Plus className="size-4" /></Button>
      </form>
    </div>
  )
}
