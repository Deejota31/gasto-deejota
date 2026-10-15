import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Banknote, Bell, CalendarDays, Clock, Coins, Globe2, Moon, Palette, Plus, RefreshCw, Sun, X } from 'lucide-react'
import { formatDate } from '../lib/dates'
import { REFRESCO_OPCIONES, refrescoSegundos } from '../lib/refresco'
import { Combobox, type Opcion } from './Combobox'
import { Field, inputCls, Switch } from './ui'

/** Rótulo de campo con icono: misma jerarquía en todas las secciones. */
function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 [&>svg]:size-3.5 [&>svg]:text-muted">{icon}{children}</span>
}

const PAISES: Record<string, string> = { PEN: 'Perú', USD: 'Estados Unidos', EUR: 'la zona euro', COP: 'Colombia', MXN: 'México', CLP: 'Chile', ARS: 'Argentina', BRL: 'Brasil', GBP: 'Reino Unido', BOB: 'Bolivia' }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function nombreMoneda(code: string): string {
  try { return cap(new Intl.DisplayNames(['es'], { type: 'currency' }).of(code) ?? code) } catch { return code }
}
export const opcionMoneda = (code: string): Opcion => ({ value: code, label: `${code} — ${nombreMoneda(code)}`, Icon: code === 'USD' ? Banknote : Coins, color: code === 'USD' ? 'var(--success)' : '#4F7BE8', desc: PAISES[code] ? `Moneda de ${PAISES[code]}.` : 'Moneda permitida.' })
const monedaValida = (c: string) => {
  if (!/^[A-Z]{3}$/.test(c)) return false
  try { const todas = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency'); return todas ? todas.includes(c) : true } catch { return true }
}

const ZONAS_AMIGABLES: Record<string, string> = {
  'America/Lima': 'Lima, Perú', 'America/Bogota': 'Bogotá, Colombia', 'America/Mexico_City': 'Ciudad de México, México', 'America/Santiago': 'Santiago, Chile',
  'America/Argentina/Buenos_Aires': 'Buenos Aires, Argentina', 'America/Sao_Paulo': 'São Paulo, Brasil', 'America/New_York': 'Nueva York, EE. UU.', 'America/Los_Angeles': 'Los Ángeles, EE. UU.',
  'America/Guayaquil': 'Guayaquil, Ecuador', 'America/La_Paz': 'La Paz, Bolivia', 'America/Caracas': 'Caracas, Venezuela', 'America/Panama': 'Panamá', 'Europe/Madrid': 'Madrid, España',
  'Europe/London': 'Londres, Reino Unido', 'UTC': 'Hora universal (UTC)',
}
const nombreZona = (id: string) => ZONAS_AMIGABLES[id] ?? (id.split('/').slice(1).join(' · ').replace(/_/g, ' ') || id)
function zonasSoportadas(): string[] {
  try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [] } catch { return [] }
}

const FORMATOS: { value: string; label: string }[] = [
  { value: 'dd/MM/yyyy', label: 'Día / Mes / Año' }, { value: 'MM/dd/yyyy', label: 'Mes / Día / Año' }, { value: 'yyyy-MM-dd', label: 'Año - Mes - Día' },
]

/**
 * Configuración → Preferencias. Tres grupos (Moneda y finanzas · Regionalización · Interfaz y experiencia) con el mismo
 * selector personalizado (Combobox) de toda la app. Solo cambia la presentación: las claves de CONFIG y sus valores técnicos son los mismos.
 */
