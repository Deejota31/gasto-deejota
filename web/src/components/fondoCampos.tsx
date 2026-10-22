import { useMemo, useState } from 'react'
import { Layers, Plus, Shapes, Tag } from 'lucide-react'
import { normName, otrosAlFinal } from '../lib/orden'
import { ambitoLook, categoriaLook, subcategoriaLook, medioLook, sortMedios, type Look } from '../lib/visual'
import type { CatalogoItem, ModoMedios, Ruta, TipoCobertura } from '../lib/types'
import { Button, Chip, Field } from './ui'
import { Combobox, type Opcion } from './Combobox'
import { MultiSelect, type Option } from './shared'

/** Piezas compartidas por «Nuevo fondo» y el formulario de plantillas de fondos: mismos campos, mismas reglas. */

export const COBERTURAS: Opcion[] = [
  { value: 'todos', label: 'Todos los gastos', Icon: Layers }, { value: 'ambito', label: 'Por ámbito', Icon: Layers },
  { value: 'categoria', label: 'Por categoría', Icon: Shapes }, { value: 'subcategoria', label: 'Por subcategoría', Icon: Tag }, { value: 'personalizada', label: 'Personalizada', Icon: Plus },
]
/** «Todos excepto» ya no se ofrece al crear: solo aparece si el fondo que se edita ya lo usa (compatibilidad con datos antiguos). */
export const opcionesModoMedios = (conExcepto: boolean): Opcion[] => [
  { value: 'todos', label: 'Todos los medios' },
  ...(conExcepto ? [{ value: 'excepto', label: 'Todos excepto… (heredado)' }] : []),
  { value: 'solo', label: 'Solo seleccionados' },
]
export const TODOS = '__todos__'
export const rutaTxt = (ru: Ruta) => [ru.ambito || 'Todos los ámbitos', ru.categoria || 'Todas las categorías', ru.subcategoria].filter(Boolean).join(' › ')
export const mismaRuta = (a: Ruta, b: Ruta) => normName(a.ambito) === normName(b.ambito) && normName(a.categoria) === normName(b.categoria) && normName(a.subcategoria) === normName(b.subcategoria)

/** Medios del fondo: selector del modo y, a la derecha, el multiselect de medios permitidos con chips quitables. */
export function MediosCampos({ medios, modo, onModo, lista, onLista, etiquetaLista, invalid, idBase = 'fondo' }: {
  medios: string[]; modo: ModoMedios; onModo: (m: ModoMedios) => void; lista: string[]; onLista: (l: string[]) => void; etiquetaLista?: string; invalid?: boolean; idBase?: string
}) {
  const catalogo = useMemo(() => sortMedios([...new Set([...medios, ...lista])]), [medios, lista])
  const options: Option[] = catalogo.map(m => ({ value: m, label: m, look: medioLook(m) }))
  const etiqueta = etiquetaLista ?? (modo === 'excepto' ? 'Medios excluidos' : 'Medios permitidos')
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Medios de pago" htmlFor={`${idBase}-modo-medios`}>
          <Combobox id={`${idBase}-modo-medios`} label="Medios de pago del fondo" value={modo} onChange={v => onModo(v as ModoMedios)} options={opcionesModoMedios(modo === 'excepto')} />
        </Field>
        {modo !== 'todos' && (
          <Field label={etiqueta} htmlFor={`${idBase}-medios`} error={invalid && !lista.length ? 'Elige al menos un medio' : undefined}>
            <MultiSelect id={`${idBase}-medios`} variant="campo" label={etiqueta} options={options} value={lista} onChange={onLista}
              placeholder={modo === 'excepto' ? 'Elige los medios a excluir' : 'Elige los medios permitidos'} invalid={invalid && !lista.length} />
          </Field>
        )}
      </div>
      {modo !== 'todos' && lista.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Medios elegidos" data-testid="fondo-medios-elegidos">
          {lista.map(m => { const l = medioLook(m); return (
            <li key={m}><Chip label={m} Icon={l.Icon} color={l.color} onRemove={() => onLista(lista.filter(x => x !== m))} removeLabel={`Quitar ${m}`} /></li>) })}
        </ul>
      )}
    </>
  )
}

