import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, RotateCcw, Save } from 'lucide-react'
import { MESES_NOMBRE, diasDelMes, leerAnio, leerPlanConfig, nombreMes, proximasFechas, serializarAnio, validarAnio } from '../lib/plan'
import { formatDate } from '../lib/dates'
import { Button, ErrorBox, Switch } from './ui'

type Fila = { dia: string; activo: boolean }
const aFilas = (cfg: Record<string, string>, anio: number): Fila[] => leerAnio(cfg, anio).map(m => ({ dia: String(m.dia), activo: m.activo }))

/**
 * Configuración → Preferencias → Planificación mensual y recordatorios. Un recordatorio por mes con su propio día (se valida
 * contra los días reales del mes, también en años bisiestos). Solo avisos dentro de la app: no hay notificaciones del sistema.
 */
export function RecordatoriosPlan({ cfg, saveCfg, hoy }: { cfg: Record<string, string>; saveCfg: (clave: string, valor: string) => unknown; hoy: string }) {
  const { activo, diaDefecto } = leerPlanConfig(cfg)
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)))
  const [filas, setFilas] = useState<Fila[]>(() => aFilas(cfg, anio))
  const [diaDef, setDiaDef] = useState(String(diaDefecto))
  const [sucio, setSucio] = useState(false)
  // Al cambiar de año (o llegar datos nuevos sin ediciones pendientes) se recarga desde la configuración guardada.
  const guardado = cfg[`plan_dias_${anio}`] ?? ''
  useEffect(() => { if (!sucio) setFilas(aFilas(cfg, anio)) }, [anio, guardado, cfg.plan_dia]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDiaDef(String(diaDefecto)) }, [diaDefecto])
  const cambiarAnio = (n: number) => { setAnio(a => a + n); setSucio(false) }

  const numeros = filas.map(f => Number(f.dia))
  const error = useMemo(() => validarAnio(anio, numeros.map((dia, i) => ({ dia, activo: filas[i].activo }))), [anio, filas]) // eslint-disable-line react-hooks/exhaustive-deps
  const errDef = !/^([1-9]|[12]\d|3[01])$/.test(diaDef.trim()) ? 'El día predeterminado debe estar entre 1 y 31.' : ''
  const editar = (i: number, p: Partial<Fila>) => { setFilas(xs => xs.map((f, j) => j === i ? { ...f, ...p } : f)); setSucio(true) }
  const guardar = () => {
    if (error) return
    void saveCfg(`plan_dias_${anio}`, serializarAnio(numeros.map((dia, i) => ({ dia, activo: filas[i].activo }))))
    setSucio(false)
  }
  const mismoDia = () => {
    const d = Number(diaDef)
    if (errDef) return
    setFilas(xs => xs.map((f, i) => ({ ...f, dia: String(Math.min(d, diasDelMes(`${anio}-${String(i + 1).padStart(2, '0')}`))) }))); setSucio(true)
  }
  const copiarAnterior = () => { setFilas(aFilas(cfg, anio - 1)); setSucio(true) }
  const restablecer = () => { setFilas(Array.from({ length: 12 }, () => ({ dia: String(diaDefecto), activo: true }))); setSucio(true) }
  const proximas = useMemo(() => proximasFechas(cfg, hoy, 3), [cfg, hoy])

  return (
    <div className="space-y-4" data-testid="recordatorios-plan">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
        <div className="min-w-0"><p className="text-sm font-medium text-ink">Recordatorios de planificación mensual</p>
          <p className="text-[11px] text-muted">Un aviso en la campana para preparar fondos y gastos de cada mes. Solo dentro de la app.</p></div>
        <Switch checked={activo} onChange={v => void saveCfg('plan_activo', v ? 'true' : 'false')} label="Recordatorios activos" estado />
      </div>

      <div className={`space-y-3 ${activo ? '' : 'opacity-60'}`}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-muted">Día predeterminado
            <input aria-label="Día predeterminado" inputMode="numeric" maxLength={2} value={diaDef} onChange={e => setDiaDef(e.target.value.replace(/\D/g, ''))}
              onBlur={() => { if (!errDef && Number(diaDef) !== diaDefecto) void saveCfg('plan_dia', String(Number(diaDef))) }}
              className="tabular mt-1 block h-10 w-20 rounded-lg border border-line bg-card px-2 text-center text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy/60" /></label>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Año">
            <button type="button" aria-label="Año anterior" onClick={() => cambiarAnio(-1)} className="grid size-9 place-items-center rounded-lg border border-line hover:bg-bg"><ChevronLeft className="size-4" /></button>
            <span className="tabular w-14 text-center text-sm font-semibold" data-testid="plan-anio">{anio}</span>
            <button type="button" aria-label="Año siguiente" onClick={() => cambiarAnio(1)} className="grid size-9 place-items-center rounded-lg border border-line hover:bg-bg"><ChevronRight className="size-4" /></button>
          </div>
        </div>
        {errDef && <p className="text-xs text-danger">{errDef}</p>}

        <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={`Recordatorios ${anio}`}>
          {filas.map((f, i) => {
            const largo = diasDelMes(`${anio}-${String(i + 1).padStart(2, '0')}`), malo = !(Number(f.dia) >= 1 && Number(f.dia) <= largo)
            return (
              <li key={i} className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{MESES_NOMBRE[i]}</span>
                <input aria-label={`Día de ${MESES_NOMBRE[i]} ${anio}`} aria-invalid={malo} inputMode="numeric" maxLength={2} value={f.dia} disabled={!f.activo}
                  onChange={e => editar(i, { dia: e.target.value.replace(/\D/g, '') })}
                  className={`tabular h-9 w-14 rounded-lg border bg-card px-1 text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-navy/60 disabled:opacity-50 ${malo ? 'border-danger' : 'border-line'}`} />
                <Switch checked={f.activo} onChange={v => editar(i, { activo: v })} label={`Recordatorio de ${MESES_NOMBRE[i]} ${anio}`} compact />
              </li>
            )
          })}
        </ul>
        {error && <ErrorBox tone="error" message={error} />}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-9 text-xs" onClick={mismoDia} disabled={!!errDef}>Aplicar el día {diaDef || '—'} a todos</Button>
          <Button variant="outline" className="h-9 text-xs" onClick={copiarAnterior}><Copy className="size-3.5" /> Copiar de {anio - 1}</Button>
          <Button variant="outline" className="h-9 text-xs" onClick={restablecer}><RotateCcw className="size-3.5" /> Restablecer</Button>
          <Button className="ml-auto h-9 text-xs" onClick={guardar} disabled={!!error || !sucio} data-testid="guardar-recordatorios"><Save className="size-3.5" /> Guardar {anio}</Button>
        </div>
        <div className="rounded-xl bg-bg px-3 py-2 text-xs text-muted" data-testid="proximas-fechas">
          <p className="font-semibold text-ink">Próximos recordatorios</p>
          {proximas.length ? <ul className="mt-1 space-y-0.5">{proximas.map(p => <li key={p.mes}>{formatDate(p.fecha, cfg.formato_fecha)} · {nombreMes(p.mes)}</li>)}</ul> : <p className="mt-1">{activo ? 'No hay recordatorios programados.' : 'Los recordatorios están desactivados.'}</p>}
        </div>
      </div>
    </div>
  )
}
