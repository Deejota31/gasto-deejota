import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { buscarIconos, GRUPOS, sugerirIconos, type IconoDef } from '../lib/iconos'
import { inputCls } from './ui'

/**
 * Selector de iconos: búsqueda por nombre o sinónimo, sugerencias según el nombre y su contexto (ámbito/categoría)
 * y todo el catálogo agrupado. Las sugerencias no restringen: siempre se puede elegir cualquier icono.
 */
export function IconPicker({ value, onChange, color, nombre, contexto }: { value: string; onChange: (k: string) => void; color: string; nombre: string; contexto: string[] }) {
  const [q, setQ] = useState('')
  const sugeridos = useMemo(() => sugerirIconos(nombre, contexto), [nombre, contexto])
  const lista = useMemo(() => buscarIconos(q), [q])
  const boton = (i: IconoDef) => (
    <button key={i.key} type="button" aria-label={`Icono ${i.key}`} aria-pressed={value === i.key} title={i.sin ? `${i.key}: ${i.sin}` : i.key} onClick={() => onChange(i.key)}
      className={`grid aspect-square place-items-center rounded-lg border transition outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${value === i.key ? 'shadow-sm' : 'border-line hover:bg-bg'}`}
      style={value === i.key ? { borderColor: color, background: `${color}1F`, color } : undefined}><i.Icon className="size-4" /></button>
  )
  const grid = 'grid grid-cols-8 gap-1.5 sm:grid-cols-10'
  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input aria-label="Buscar icono" className={`${inputCls} pl-9`} placeholder="Buscar icono: comida, gasolina, bebé, internet…" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="max-h-64 space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-line p-2" data-testid="icon-picker">
        {q ? (
          lista.length ? <div className={grid} aria-label="Resultados">{lista.map(boton)}</div>
            : <p className="py-4 text-center text-xs text-muted">Sin resultados para “{q}”. Prueba con otra palabra.</p>
        ) : (
          <>
            {sugeridos.length > 0 && <section aria-label="Sugeridos"><p className="mb-1 text-[11px] font-semibold text-navy">Sugeridos</p><div className={grid}>{sugeridos.map(boton)}</div></section>}
            {GRUPOS.map(gr => {
              const xs = lista.filter(i => i.grupo === gr)
              return xs.length ? <section key={gr} aria-label={gr}><p className="mb-1 text-[11px] font-semibold text-muted">{gr}</p><div className={grid}>{xs.map(boton)}</div></section> : null
            })}
          </>
        )}
      </div>
    </div>
  )
}