/** Editor de cobertura: selects con los mismos iconos y colores que los filtros; las opciones salen del catálogo vigente. */
export function EditorCobertura({ tipo, rutas, onRutas, catalogo }: { tipo: Exclude<TipoCobertura, 'todos'>; rutas: Ruta[]; onRutas: (r: Ruta[]) => void; catalogo: CatalogoItem[] }) {
  const vig = useMemo(() => catalogo.filter(c => c.activo !== false), [catalogo])
  const ambitos = useMemo(() => otrosAlFinal([...new Set(vig.map(c => c.ambito))]), [vig])
  const [amb, setAmb] = useState(tipo === 'ambito' ? '' : (rutas[0]?.ambito ?? ambitos[0] ?? ''))
  const [cat, setCat] = useState(rutas[0]?.categoria ?? '')
  const [sub, setSub] = useState('')
  const cats = useMemo(() => otrosAlFinal([...new Set(vig.filter(c => c.categoria && (!amb || amb === TODOS || c.ambito === amb)).map(c => c.categoria))].sort((a, b) => a.localeCompare(b))), [vig, amb])
  const subs = useMemo(() => otrosAlFinal([...new Set(vig.filter(c => c.subcategoria && c.categoria === cat && (!amb || amb === TODOS || c.ambito === amb)).map(c => c.subcategoria))].sort((a, b) => a.localeCompare(b))), [vig, amb, cat])
  const ambRuta = amb === TODOS ? '' : amb
  const tiene = (ru: Ruta) => rutas.some(x => mismaRuta(x, ru))
  const optAmb: Opcion[] = ambitos.map(a => { const l = ambitoLook(a, catalogo); return { value: a, label: a, Icon: l.Icon, color: l.color } })
  const optCat = (conTodas: boolean): Opcion[] => [...(conTodas ? [{ value: '', label: 'Todas las categorías' }] : []),
    ...cats.map(c => { const l = categoriaLook(c, catalogo, ambRuta); return { value: c, label: c, Icon: l.Icon, color: l.color } })]
  const optSub: Opcion[] = [{ value: '', label: 'Todas las subcategorías' }, ...subs.map(s => { const l = subcategoriaLook(s, cat, catalogo, ambRuta); return { value: s, label: s, Icon: l.Icon, color: l.color } })]
  /** Multiselect que agrega/quita rutas del nivel actual sin tocar las que se eligieron en otros ámbitos. */
  const multi = (opciones: string[], ruta: (v: string) => Ruta, etiqueta: string, look: (v: string) => Look) => (
    <MultiSelect variant="campo" id={`cob-multi-${tipo}`} label={etiqueta} placeholder={`Elige ${etiqueta.toLowerCase()}`}
      options={opciones.map(o => ({ value: o, label: o, look: look(o) }))}
      value={opciones.filter(o => tiene(ruta(o)))}
      onChange={next => {
        const nivel = new Set(opciones.map(o => JSON.stringify([normName(ruta(o).ambito), normName(ruta(o).categoria), normName(ruta(o).subcategoria)])))
        const resto = rutas.filter(x => !nivel.has(JSON.stringify([normName(x.ambito), normName(x.categoria), normName(x.subcategoria)])))
        onRutas([...resto, ...next.map(ruta)])
      }} />
  )
  const selAmbito = (conTodos: boolean) => (
    <Field label="Ámbito" htmlFor="cob-ambito">
      <Combobox id="cob-ambito" label="Ámbito" value={amb} onChange={v => { setAmb(v); setCat(''); setSub('') }} caption="Ámbito"
        options={[...(conTodos ? [{ value: TODOS, label: 'Todos los ámbitos' }] : []), ...optAmb]} />
    </Field>
  )
  return (
    <div className="space-y-3 rounded-xl border border-line p-3" data-testid="editor-cobertura">
      <div data-testid="opciones-cobertura" className="space-y-3">
        {tipo === 'ambito' && <Field label="Ámbitos" htmlFor="cob-multi-ambito">{multi(ambitos, a => ({ ambito: a, categoria: '', subcategoria: '' }), 'Ámbitos', a => ambitoLook(a, catalogo))}</Field>}
        {tipo === 'categoria' && <>
          {selAmbito(true)}
          <p className="text-[11px] text-muted">{amb === TODOS ? 'Con “Todos los ámbitos” la categoría cuenta en cada ámbito donde exista con ese nombre.' : 'Elige las categorías de este ámbito; puedes cambiar de ámbito y seguir agregando.'}</p>
          <Field label="Categorías" htmlFor="cob-multi-categoria">{multi(cats, c => ({ ambito: ambRuta, categoria: c, subcategoria: '' }), 'Categorías', c => categoriaLook(c, catalogo, ambRuta))}</Field>
        </>}
        {tipo === 'subcategoria' && <>
          <div className="grid gap-3 sm:grid-cols-2">
            {selAmbito(true)}
            <Field label="Categoría" htmlFor="cob-cat">
              <Combobox id="cob-cat" label="Categoría" value={cat} onChange={v => { setCat(v); setSub('') }} placeholder="Elige una categoría…" searchable options={optCat(false)} />
            </Field>
          </div>
          {cat
            ? <Field label="Subcategorías" htmlFor="cob-multi-subcategoria">{multi(subs, s => ({ ambito: ambRuta, categoria: cat, subcategoria: s }), 'Subcategorías', s => subcategoriaLook(s, cat, catalogo, ambRuta))}</Field>
            : <p className="text-xs text-muted">Elige una categoría para ver sus subcategorías.</p>}
        </>}
        {tipo === 'personalizada' && <>
          <div className="grid gap-3 sm:grid-cols-3">
            {selAmbito(true)}
            <Field label="Categoría" htmlFor="cob-cat">
              <Combobox id="cob-cat" label="Categoría" value={cat} onChange={v => { setCat(v); setSub('') }} placeholder="Todas las categorías" searchable clearable options={optCat(false)} />
            </Field>
            <Field label="Subcategoría" htmlFor="cob-sub">
              <Combobox id="cob-sub" label="Subcategoría" value={sub} onChange={setSub} disabled={!cat} placeholder="Todas las subcategorías" searchable clearable options={optSub.slice(1)} />
            </Field>
          </div>
          <Button type="button" variant="soft" className="h-9 text-xs" disabled={(!ambRuta && !cat) || tiene({ ambito: ambRuta, categoria: cat, subcategoria: cat ? sub : '' })}
            onClick={() => onRutas([...rutas, { ambito: ambRuta, categoria: cat, subcategoria: cat ? sub : '' }])}><Plus className="size-3.5" /> Agregar ruta</Button>
        </>}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Cobertura elegida" data-testid="rutas-elegidas">
        {!rutas.length && <li className="text-xs text-muted">Aún no elegiste qué gastos cubre.</li>}
        {rutas.map(ru => <li key={rutaTxt(ru)}><Chip label={rutaTxt(ru)} onRemove={() => onRutas(rutas.filter(x => !mismaRuta(x, ru)))} removeLabel={`Quitar ${rutaTxt(ru)}`} /></li>)}
      </ul>
    </div>
  )
}
