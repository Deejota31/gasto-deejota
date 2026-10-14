import { useState } from 'react'
import { Check, Wand2 } from 'lucide-react'
import { ICONS } from '../lib/iconos'
import { claveDeIcono, PALETA, soft, type Look } from '../lib/visual'
import { IconPicker } from './IconPicker'

/**
 * Selector de color: 16 familias × 4 tonos más un color libre. `value` es el color que se está viendo.
 * Los tonos se reparten por filas (primero todos los base, luego los siguientes) para que la rejilla se lea como una paleta.
 */
export function ColorPicker({ value, onChange, label = 'Color' }: { value: string; onChange: (c: string) => void; label?: string }) {
  const filas = [0, 1, 2, 3].flatMap(t => PALETA.map(f => ({ c: f.tonos[t], familia: f.nombre })))
  const on = (c: string) => value.toLowerCase() === c.toLowerCase()
  const enPaleta = filas.some(x => on(x.c))
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={label} className="grid grid-cols-8 gap-1.5 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
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
        <span>{enPaleta ? 'Otro color…' : <>Color personalizado <b className="tabular text-ink">{value.toUpperCase()}</b></>}</span>
      </label>
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
