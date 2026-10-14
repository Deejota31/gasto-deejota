import { useState } from 'react'
import { Check, ChevronDown, Wand2 } from 'lucide-react'
import { ICONS } from '../lib/iconos'
import { claveDeIcono, PALETA, soft, type Look } from '../lib/visual'
import { IconPicker } from './IconPicker'

/** Los 10 colores de uso rápido: una sola fila. El resto de la paleta (16 familias × 4 tonos) y el color libre van debajo de "Más colores". */
export const COLORES_RAPIDOS = ['#E5484D', '#F76B15', '#F5A524', '#2F9E6B', '#0E8FA8', '#4F7BE8', '#6366F1', '#8B7CF6', '#DB5A9A', '#64748B']

function Punto({ c, activo, onChange, titulo }: { c: string; activo: boolean; onChange: (c: string) => void; titulo?: string }) {
  return (
    <button type="button" role="radio" aria-checked={activo} aria-label={`Color ${c}`} title={titulo ?? c} onClick={() => onChange(c)}
      className="grid size-7 shrink-0 place-items-center rounded-full transition outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-navy/40"
      style={{ background: c, boxShadow: activo ? `0 0 0 2px var(--card), 0 0 0 4px ${c}` : undefined }}>
      {activo && <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden />}
    </button>
  )
}

/**
 * Selector de color compacto: una fila con 10 colores y, al final, "Más colores" que despliega la paleta completa
 * (16 familias × 4 tonos, repartidos por filas) y un color libre. `value` es el color que se está viendo; si no es uno
 * de los 10 rápidos se muestra como un punto más al final de la fila, así siempre se ve cuál está elegido.
 */
export function ColorPicker({ value, onChange, label = 'Color' }: { value: string; onChange: (c: string) => void; label?: string }) {
  const [mas, setMas] = useState(false)
  const filas = [0, 1, 2, 3].flatMap(t => PALETA.map(f => ({ c: f.tonos[t], familia: f.nombre })))
  const on = (c: string) => value.toLowerCase() === c.toLowerCase()
  const rapido = COLORES_RAPIDOS.some(on)
  const enPaleta = filas.some(x => on(x.c))
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
        {COLORES_RAPIDOS.map(c => <Punto key={c} c={c} activo={on(c)} onChange={onChange} />)}
        {!rapido && /^#[0-9a-fA-F]{6}$/.test(value) && <Punto c={value.toUpperCase()} activo onChange={onChange} titulo={`Elegido ${value.toUpperCase()}`} />}
        <button type="button" aria-expanded={mas} onClick={() => setMas(m => !m)}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-bg outline-none focus-visible:ring-2 focus-visible:ring-navy/40">
          {mas ? 'Menos colores' : 'Más colores'} <ChevronDown className={`size-3 transition ${mas ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {mas && (
        <div className="space-y-2 rounded-xl border border-line bg-bg/40 p-2.5" data-testid="paleta-completa">
          <div role="radiogroup" aria-label="Paleta completa" className="grid grid-cols-8 gap-1.5 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
            {filas.map(({ c, familia }, i) => (
              <button key={`${c}-${i}`} type="button" role="radio" aria-checked={on(c)} aria-label={`Color ${c}`} title={`${familia} ${c}`} onClick={() => onChange(c)}
                className="grid aspect-square place-items-center rounded-full transition outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-navy/40"
                style={{ background: c, boxShadow: on(c) ? `0 0 0 2px var(--card), 0 0 0 4px ${c}` : undefined }}>
                {on(c) && <Check className="size-3 text-white" strokeWidth={3} aria-hidden />}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input type="color" aria-label="Otro color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#1E3A8A'} onChange={e => onChange(e.target.value.toUpperCase())}
              className="size-8 cursor-pointer rounded-full border border-line bg-card p-0.5" />
            <span>{enPaleta || rapido ? 'Otro color…' : <>Color personalizado <b className="tabular text-ink">{value.toUpperCase()}</b></>}</span>
          </label>
        </div>
      )}
    </div>
  )
}

/**
 * Estado de la apariencia de una fuente o caja. `auto` es lo que se vería sin elegir nada (el del medio de pago o del
 * alcance): mientras no elijas un icono, se guarda vacío y manda el automático. Al elegir un icono o un color, se
 * guarda lo que estabas viendo más tu cambio, así el otro no salta.
 */
export function useApariencia(inicial: { icono: string; color: string }, auto: Look) {
  const [v, setV] = useState(inicial)
  const esAuto = !v.icono || !ICONS[v.icono]
  const look: Look = esAuto ? auto : { Icon: ICONS[v.icono], color: v.color }
  const elegir = (p: Partial<{ icono: string; color: string }>) =>
    setV(cur => ({ ...((!cur.icono || !ICONS[cur.icono]) ? { icono: claveDeIcono(auto.Icon), color: auto.color } : cur), ...p }))
  const restablecer = () => setV({ icono: '', color: inicial.color })
  return { icono: esAuto ? '' : v.icono, color: look.color, look, esAuto, elegir, restablecer }
}

/** Icono + color con la opción de volver al automático. Se usa en Nueva/Editar fuente y Nueva/Editar caja. */
export function AparienciaCampos({ ap, nombre, contexto, autoTexto }: {
  ap: ReturnType<typeof useApariencia>; nombre: string; contexto: string[]; autoTexto: string
}) {
  return (
    <div className="space-y-3" data-testid="apariencia">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">Icono y color</p>
        <button type="button" aria-pressed={ap.esAuto} onClick={ap.restablecer}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${ap.esAuto ? 'border-transparent' : 'border-line text-muted hover:bg-bg'}`}
          style={ap.esAuto ? { background: soft(ap.look.color, '1F'), color: ap.look.color } : undefined}>
          <Wand2 className="size-3" /> {ap.esAuto ? `Automático · ${autoTexto}` : `Usar el automático (${autoTexto})`}
        </button>
      </div>
      <IconPicker value={ap.icono || claveDeIcono(ap.look.Icon)} onChange={k => ap.elegir({ icono: k })} color={ap.look.color} nombre={nombre} contexto={contexto} />
      <ColorPicker value={ap.look.color} onChange={c => ap.elegir({ color: c })} />
    </div>
  )
}
