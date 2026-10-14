import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity, Bell, FolderOpen, Pencil, CalendarDays, CheckCircle2, CircleAlert, Coins, Database, Download, ExternalLink, FileSpreadsheet, Globe2,
  Eye, EyeOff, Info, KeyRound, Link2, Loader2, Palette, RefreshCw, Settings, ShieldCheck, Tags, Unplug,
} from 'lucide-react'
import type { AppStore } from '../lib/store'
import { saveConnection, validarConexion, type CarpetaRespaldo, type Connection } from '../lib/api'
import { Button, Card, ErrorBox, Field, inputCls, Select, Switch } from '../components/ui'
import { FuncionesBackend } from '../components/FuncionesBackend'
import { toCsv } from './Gastos'
import { showToast } from '../lib/toast'
import { REFRESCO_OPCIONES, refrescoSegundos } from '../lib/refresco'

export const APP_VERSION = '1.15.0'

/** Rótulo de campo con icono: misma jerarquía en todas las secciones. */
function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 [&>svg]:size-3.5 [&>svg]:text-muted">{icon}{children}</span>
}

export default function Configuracion({ store, conn, onConnect, notify, goCatalogo }: {
  store: AppStore; conn: Connection | null; onConnect: (c: Connection | null) => void; notify: (m: string) => void; goCatalogo: () => void
}) {
  const cfg = store.data?.config ?? {}
  const [url, setUrl] = useState(conn?.url ?? '')
  const [token, setToken] = useState(conn?.token ?? '')
  const [error, setError] = useState('')
  const [connError, setConnError] = useState('')
  const [busy, setBusy] = useState('')
  const [verToken, setVerToken] = useState(false)

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key)
    setError('')
    try { await fn(); if (ok) notify(ok) } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  function connect() {
    const malo = validarConexion(url, token)
    if (malo) return setConnError(malo)
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

      <div className="space-y-4">
        {/* A. Conexión */}
        <Card title="Conexión con Google Sheets" icon={<Database className="size-4 text-turquesa" />}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end">
            <Field label="URL de Apps Script (/exec)" htmlFor="cfg-url">
              <input id="cfg-url" className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" />
            </Field>
            <Field label="Token" htmlFor="cfg-token">
              <div className="relative">
                <input id="cfg-token" className={`${inputCls} pr-10`} type={verToken ? 'text' : 'password'} autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="••••••••" />
                <button type="button" aria-label={verToken ? 'Ocultar token' : 'Mostrar token'} aria-pressed={verToken} onClick={() => setVerToken(v => !v)}
                  className="absolute inset-y-0 right-1 grid w-8 place-items-center rounded-lg text-muted hover:text-navy">{verToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </div>
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

        {/* B. Preferencias: tres grupos lógicos en una cuadrícula adaptable */}
        <Card title="Preferencias" icon={<Palette className="size-4 text-morado" />}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <fieldset className="min-w-0 space-y-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Moneda y finanzas</legend>
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
                <Field key={m} label={<Label icon={<Coins />}>{`Tipo de cambio ${m} → ${cfg.moneda || 'PEN'}`}</Label>} htmlFor={`cfg-tc-${m}`} hint="Solo USD tiene tipo de cambio configurable.">
                  <input id={`cfg-tc-${m}`} className={`${inputCls} tabular`} type="number" step="0.0001" min="0" defaultValue={cfg[`tipo_cambio_${m}`] ?? ''}
                    onBlur={e => e.target.value !== (cfg[`tipo_cambio_${m}`] ?? '') && saveCfg(`tipo_cambio_${m}`, e.target.value)} />
                </Field>
              ))}
            </fieldset>
            <fieldset className="min-w-0 space-y-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Regionalización</legend>
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
            </fieldset>
            <fieldset className="min-w-0 space-y-3 rounded-xl border border-line p-3 md:col-span-2 xl:col-span-1">
              <legend className="px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Interfaz y experiencia</legend>
              <Field label={<Label icon={<Palette />}>Tema visual</Label>} htmlFor="cfg-tema">
                <Select id="cfg-tema" label="Tema visual" value={cfg.tema || 'claro'} onChange={v => saveCfg('tema', v)} options={['claro', 'oscuro']} />
              </Field>
              <Field label={<Label icon={<RefreshCw />}>Actualizar datos automáticamente</Label>} htmlFor="cfg-refresco" hint="Relee tu hoja cada cierto tiempo y avisa en verde. No actualiza con la pestaña oculta.">
                <select id="cfg-refresco" aria-label="Actualizar datos automáticamente" className={inputCls} value={String(refrescoSegundos(cfg.refresco_segundos))}
                  onChange={e => saveCfg('refresco_segundos', e.target.value)}>
                  {REFRESCO_OPCIONES.map(o => <option key={o.segundos} value={o.segundos}>{o.label}</option>)}
                </select>
              </Field>
              <div className="flex items-center gap-2 rounded-xl bg-bg/60 px-3 py-2.5">
                <Bell className="size-4 shrink-0 text-muted" />
                <Switch checked={cfg.notificaciones !== 'false'} onChange={v => saveCfg('notificaciones', String(v))} label="Mostrar notificaciones al guardar" />
              </div>
              <p className="text-[11px] text-muted">Los errores siempre se notifican.</p>
            </fieldset>
          </div>
        </Card>

        {/* D. Administración de datos */}
        {/* E. Datos */}
        <Card title="Administración de datos" icon={<FileSpreadsheet className="size-4 text-turquesa" />}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Action icon={<ShieldCheck />} title="Crear respaldo" desc="Copia completa en tu carpeta Backup" loading={busy === 'backup'}
              onClick={() => run('backup', async () => {
                const r = await store.actions.backup()
                if (r.aviso) showToast('info', `Respaldo creado en ${r.carpeta ?? 'tu Drive'}. ${r.aviso}`)
                else notify(`Respaldo creado en la carpeta ${r.carpeta ?? 'Backup'}: ${r.nombre}`)
                window.open(r.carpetaUrl || r.url, '_blank', 'noopener')
              })} />
            <Action icon={<Download />} title="Exportar todo (CSV)" desc="Todo el historial" disabled={!store.data} onClick={() => {
              const blob = new Blob([toCsv(store.data!.gastos)], { type: 'text/csv;charset=utf-8' })
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gastos-completo.csv'; a.click(); URL.revokeObjectURL(a.href)
            }} />
            <Action icon={<Tags />} title="Administrar catálogo" desc="Ámbitos, categorías, subcategorías y medios de pago" onClick={goCatalogo} />
            {store.data?.sheetUrl
              ? <a href={store.data.sheetUrl} target="_blank" rel="noopener noreferrer" className={ACTION_CLS}><ActionBody icon={<ExternalLink />} title="Abrir hoja" desc="Google Sheets" /></a>
              : <Action icon={<ExternalLink />} title="Abrir hoja" desc="Disponible al conectar" disabled onClick={() => {}} />}
          </div>
          <CarpetaRespaldos store={store} />
        </Card>

        {/* G. Herramientas del backend */}
        <FuncionesBackend store={store} />

        {/* F. Acerca de */}
        <Card title="Acerca de" icon={<Info className="size-4 text-muted" />}>
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

