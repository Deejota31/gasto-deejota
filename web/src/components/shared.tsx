import { ChevronLeft, ChevronRight } from 'lucide-react'
import { shiftMonth } from '../lib/dates'
import type { AppStore } from '../lib/store'
import type { Filters } from '../lib/types'
import { Button, inputCls } from './ui'

export function emptyFilters(periodo: string): Filters {
  return { periodo, ambito: '', categoria: '', subcategoria: '', medioPago: '', tipoGasto: '' }
}

export function catalogOptions(store: AppStore, ambito: string, categoria: string) {
  const all = store.data?.catalogo ?? []
  const off = new Set(all.filter(c => !c.activo && !c.subcategoria).map(c => `${c.ambito}|${c.categoria}`))
  const cat = all.filter(c => c.activo && !off.has(`${c.ambito}|${c.categoria}`) && !off.has(`${c.ambito}|`))
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]
  return {
    ambitos: uniq(cat.map(c => c.ambito)),
    categorias: uniq(cat.filter(c => !ambito || c.ambito === ambito).map(c => c.categoria)).sort(),
    subcategorias: uniq(cat.filter(c => (!ambito || c.ambito === ambito) && (!categoria || c.categoria === categoria)).map(c => c.subcategoria)).sort(),
  }
}

export function MonthNav({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" aria-label="Mes anterior" onClick={() => onChange(shiftMonth(value, -1))}><ChevronLeft className="size-4" /></Button>
      <input type="month" aria-label="Mes" className={`${inputCls} w-40`} value={value} onChange={e => e.target.value && onChange(e.target.value)} />
      <Button variant="outline" aria-label="Mes siguiente" onClick={() => onChange(shiftMonth(value, 1))}><ChevronRight className="size-4" /></Button>
    </div>
  )
}


export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)']
/** Color estable por entidad (el orden del catálogo), no por ranking: filtrar no repinta. */
export function colorFor(name: string, order: string[]): string {
  const i = order.indexOf(name)
  return i >= 0 && i < SERIES.length ? SERIES[i] : 'var(--muted)'
}

