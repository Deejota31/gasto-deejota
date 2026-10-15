// Selector Ámbito → Categoría → Subcategoría compartido por el formulario de gasto y el de plantillas.
// Usa el mismo catálogo (ya ordenado, "Otros" al final) y la misma regla de dependencias.
import { useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { CatalogoItem } from '../lib/types'
import { otrosAlFinal } from '../lib/orden'
import { ambitoLook, categoriaLook, subcategoriaLook } from '../lib/visual'
import { descripcionDeSubcategoria, formatearDescripcion } from '../lib/texto'
import { catalogOptions } from './shared'

export interface Clasif { ambito: string; categoria: string; subcategoria: string }

export function Chip({ on, color, children, onClick, label }: { on: boolean; color: string; children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[13px] font-medium transition ${on ? 'shadow-sm' : 'border-line bg-card text-ink hover:bg-bg'}`}
      style={on ? { background: `${color}1F`, borderColor: color, color } : undefined}>
      {children}
      {on && <Check className="size-3.5" />}
    </button>
  )
}

/** Opciones vigentes para una clasificación. `keepCurrent` agrega el valor actual si ya no está vigente (edición de históricos). */
export function opcionesClasif(catalogo: CatalogoItem[], v: Clasif, keepCurrent: boolean) {
  const opts = catalogOptions(catalogo, v.ambito ? [v.ambito] : [], v.categoria ? [v.categoria] : [])
  const subs = v.categoria ? opts.subcategorias.map(s => s.subcategoria) : []
  const withCurrent = (xs: string[], cur: string) => otrosAlFinal(keepCurrent && cur && !xs.includes(cur) ? [...xs, cur] : xs)
  return { ambitos: withCurrent(opts.ambitos, v.ambito), categorias: withCurrent(opts.categorias, v.categoria), subcategorias: withCurrent(subs, v.subcategoria), subsVigentes: subs }
}

/** ¿La clasificación sigue ofreciéndose para gastos nuevos? */
export function clasificacionVigente(catalogo: CatalogoItem[], v: Clasif): boolean {
  const o = catalogOptions(catalogo, [v.ambito], [v.categoria])
  return o.ambitos.includes(v.ambito) && o.categorias.includes(v.categoria) && (!v.subcategoria || o.subcategorias.some(s => s.categoria === v.categoria && s.subcategoria === v.subcategoria))
}

/**
 * Descripción ligada a la subcategoría (gastos y plantillas). Reglas:
 *  - Al abrir un registro se conserva su descripción; solo se considera "automática" si coincide con el nombre de su subcategoría.
 *  - Al elegir otra subcategoría, una descripción vacía o automática se actualiza al instante con el nombre nuevo.
 *  - Si la descripción es personalizada, NO se pisa: se pide confirmar (Reemplazar / Conservar).
 *  - "Otros" y "Por Clasificar" no generan descripción: nunca borran un texto personalizado.
 * `auto` recuerda el último texto generado, así cambiar de ámbito o categoría (que limpia la subcategoría) no lo vuelve "personalizado".
 */
export function useDescripcionSub(inicial: string, subInicial: string) {
  const [descripcion, setDescripcionRaw] = useState(inicial)
  const auto = useRef<string | null>(inicial && formatearDescripcion(inicial) === formatearDescripcion(descripcionDeSubcategoria(subInicial)) ? inicial : null)
  const [pendiente, setPendiente] = useState<{ sub: string; nueva: string } | null>(null)

  const esAuto = (d: string) => d.trim() === '' || (auto.current !== null && formatearDescripcion(d) === formatearDescripcion(auto.current))
  const aplicar = (nueva: string) => { auto.current = nueva; setDescripcionRaw(nueva); setPendiente(null) }

  return {
    descripcion, pendiente,
    /** Escritura del usuario: pasa a ser personalizada y cancela una confirmación abierta. */
    escribir: (v: string) => { setDescripcionRaw(v); setPendiente(null) },
    /** Al salir del campo (formato de mayúsculas); si seguía siendo la automática, sigue siéndolo. */
    alSalir: () => { const f = formatearDescripcion(descripcion); if (f === descripcion) return; if (auto.current !== null && descripcion === auto.current) auto.current = f; setDescripcionRaw(f) },
    /** El usuario eligió otra subcategoría. */
    alCambiarSub: (sub: string) => {
      if (!sub) return
      const nueva = descripcionDeSubcategoria(sub)
      if (esAuto(descripcion)) return aplicar(nueva)
      if (!nueva || formatearDescripcion(descripcion) === formatearDescripcion(nueva)) return setPendiente(null)
      setPendiente({ sub, nueva })
    },
    reemplazar: () => { if (pendiente) aplicar(pendiente.nueva) },
    conservar: () => setPendiente(null),
  }
}

/** Aviso en línea para confirmar el reemplazo de una descripción personalizada. */
export function ConfirmarDescripcion({ d }: { d: ReturnType<typeof useDescripcionSub> }) {
  if (!d.pendiente) return null
  return (
    <div role="alert" data-testid="desc-confirmar" className="mt-1.5 rounded-xl border border-[#F5DDA8] bg-[#FFF7E6] p-2.5 text-xs text-[#8A5A0B] dark:border-[#5a4a20] dark:bg-[#33290f] dark:text-[#f1d391]">
      <p>Cambiaste la subcategoría a <b>{d.pendiente.sub}</b>. ¿Reemplazar tu descripción “{d.descripcion}” por “{d.pendiente.nueva}”?</p>
      <div className="mt-1.5 flex gap-2">
        <button type="button" onClick={d.reemplazar} className="rounded-lg bg-navy px-2.5 py-1 font-semibold text-white dark:text-[#0E1525]">Reemplazar</button>
        <button type="button" onClick={d.conservar} className="rounded-lg border border-line bg-card px-2.5 py-1 font-semibold text-ink">Conservar la mía</button>
      </div>
    </div>
  )
}

export function ClasificacionPicker({ catalogo, value, onChange, errors = {}, keepCurrent = false, children }: {
  catalogo: CatalogoItem[]; value: Clasif; onChange: (next: Clasif) => void; errors?: Record<string, string>; keepCurrent?: boolean
  /** Se pinta justo debajo de la subcategoría: la descripción va pegada al campo del que depende. */
  children?: ReactNode
}) {
  const o = opcionesClasif(catalogo, value, keepCurrent)
  const err = (k: string) => errors[k] && <span className="text-xs text-danger">{errors[k]}</span>
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">1. Ámbito</p>
        <div role="radiogroup" aria-label="Ámbito" className="flex flex-wrap gap-1.5">
          {o.ambitos.map(a => {
            const l = ambitoLook(a, catalogo)
            return <Chip key={a} on={value.ambito === a} color={l.color} onClick={() => value.ambito !== a && onChange({ ambito: a, categoria: '', subcategoria: '' })}><l.Icon className="size-4" />{a}</Chip>
          })}
        </div>
        {err('ambito')}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">2. Categoría</p>
        {!value.ambito ? <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">Primero elige un ámbito.</p> : (
          <div role="radiogroup" aria-label="Categoría" className="flex flex-wrap gap-1.5">
            {o.categorias.map(c => {
              const l = categoriaLook(c, catalogo, value.ambito)
              return <Chip key={c} on={value.categoria === c} color={l.color} onClick={() => value.categoria !== c && onChange({ ...value, categoria: c, subcategoria: '' })}><l.Icon className="size-4" />{c}</Chip>
            })}
            {!o.categorias.length && <p className="text-xs text-muted">No hay categorías activas para este ámbito. Agrégalas en Catálogo.</p>}
          </div>
        )}
        {err('categoria')}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">3. Subcategoría</p>
        {!value.categoria ? <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">Se habilita al elegir una categoría.</p> : (
          <div role="radiogroup" aria-label="Subcategoría" className="flex flex-wrap gap-1.5">
            {o.subcategorias.map(s => {
              const l = subcategoriaLook(s, value.categoria, catalogo, value.ambito)
              return <Chip key={s} on={value.subcategoria === s} color={l.color} onClick={() => onChange({ ...value, subcategoria: s })}><l.Icon className="size-3.5" />{s}</Chip>
            })}
          </div>
        )}
        {err('subcategoria')}
      </div>
      {children}
    </div>
  )
}