/** Carpeta de Drive donde se guardan los respaldos: se lee al abrir Configuración y se puede cambiar pegando un enlace. */
function CarpetaRespaldos({ store }: { store: AppStore }) {
  const [info, setInfo] = useState<CarpetaRespaldo | null>(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const api = store.actions
  useEffect(() => {
    let vivo = true
    api.carpetaRespaldo().then(r => { if (vivo) { setInfo(r); setError('') } }, (e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [api])
  async function guardar(v: string) {
    setGuardando(true); setError('')
    try {
      const r = await api.saveCarpetaRespaldo(v)
      setInfo(r); setEditando(false); setValor('')
      showToast('success', v ? `Los respaldos se guardarán en “${r.nombre}”.` : `Los respaldos vuelven a la carpeta “${r.nombre}” junto a tu hoja.`)
    } catch (e) { setError((e as Error).message) } finally { setGuardando(false) }
  }
  return (
    <div className="mt-3 rounded-xl border border-line p-3" data-testid="carpeta-respaldos">
      <div className="flex flex-wrap items-center gap-2">
        <FolderOpen className="size-4 shrink-0 text-muted" />
        <span className="text-sm text-muted">Carpeta de respaldos:</span>
        {info ? <a href={info.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-semibold text-navy hover:underline">{info.nombre}</a>
          : <span className="text-sm text-muted">{error ? '—' : 'Cargando…'}</span>}
        {info && !info.personalizada && <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] text-muted">junto a tu hoja</span>}
        <span className="ml-auto flex gap-2">
          {!editando && <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => { setEditando(true); setError('') }}><Pencil className="size-3.5" /> Cambiar</Button>}
          {info?.personalizada && !editando && <Button variant="ghost" className="h-8 px-3 text-xs" disabled={guardando} onClick={() => guardar('')}>Usar la de junto a la hoja</Button>}
        </span>
      </div>
      {editando && (
        <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); if (valor.trim()) void guardar(valor.trim()) }}>
          <input aria-label="Enlace de la carpeta de respaldos" className={inputCls} autoFocus placeholder="Pega el enlace de la carpeta: https://drive.google.com/drive/folders/…" value={valor} onChange={e => setValor(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!valor.trim() || guardando} loading={guardando}>Guardar</Button>
            <Button type="button" variant="outline" onClick={() => { setEditando(false); setValor(''); setError('') }}>Cancelar</Button>
          </div>
        </form>
      )}
      <p className="mt-1.5 text-[11px] text-muted">En Drive abre la carpeta que quieras y copia el enlace de la barra de direcciones. Cada respaldo es una copia completa de tu hoja.</p>
      {error && <p className="mt-1 text-xs text-[#C0362C]">{error}</p>}
    </div>
  )
}
