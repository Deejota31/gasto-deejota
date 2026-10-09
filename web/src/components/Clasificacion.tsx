// Selector Ámbito → Categoría → Subcategoría compartido por el formulario de gasto y el de plantillas.
// Usa el mismo catálogo (ya ordenado, "Otros" al final) y la misma regla de dependencias.
import { Check } from 'lucide-react'
import type { CatalogoItem } from '../lib/types'
import { otrosAlFinal } from '../lib/orden'
import { ambitoLook, categoriaLook } from '../lib/visual'
import { descripcionDeSubcategoria } from '../lib/texto'
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
 * Autocompletado de la descripción al elegir subcategoría.
 * Solo reemplaza si la descripción está vacía o sigue siendo la que se completó sola (`auto`);
 * si la escribiste tú, no se toca. "Otros" y "Por Clasificar" dejan la descripción vacía.
 */
export function autocompletar(descripcion: string, auto: string | null, sub: string): { descripcion: string; auto: string | null } {
  if (descripcion.trim() !== '' && descripcion !== auto) return { descripcion, auto }
  const nueva = descripcionDeSubcategoria(sub)
  return { descripcion: nueva, auto: nueva }
}

export function ClasificacionPicker({ catalogo, value, onChange, errors = {}, keepCurrent = false }: {
  catalogo: CatalogoItem[]; value: Clasif; onChange: (next: Clasif) => void; errors?: Record<string, string>; keepCurrent?: boolean
}) {
  const o = opcionesClasif(catalogo, value, keepCurrent)
  const err = (k: string) => errors[k] && <span className="text-xs text-[#D2463C]">{errors[k]}</span>
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
            {!o.categorias.length && <p className="text-xs text-muted">No hay categorías activas para este ámbito. Agrégalas en Categorías.</p>}
          </div>
        )}
        {err('categoria')}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">3. Subcategoría</p>
        {!value.categoria ? <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted">Se habilita al elegir una categoría.</p> : (
          <div role="radiogroup" aria-label="Subcategoría" className="flex flex-wrap gap-1.5">
            {o.subcategorias.map(s => (
              <Chip key={s} on={value.subcategoria === s} color={categoriaLook(value.categoria, catalogo, value.ambito).color} onClick={() => onChange({ ...value, subcategoria: s })}>{s}</Chip>
            ))}
          </div>
        )}
        {err('subcategoria')}
      </div>
    </div>
  )
}