export function Preferencias({ cfg, saveCfg, setError }: { cfg: Record<string, string>; saveCfg: (clave: string, valor: string) => unknown; setError: (m: string) => void }) {
  const principal = cfg.moneda || 'PEN'
  const permitidas = useMemo(() => [...new Set([principal, ...(cfg.monedas || 'PEN,USD').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)])], [cfg.monedas, principal])
  const [nueva, setNueva] = useState('')
  const [errMon, setErrMon] = useState('')
  const guardarMonedas = (xs: string[]) => { if (xs.join(',') !== cfg.monedas) void saveCfg('monedas', xs.join(',')) }
  function agregar() {
    const c = nueva.trim().toUpperCase()
    if (!c) return
    if (!monedaValida(c)) return setErrMon('Escribe un código ISO de 3 letras válido (ej. EUR).')
    if (permitidas.includes(c)) return setErrMon(`${c} ya está en la lista.`)
    setErrMon(''); setNueva(''); guardarMonedas([...permitidas, c])
  }
  const tcMonedas = permitidas.filter(m => m !== principal && m === 'USD')

  const zonaActual = cfg.zona_horaria || 'America/Lima'
  const zonas = useMemo(() => {
    const ids = zonasSoportadas()
    const todas = ids.length ? (ids.includes(zonaActual) ? ids : [zonaActual, ...ids]) : [zonaActual]
    return todas.map<Opcion>(id => ({ value: id, label: nombreZona(id), desc: id, Icon: Globe2, color: '#4F7BE8', group: id.split('/')[0] }))
  }, [zonaActual])
  const fmtActual = cfg.formato_fecha || 'dd/MM/yyyy'
  const formatos = FORMATOS.some(f => f.value === fmtActual) ? FORMATOS : [...FORMATOS, { value: fmtActual, label: fmtActual }]
  const segundos = refrescoSegundos(cfg.refresco_segundos)
  const notifOn = cfg.notificaciones !== 'false'
  const tema = cfg.tema === 'oscuro' ? 'oscuro' : 'claro'

  const grupo = 'min-w-0 space-y-3.5 rounded-2xl border border-line p-3.5'
  const leyenda = 'px-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase'
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="preferencias">
      <fieldset className={grupo}>
        <legend className={leyenda}>Moneda y finanzas</legend>
        <Field label={<Label icon={<Coins />}>Moneda principal</Label>} htmlFor="cfg-moneda">
          <Combobox id="cfg-moneda" label="Moneda principal" value={principal} onChange={v => v !== principal && saveCfg('moneda', v)} options={permitidas.map(opcionMoneda)} />
        </Field>
        <Field label={<Label icon={<Coins />}>Monedas permitidas</Label>} htmlFor="cfg-monedas-nueva" error={errMon} hint="Códigos ISO. La moneda principal siempre está incluida.">
          <div className="space-y-2">
            <ul className="flex flex-wrap gap-1.5" aria-label="Monedas permitidas">
              {permitidas.map(m => (
                <li key={m} className="flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-2.5 text-xs font-semibold text-navy">
                  {m}
                  {m === principal
                    ? <span className="rounded-full bg-card px-1.5 py-0.5 text-[9px] font-medium text-muted">principal</span>
                    : <button type="button" aria-label={`Quitar ${m}`} onClick={() => guardarMonedas(permitidas.filter(x => x !== m))} className="grid size-5 place-items-center rounded-full hover:bg-navy/10"><X className="size-3" /></button>}
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5">
              <input id="cfg-monedas-nueva" aria-label="Agregar moneda" className={`${inputCls} h-10 uppercase`} maxLength={3} placeholder="Ej. EUR" value={nueva} autoComplete="off"
                onChange={e => { setNueva(e.target.value.replace(/[^a-zA-Z]/g, '')); setErrMon('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregar() } }} />
              <button type="button" onClick={agregar} aria-label="Agregar moneda a la lista" className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg"><Plus className="size-4" /> Agregar</button>
            </div>
          </div>
        </Field>
        {tcMonedas.map(m => <TipoCambio key={m} moneda={m} principal={principal} valor={cfg[`tipo_cambio_${m}`] ?? ''} onSave={v => saveCfg(`tipo_cambio_${m}`, v)} setError={setError} />)}
      </fieldset>

      <fieldset className={grupo}>
        <legend className={leyenda}>Regionalización</legend>
        <Field label={<Label icon={<Globe2 />}>Zona horaria</Label>} htmlFor="cfg-tz" hint="No cambia por sí sola. Define cuándo empieza “hoy”.">
          <Combobox id="cfg-tz" label="Zona horaria" value={zonaActual} descEnTrigger searchable={zonas.length > 1} maxHeight={360}
            onChange={v => v !== zonaActual && saveCfg('zona_horaria', v)} options={zonas} />
        </Field>
        <Field label={<Label icon={<CalendarDays />}>Formato de fecha</Label>} htmlFor="cfg-fecha" hint="Solo cambia cómo se ven las fechas; en la hoja se guardan igual.">
          <Combobox id="cfg-fecha" label="Formato de fecha" value={fmtActual} descEnTrigger onChange={v => v !== fmtActual && saveCfg('formato_fecha', v)}
            options={formatos.map<Opcion>(f => ({ value: f.value, label: f.label, desc: formatDate('2026-10-14', f.value), Icon: CalendarDays, color: '#6D5DD3' }))} />
        </Field>
      </fieldset>

      <fieldset className={`${grupo} md:col-span-2 xl:col-span-1`}>
        <legend className={leyenda}>Interfaz y experiencia</legend>
        <Field label={<Label icon={<Palette />}>Tema visual</Label>} htmlFor="cfg-tema">
          <Combobox id="cfg-tema" label="Tema visual" value={tema} onChange={v => v !== tema && saveCfg('tema', v)}
            options={[
              { value: 'claro', label: 'Claro', desc: 'Fondo blanco, ideal de día', Icon: Sun, color: 'var(--warning)' },
              { value: 'oscuro', label: 'Oscuro', desc: 'Fondo oscuro, descansa la vista', Icon: Moon, color: '#4F46E5' },
            ]} />
        </Field>
        <Field label={<Label icon={<RefreshCw />}>Actualizar datos automáticamente</Label>} htmlFor="cfg-refresco" hint="Relee tu hoja cada cierto tiempo y avisa en verde. No actualiza con la pestaña oculta.">
          <Combobox id="cfg-refresco" label="Actualizar datos automáticamente" value={String(segundos)} onChange={v => v !== String(segundos) && saveCfg('refresco_segundos', v)}
            options={REFRESCO_OPCIONES.map<Opcion>(o => ({ value: String(o.segundos), label: o.label, desc: o.desc, Icon: o.segundos ? Clock : RefreshCw, color: o.segundos ? 'var(--success)' : '#64748B' }))} />
        </Field>
        <div className="flex items-center gap-3 rounded-xl bg-bg/60 px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card text-muted"><Bell className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">Mostrar notificaciones al guardar</span><span className="block text-[11px] text-muted">Los errores siempre se notifican.</span></span>
          <Switch estado checked={notifOn} onChange={() => saveCfg('notificaciones', String(!notifOn))} label="Mostrar notificaciones al guardar" />
        </div>
      </fieldset>
    </div>
  )
}

/** Tipo de cambio: "1 USD = [4.07] PEN" sin flechas nativas; acepta coma o punto y se guarda con punto. */
function TipoCambio({ moneda, principal, valor, onSave, setError }: { moneda: string; principal: string; valor: string; onSave: (v: string) => unknown; setError: (m: string) => void }) {
  const [txt, setTxt] = useState(valor)
  const [err, setErr] = useState('')
  useEffect(() => { setTxt(valor) }, [valor])
  function confirmar() {
    const v = txt.trim().replace(',', '.')
    if (v === valor.trim()) return setErr('')
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(v) || !(Number(v) > 0)) { setErr('Escribe un número mayor que 0 (ej. 3.75).'); return }
    setErr(''); setError('')
    void onSave(v)
  }
  return (
    <Field label={<Label icon={<Coins />}>{`Tipo de cambio ${moneda} → ${principal}`}</Label>} htmlFor={`cfg-tc-${moneda}`} error={err} hint="Cuántas unidades de tu moneda principal vale 1 USD. No cambia gastos ya registrados.">
      <div className="flex h-11 items-center gap-2 rounded-xl border border-line bg-card px-3 focus-within:border-navy focus-within:ring-4 focus-within:ring-navy/10">
        <span className="shrink-0 text-sm text-muted">1 {moneda} =</span>
        <input id={`cfg-tc-${moneda}`} aria-label={`Tipo de cambio ${moneda} a ${principal}`} className="tabular min-w-0 flex-1 bg-transparent text-right text-base font-semibold outline-none sm:text-sm" inputMode="decimal" autoComplete="off"
          value={txt} onChange={e => setTxt(e.target.value.replace(/[^\d.,]/g, ''))} onBlur={confirmar} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmar() } }} />
        <span className="shrink-0 text-sm font-medium text-ink">{principal}</span>
      </div>
    </Field>
  )
}
