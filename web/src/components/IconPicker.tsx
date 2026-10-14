import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { buscarIconos, GRUPOS, ICONS, sugerirIconos, type IconoDef } from '../lib/iconos'
import { inputCls } from './ui'

/**
 * Selector de iconos: vista previa del elegido, búsqueda fija arriba (nombre o sinónimo), sugerencias según el nombre y su
 * contexto, familias como filtros y una cuadrícula compacta con desplazamiento. Reutiliza el catálogo de iconos de la app
 * (los mismos que se guardan en la hoja). Las sugerencias no restringen: siempre se puede elegir cualquier icono.
 */
export function IconPicker({ value, onChange, color, nombre, contexto }: { value: string; onChange: (k: string) => void; color: string; nombre: string; contexto: string[] }) {
  const [q, setQ] = useState('')
  const [familia, setFamilia] = useState<string>('Todos')
  const sugeridos = useMemo(() => sugerirIconos(nombre, contexto), [nombre, contexto])
  const lista = useMemo(() => buscarIconos(q), [q])
  const Actual = ICONS[value] as (typeof ICONS)[string] | undefined
  const boton = (i: IconoDef) => {
    const on = value === i.key
    return (
      <button key={i.key} type="button" aria-label={`Icono ${i.key}`} aria-pressed={on} title={i.sin ? `${i.key} · ${i.sin}` : i.key} onClick={() => onChange(i.key)}
        className={`relative grid aspect-square place-items-center rounded-xl border transition outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-navy/40 ${on ? 'shadow-sm' : 'border-line bg-card hover:bg-bg'}`}
        style={on ? { borderColor: color, background: `${color}1F`, color } : undefined}>
        <i.Icon className="size-[18px]" />
        {on && <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full text-white" style={{ background: color }}><Check className="size-2.5" strokeWidth={3.5} aria-hidden /></span>}
      </button>
    )
  }
  const grid = 'grid grid-cols-7 gap-1.5 sm:grid-cols-10'
  const chip = (nombreF: string, n?: number) => (
    <button key={nombreF} type="button" aria-pressed={familia === nombreF} onClick={() => setFamilia(nombreF)}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${familia === nombreF ? 'border-transparent bg-navy text-white' : 'border-line text-muted hover:bg-bg'}`}>
      {nombreF}{n !== undefined && <span className="ml-1 font-normal opacity-70">{n}</span>}
    </button>
  )
  const familias = GRUPOS.filter(g => lista.some(i => i.grupo === g))
  const visibles = familia === 'Todos' || familia === 'Sugeridos' ? familias : familias.filter(g => g === familia)
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card" data-testid="icon-picker-root">
      <div className="flex items-center gap-3 border-b border-line bg-bg/50 px-3 py-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1F`, color }} data-testid="icono-elegido">
          {Actual ? <Actual className="size-5" /> : <Search className="size-4 text-muted" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted">Icono elegido</p>
          <p className="truncate text-sm font-semibold">{Actual ? value : 'Ninguno'}</p>
        </div>
        <label className="relative w-48 max-w-[55%]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input aria-label="Buscar icono" className={`${inputCls} !h-9 pr-8 pl-8 text-[13px]`} placeholder="Buscar: comida, gasolina…" value={q} onChange={e => { setQ(e.target.value); setFamilia('Todos') }} />
          {q && <button type="button" aria-label="Limpiar búsqueda" onClick={() => setQ('')} className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-bg"><X className="size-3.5" /></button>}
        </label>
      </div>
      {!q && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2" role="group" aria-label="Familias de iconos">
          {chip('Todos')}
          {sugeridos.length > 0 && chip('Sugeridos', sugeridos.length)}
          {GRUPOS.map(g => chip(g))}
        </div>
      )}
      <div className="max-h-60 space-y-3 overflow-y-auto overscroll-contain p-3" data-testid="icon-picker">
        {q ? (
          lista.length ? <div className={grid} aria-label="Resultados">{lista.map(boton)}</div>
            : <p className="py-4 text-center text-xs text-muted">Sin resultados para “{q}”. Prueba con otra palabra.</p>
        ) : (
          <>
            {sugeridos.length > 0 && (familia === 'Todos' || familia === 'Sugeridos') && <section aria-label="Sugeridos"><p className="mb-1.5 text-[11px] font-semibold text-navy">Sugeridos</p><div className={grid}>{sugeridos.map(boton)}</div></section>}
            {familia !== 'Sugeridos' && visibles.map(gr => (
              <section key={gr} aria-label={gr}><p className="mb-1.5 text-[11px] font-semibold text-muted">{gr}</p><div className={grid}>{lista.filter(i => i.grupo === gr).map(boton)}</div></section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
