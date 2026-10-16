import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, FolderTree, Layers, Pencil, Plus, Search, Shapes, Tag, Trash2, Wallet } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { CatalogoItem } from '../lib/types'
import { ambitoLook, categoriaLook, COLORS, ICONS, subcategoriaLook } from '../lib/visual'
import { IconPicker } from '../components/IconPicker'
import { ColorPicker } from '../components/Apariencia'
import { MediosPago, type MedioEdicion } from '../components/MediosPago'
import { isOtros, normName, otrosAlFinal } from '../lib/orden'
import { dependenciasCategoria } from '../lib/dependencias'
import { MenuAcciones } from '../components/MenuAcciones'
import { Combobox } from '../components/Combobox'
import { Button, Checkbox, Empty, ErrorBox, Field, IconButton, IconTile, inputCls, Modal, Skeleton, Switch, claseBoton } from '../components/ui'

type Nivel = 'ambito' | 'categoria' | 'subcategoria'
interface Target { mode: 'create' | 'edit'; nivel: Nivel; ambito?: string; categoria?: string; subcategoria?: string }

interface CatNode { name: string; head?: CatalogoItem; activo: boolean; subs: CatalogoItem[] }
interface AmbNode { name: string; head?: CatalogoItem; activo: boolean; cats: CatNode[] }

function buildTree(catalogo: CatalogoItem[]): AmbNode[] {
  const out = new Map<string, AmbNode>()
  for (const c of catalogo) {
    const a = out.get(c.ambito) ?? { name: c.ambito, activo: true, cats: [] }
    out.set(c.ambito, a)
    if (!c.categoria) { a.head = c; a.activo = c.activo; continue }
    let cat = a.cats.find(x => x.name === c.categoria)
    if (!cat) { cat = { name: c.categoria, activo: true, subs: [] }; a.cats.push(cat) }
    if (!c.subcategoria) { cat.head = c; cat.activo = c.activo } else cat.subs.push(c)
  }
  // El catálogo llega ordenado (sortCatalogo); esto solo garantiza "Otros" al final de cada grupo.
  return otrosAlFinal([...out.values()], a => a.name).map(a => ({
    ...a, cats: otrosAlFinal(a.cats, c => c.name).map(c => ({ ...c, subs: otrosAlFinal(c.subs, x => x.subcategoria) })),
  }))
}

/** Resalta las coincidencias de la búsqueda. */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="rounded bg-[#FDE68A] px-0.5 text-ink dark:bg-[#7C5E10]">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export default function Categorias({ store }: { store: AppStore }) {
  const catalogo = useMemo(() => store.data?.catalogo ?? [], [store.data?.catalogo])
  const tree = useMemo(() => buildTree(catalogo), [catalogo])
  const [sel, setSel] = useState('')
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  const [medioEd, setMedioEd] = useState<MedioEdicion>(null)
  const [borrar, setBorrar] = useState<{ ambito: string; cat: CatNode } | null>(null)
  const term = q.trim().toLowerCase()
  const current = tree.find(a => a.name === sel) ?? tree[0]

  const activos = catalogo.filter(c => c.activo)
  const stats = [
    { label: 'Ámbitos', n: tree.filter(a => a.activo).length, Icon: Layers, cls: 'bg-primary-soft text-navy' },
    { label: 'Categorías', n: new Set(activos.filter(c => c.categoria).map(c => `${c.ambito}|${c.categoria}`)).size, Icon: Shapes, cls: 'bg-coral-soft text-coral' },
    { label: 'Subcategorías', n: activos.filter(c => c.subcategoria).length, Icon: Tag, cls: 'bg-verde-soft text-verde' },
    { label: 'Medios de pago', n: (store.data?.medios ?? []).filter(m => m.activo && m.nombre.trim()).length, Icon: Wallet, cls: 'bg-turquesa/10 text-turquesa' },
  ]

  /** ON/OFF de un ámbito o categoría: solo cambia su Activo; las subcategorías conservan su estado individual. */
  const alternar = (ambito: string, categoria: string, activo: boolean) => {
    const que = categoria ? 'categoría' : 'ámbito', nombre = categoria || ambito
    store.track(`act:${ambito}|${categoria}`,
      { pending: `${activo ? 'Activando' : 'Desactivando'} ${que}…`, ok: `${que === 'ámbito' ? 'Ámbito' : 'Categoría'} “${nombre}” ${activo ? 'activ' : 'desactiv'}${que === 'ámbito' ? 'ado' : 'ada'}.`, error: `No se pudo cambiar “${nombre}”.` },
      () => store.actions.saveCatalogo({ ambito, categoria, subcategoria: '', activo }))
  }
  /** Sube o baja una categoría dentro de su ámbito ("Otros" siempre queda al final). */
  const mover = (a: AmbNode, nombre: string, d: -1 | 1) => {
    const nombres = a.cats.map(c => c.name)
    const fijas = nombres.filter(n => !isOtros(n)), i = fijas.indexOf(nombre), j = i + d
    if (i < 0 || j < 0 || j >= fijas.length) return
    ;[fijas[i], fijas[j]] = [fijas[j], fijas[i]]
    const nuevo = [...fijas, ...nombres.filter(isOtros)]
    store.track(`orden:${a.name}`, { pending: 'Guardando el orden…', ok: `“${nombre}” ${d < 0 ? 'subió' : 'bajó'} de posición.`, error: 'No se pudo guardar el orden. Se restauró el anterior.' },
      () => store.actions.reorderCategorias(a.name, nuevo))
  }

  const results = term ? tree.map(a => ({
    ...a,
    cats: a.cats.map(c => ({ ...c, subs: c.subs.filter(s => s.subcategoria.toLowerCase().includes(term)) }))
      .filter(c => c.name.toLowerCase().includes(term) || c.subs.length || a.name.toLowerCase().includes(term)),
  })).filter(a => a.cats.length || a.name.toLowerCase().includes(term)) : []

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_16px_rgb(15_23_42/0.04)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-navy"><FolderTree className="size-5" /></span>
          <div className="mr-auto">
            <h1 className="text-base font-semibold">Catálogo</h1>
            <p className="text-xs text-muted">Ámbito → categoría → subcategoría, y tus medios de pago. Desactivar oculta una opción sin perder el historial.</p>
          </div>
          <label className="relative order-last w-full sm:order-none sm:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
            <input aria-label="Buscar en el catálogo" placeholder="Buscar ámbito, categoría o subcategoría…" className={`${inputCls} h-10 pl-9`} value={q} onChange={e => setQ(e.target.value)} />
          </label>
          <MenuAcciones label="Agregar al catálogo" ancho={240} disabled={!store.data}
            triggerClass={claseBoton('primary')}
            trigger={<><Plus className="size-4" /> Agregar <ChevronDown className="size-4" /></>}
            acciones={[
              { key: 'ambito', label: 'Nuevo ámbito', icon: <Layers className="size-4" />, onClick: () => setTarget({ mode: 'create', nivel: 'ambito', ambito: current?.name }) },
              { key: 'categoria', label: 'Nueva categoría', icon: <Shapes className="size-4" />, onClick: () => setTarget({ mode: 'create', nivel: 'categoria', ambito: current?.name }) },
              { key: 'subcategoria', label: 'Nueva subcategoría', icon: <Tag className="size-4" />, onClick: () => setTarget({ mode: 'create', nivel: 'subcategoria', ambito: current?.name }) },
              { key: 'medio', label: 'Nuevo medio de pago', icon: <Wallet className="size-4" />, onClick: () => { setQ(''); setMedioEd('nuevo') } },
            ]} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(s => (
            <div key={s.label} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <span className={`grid size-9 place-items-center rounded-xl ${s.cls}`}><s.Icon className="size-4" /></span>
              <div><p className="tabular text-xl font-bold">{s.n}</p><p className="text-xs text-muted">{s.label}</p></div>
            </div>
          ))}
        </div>
      </section>

      {!store.data ? <Skeleton className="h-64" /> : !tree.length ? (
        (store.data.medios ?? []).some(m => m.nombre.trim())
          ? <Empty icon={<FolderTree className="size-5" />} title="Aún no tienes ámbitos">Usa “Agregar” para crear tu primer ámbito.</Empty>
          : <Empty icon={<FolderTree className="size-5" />} title="Aún no tienes elementos en tu catálogo">Añade ámbitos, categorías, subcategorías o medios de pago para organizarlos.</Empty>
      ) : term ? (
        <section className="space-y-3" aria-label="Resultados de búsqueda">
          {!results.length && <Empty icon={<Search className="size-5" />} title="Sin coincidencias">Prueba con otra palabra.</Empty>}
          {results.map(a => (
            <div key={a.name} className="rounded-2xl border border-line bg-card p-4">
              <AmbHeader a={a} catalogo={catalogo} q={term} />
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {a.cats.map(c => <CatCard key={c.name} a={a.name} ambActivo={a.activo} c={c} catalogo={catalogo} q={term} onEdit={setTarget} reorder={false} busy={store.pending.has(`act:${a.name}|${c.name}`)}
                  onToggle={v => alternar(a.name, c.name, v)} onDelete={() => setBorrar({ ambito: a.name, cat: c })} />)}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <>
          <div role="tablist" aria-label="Ámbitos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {tree.map(a => {
              const l = ambitoLook(a.name, catalogo)
              const on = current?.name === a.name
              const subs = a.cats.reduce((s, c) => s + c.subs.filter(x => x.activo).length, 0)
              return (
                <div key={a.name} className="relative">
                  <button role="tab" aria-selected={on} type="button" onClick={() => setSel(a.name)}
                    className={`block w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${on ? 'shadow-md' : 'border-line bg-card hover:shadow-sm'} ${a.activo ? '' : 'opacity-60'}`}
                    style={on ? { borderColor: l.color, background: `linear-gradient(135deg, ${l.color}14, ${l.color}26)` } : undefined}>
                    <div className="flex items-center gap-2.5">
                      <IconTile color={l.color} Icon={l.Icon} />
                      <div className="min-w-0 pr-10">
                        <p className="truncate text-sm font-semibold" title={a.name}>{a.name}</p>
                        <p className="text-[11px] text-muted">{a.cats.filter(c => c.activo).length} categorías · {subs} sub.{!a.activo && ' · inactivo'}</p>
                      </div>
                    </div>
                  </button>
                  <span className="absolute top-2.5 right-2.5">
                    <Switch compact checked={a.activo} disabled={store.pending.has(`act:${a.name}|`)} label={`Ámbito ${a.name} activo`}
                      title={a.activo ? 'Activo: toca para desactivar (sus categorías y subcategorías dejan de ofrecerse)' : 'Inactivo: toca para reactivar'} onChange={v => alternar(a.name, '', v)} />
                  </span>
                </div>
              )
            })}
          </div>

          {current && (
            <section className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <AmbHeader a={current} catalogo={catalogo} q="" />
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" onClick={() => setTarget({ mode: 'edit', nivel: 'ambito', ambito: current.name })}><Pencil className="size-4" /> Editar ámbito</Button>
                  <Button variant="soft" onClick={() => setTarget({ mode: 'create', nivel: 'categoria', ambito: current.name })}><Plus className="size-4" /> Categoría</Button>
                </div>
              </div>
              {!current.cats.length ? <Empty icon={<Shapes className="size-5" />} title="Sin categorías">Agrega la primera categoría de este ámbito.</Empty> : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {current.cats.map(c => {
                    const fijas = current.cats.filter(x => !isOtros(x.name)), i = fijas.findIndex(x => x.name === c.name)
                    return <CatCard key={c.name} a={current.name} ambActivo={current.activo} c={c} catalogo={catalogo} q="" onEdit={setTarget} reorder
                      puedeSubir={i > 0} puedeBajar={i >= 0 && i < fijas.length - 1} onMove={d => mover(current, c.name, d)}
                      busy={store.pending.has(`act:${current.name}|${c.name}`)} onToggle={v => alternar(current.name, c.name, v)} onDelete={() => setBorrar({ ambito: current.name, cat: c })} />
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {store.data && !term && (
        <section className="rounded-2xl border border-line bg-card p-4" aria-label="Medios de pago">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-turquesa/10 text-turquesa"><Wallet className="size-4" /></span>
            <div><h2 className="text-sm font-semibold">Medios de pago</h2><p className="text-xs text-muted">Con qué pagas tus gastos. Cada uno se ve igual en toda la web.</p></div>
          </div>
          <MediosPago store={store} editando={medioEd} setEditando={setMedioEd} />
        </section>
      )}

      {borrar && <BorrarCategoria store={store} ambito={borrar.ambito} cat={borrar.cat} onClose={() => setBorrar(null)}
        onDesactivar={() => { const b = borrar; setBorrar(null); if (b.cat.activo) alternar(b.ambito, b.cat.name, false) }} />}
      {target && <CatalogModal key={JSON.stringify(target)} store={store} target={target} tree={tree} onClose={() => setTarget(null)} />}
    </div>
  )
}

function AmbHeader({ a, catalogo, q }: { a: AmbNode; catalogo: CatalogoItem[]; q: string }) {
  const l = ambitoLook(a.name, catalogo)
  return (
    <div className="flex items-center gap-2.5">
      <IconTile color={l.color} Icon={l.Icon} size="lg" />
      <div>
        <h2 className="text-base font-semibold"><Hl text={a.name} q={q} /></h2>
        <p className="text-xs text-muted">{a.cats.length} categorías · {a.cats.reduce((s, c) => s + c.subs.length, 0)} subcategorías{!a.activo && ' · inactivo'}</p>
      </div>
    </div>
  )
}

function CatCard({ a, ambActivo, c, catalogo, q, onEdit, reorder, puedeSubir, puedeBajar, onMove, busy, onToggle, onDelete }: {
  a: string; ambActivo: boolean; c: CatNode; catalogo: CatalogoItem[]; q: string; onEdit: (t: Target) => void; reorder: boolean
  puedeSubir?: boolean; puedeBajar?: boolean; onMove?: (d: -1 | 1) => void; busy: boolean; onToggle: (v: boolean) => void; onDelete: () => void
}) {
  const l = categoriaLook(c.name, catalogo, a)
  const efectiva = c.activo && ambActivo
  const sinOrden = !reorder ? 'Quita la búsqueda para reordenar' : isOtros(c.name) ? '“Otros” siempre va al final' : undefined
  return (
    <article className={`min-w-0 rounded-2xl border border-line p-3 transition hover:shadow-sm ${efectiva ? '' : 'opacity-60'}`} style={{ background: `linear-gradient(160deg, ${l.color}0D, transparent 60%)` }} data-testid="cat-card" data-cat={c.name}>
      <div className="flex items-center gap-2">
        <IconTile color={l.color} Icon={l.Icon} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold ${c.activo ? '' : 'line-through'}`} title={c.name}><Hl text={c.name} q={q} /></p>
          <p className="text-[11px] text-muted">{c.subs.filter(s => s.activo).length} subcategorías{!c.activo ? ' · inactiva' : !ambActivo ? ' · ámbito inactivo' : ''}</p>
        </div>
        <Switch compact checked={c.activo} disabled={busy} label={`Categoría ${c.name} activa`}
          title={c.activo ? 'Activa: toca para desactivar (sus subcategorías conservan su estado)' : 'Inactiva: toca para reactivar'} onChange={onToggle} />
        <IconButton label={`Agregar subcategoría a ${c.name}`} tone="primary" onClick={() => onEdit({ mode: 'create', nivel: 'subcategoria', ambito: a, categoria: c.name })}><Plus className="size-4" /></IconButton>
        <MenuAcciones label={`Acciones de ${c.name}`} acciones={[
          { key: 'edit', label: 'Editar', icon: <Pencil className="size-3.5" />, onClick: () => onEdit({ mode: 'edit', nivel: 'categoria', ambito: a, categoria: c.name }) },
          { key: 'up', label: 'Subir', icon: <ArrowUp className="size-3.5" />, onClick: () => onMove?.(-1), disabled: !reorder || !puedeSubir, title: sinOrden ?? (puedeSubir ? undefined : 'Ya es la primera') },
          { key: 'down', label: 'Bajar', icon: <ArrowDown className="size-3.5" />, onClick: () => onMove?.(1), disabled: !reorder || !puedeBajar, title: sinOrden ?? (puedeBajar ? undefined : 'Ya es la última') },
          { key: 'delete', label: 'Eliminar', icon: <Trash2 className="size-3.5" />, onClick: onDelete, danger: true },
        ]} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {c.subs.map(s => { const SI = subcategoriaLook(s.subcategoria, c.name, catalogo, a).Icon; return (
          <button key={s.subcategoria} type="button" title={s.activo ? 'Editar o desactivar' : 'Inactiva: clic para editar o reactivar'}
            onClick={() => onEdit({ mode: 'edit', nivel: 'subcategoria', ambito: a, categoria: c.name, subcategoria: s.subcategoria })}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition hover:brightness-95 ${s.activo ? '' : 'line-through opacity-60'}`}
            style={{ background: `${l.color}14`, borderColor: `${l.color}33`, color: l.color }}>
            <SI className="size-3" aria-hidden /><Hl text={s.subcategoria} q={q} />
          </button>
        ) })}
        {!c.subs.length && <span className="text-xs text-muted">Sin subcategorías</span>}
      </div>
    </article>
  )
}

function CatalogModal({ store, target, tree, onClose }: { store: AppStore; target: Target; tree: AmbNode[]; onClose: () => void }) {
  const catalogo = store.data?.catalogo ?? []
  const { mode, nivel } = target
  const amb = tree.find(a => a.name === target.ambito)
  const cat = amb?.cats.find(c => c.name === target.categoria)
  const sub = cat?.subs.find(s => s.subcategoria === target.subcategoria)
  const original = nivel === 'ambito' ? target.ambito ?? '' : nivel === 'categoria' ? target.categoria ?? '' : target.subcategoria ?? ''
  const look = nivel === 'ambito' ? ambitoLook(target.ambito ?? '', catalogo) : nivel === 'categoria' || mode === 'create'
    ? categoriaLook(target.categoria ?? '', catalogo, target.ambito) : subcategoriaLook(target.subcategoria ?? '', target.categoria ?? '', catalogo, target.ambito)
  const head = nivel === 'ambito' ? amb?.head : nivel === 'categoria' ? cat?.head : sub
  const iconKey = Object.entries(ICONS).find(([, I]) => I === look.Icon)?.[0] ?? 'tag'

  const [ambito, setAmbito] = useState(target.ambito ?? tree[0]?.name ?? '')
  const [categoria, setCategoria] = useState(target.categoria ?? '')
  const [nombre, setNombre] = useState(mode === 'edit' ? original : '')
  const iconoInicial = mode === 'edit' ? (head?.icono || iconKey) : 'tag'
  const [icono, setIcono] = useState(iconoInicial)
  const [color, setColor] = useState(mode === 'edit' ? (head?.color || look.color) : COLORS[0])
  const [activo, setActivo] = useState(mode === 'edit' ? (nivel === 'ambito' ? amb?.activo : nivel === 'categoria' ? cat?.activo : sub?.activo) ?? true : true)
  const cats = tree.find(a => a.name === ambito)?.cats.map(c => c.name) ?? []
  const label = { ambito: 'ámbito', categoria: 'categoría', subcategoria: 'subcategoría' }[nivel]
  const masc = nivel === 'ambito'
  // Ámbitos y categorías: icono y color. Subcategorías: solo icono (el color es el de su categoría, para no hacer un arcoíris).
  const usaVisual = nivel !== 'subcategoria'
  const colorSub = nivel === 'subcategoria' ? categoriaLook(categoria || target.categoria || '', catalogo, ambito).color : color
  const enUso = mode === 'edit' && nombre.trim() !== original
    ? (store.data?.gastos ?? []).filter(g => g.ambito === target.ambito && (nivel === 'ambito' || g.categoria === target.categoria) && (nivel !== 'subcategoria' || g.subcategoria === target.subcategoria)).length
    : 0

  // No bloquea: valida, cierra y la escritura sigue en segundo plano; el resultado llega como notificación.
  // La validación se recalcula con cada cambio: tras el primer intento, el error desaparece en cuanto el campo es válido.
  const n = nombre.trim().replace(/\s+/g, ' ')
  const claveCat = (a: string, c: string, s: string) => `${normName(a)}|${normName(c)}|${normName(s)}`
  const finalKey = nivel === 'ambito' ? claveCat(n, '', '') : nivel === 'categoria' ? claveCat(ambito, n, '') : claveCat(ambito, categoria, n)
  const [intentado, setIntentado] = useState(false)
  function validar(): string {
    if (!n) return `Escribe el nombre ${masc ? 'del' : 'de la'} ${label}.`
    if (nivel !== 'ambito' && !ambito) return 'Elige un ámbito.'
    if (nivel === 'subcategoria' && !categoria) return 'Elige una categoría.'
    const exists = catalogo.some(c => claveCat(c.ambito, nivel === 'ambito' ? '' : c.categoria, nivel === 'subcategoria' ? c.subcategoria : '') === finalKey)
    if (exists && (mode === 'create' || normName(n) !== normName(original))) return `Ya existe ese nombre en este ${nivel === 'subcategoria' ? 'categoría' : nivel === 'categoria' ? 'ámbito' : 'catálogo'}.`
    return ''
  }
  const error = intentado ? validar() : ''

  function save() {
    setIntentado(true)
    if (validar()) return
    let renombrado = false
    const a = nivel === 'ambito' ? n : ambito
    const c = nivel === 'ambito' ? '' : nivel === 'categoria' ? n : categoria
    const s = nivel === 'subcategoria' ? n : ''
    const ok = store.track(`cat:${finalKey}`, mode === 'create'
    const Label = `${label.charAt(0).toUpperCase()}${label.slice(1)}`
      ? { pending: `Creando ${label}…`, ok: `${Label} ${masc ? 'creado' : 'creada'} correctamente.`, error: `No se pudo crear ${masc ? 'el' : 'la'} ${label}.` }
      : { pending: `Actualizando ${label}…`, ok: `${Label} ${masc ? 'actualizado' : 'actualizada'} correctamente.`, error: `Error al actualizar ${masc ? 'el' : 'la'} ${label}.` },
    async () => {
      // Si el renombrado ya se guardó y falló el paso siguiente, "Reintentar" no lo repite.
      if (mode === 'edit' && n !== original && !renombrado) {
        await store.actions.renameCatalogo({ nivel, ambito: target.ambito!, categoria: target.categoria, subcategoria: target.subcategoria, nuevo: n })
        renombrado = true
      }
      await store.actions.saveCatalogo({ ambito: a, categoria: c, subcategoria: s, activo, ...(heredado ? {} : usaVisual ? { icono, color } : icono !== iconoInicial ? { icono } : {}) })
    })
    if (ok) onClose()
  }

  // Categorías y subcategorías se comparten entre ámbitos: si el nombre ya existe en otro, usa su mismo icono y color.
  const nn = normName(nombre)
  const hermana = mode === 'create' && nn && nivel !== 'ambito'
    ? catalogo.find(c => c.ambito !== ambito && (nivel === 'categoria' ? !!c.categoria && !c.subcategoria && normName(c.categoria) === nn
      : c.categoria === categoria && !!c.subcategoria && normName(c.subcategoria) === nn))   // solo "otro" ámbito: si ya existe en este, el error de duplicado basta
    : undefined
  const heredado = hermana ? (nivel === 'categoria' ? categoriaLook(hermana.categoria, catalogo) : subcategoriaLook(hermana.subcategoria, hermana.categoria, catalogo)) : null
  const Preview = heredado ? heredado.Icon : ICONS[icono] ?? ICONS.tag
  return (
    <Modal open onClose={onClose} size="md" title={`${mode === 'create' ? (masc ? 'Nuevo' : 'Nueva') : 'Editar'} ${label}`}
      subtitle={mode === 'create' ? 'Aparecerá de inmediato en el formulario de gastos.' : 'Los gastos existentes conservan su clasificación.'}
      icon={<Preview className="size-5" style={{ color: heredado ? heredado.color : colorSub }} />}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{mode === 'create' ? 'Agregar' : 'Guardar'}</Button></>}>
      <div className="space-y-4">
        {nivel !== 'ambito' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ámbito" htmlFor="cm-amb">
              <Combobox id="cm-amb" label="Ámbito" disabled={mode === 'edit'} value={ambito} onChange={v => { setAmbito(v); setCategoria('') }}
                options={tree.map(a => { const l = ambitoLook(a.name, catalogo); return { value: a.name, label: a.name, Icon: l.Icon, color: l.color } })} />
            </Field>
            {nivel === 'subcategoria' && (
              <Field label="Categoría" htmlFor="cm-cat">
                <Combobox id="cm-cat" label="Categoría" disabled={mode === 'edit'} value={categoria} onChange={setCategoria} placeholder="Elige…"
                  options={cats.map(c => { const l = categoriaLook(c, catalogo, ambito); return { value: c, label: c, Icon: l.Icon, color: l.color } })} />
              </Field>
            )}
          </div>
        )}
        <Field label="Nombre" htmlFor="cm-nombre" hint={enUso ? `Se renombrará también en ${enUso} gasto(s) registrados.` : undefined}>
          <input id="cm-nombre" autoFocus className={inputCls} maxLength={nivel === 'ambito' ? 40 : 60} value={nombre} onChange={e => setNombre(e.target.value)} placeholder={`Nombre ${masc ? 'del' : 'de la'} ${label}`} />
        </Field>
        {heredado ? (
          <p className="rounded-xl bg-bg px-3 py-2 text-xs text-muted" data-testid="apariencia-heredada">
            {nivel === 'categoria' ? 'Esta categoría' : 'Esta subcategoría'} ya existe en otro ámbito: usará su mismo icono y color (se comparten en todos los ámbitos).
          </p>
        ) : (
          <>
            <Picker label="Icono">
              <IconPicker value={icono} onChange={setIcono} color={colorSub} nombre={nombre}
                contexto={nivel === 'ambito' ? [] : nivel === 'categoria' ? [ambito] : [categoria]} />
              {nivel === 'subcategoria' && <p className="mt-1 text-[11px] text-muted">El color lo hereda de su categoría.</p>}
              {nivel !== 'ambito' && <p className="mt-1 text-[11px] text-muted">Se aplica a este nombre en todos los ámbitos.</p>}
            </Picker>
            {usaVisual && (
              <Picker label="Color">
                <ColorPicker value={color} onChange={setColor} />
              </Picker>
            )}
          </>
        )}
        {mode === 'edit' && <Switch checked={activo} onChange={setActivo} label={activo ? 'Activa: se ofrece al registrar gastos' : 'Inactiva: oculta en formularios, se conserva en el historial'} />}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  )
}

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="mb-1.5 text-xs font-medium text-muted">{label}</p>{children}</div>
}

/** Eliminar categoría: revisa gastos, plantillas, compromisos y subcajas. Con uso NO se elimina (se ofrece desactivar); nunca borra gastos. */
function BorrarCategoria({ store, ambito, cat, onClose, onDesactivar }: { store: AppStore; ambito: string; cat: CatNode; onClose: () => void; onDesactivar: () => void }) {
  const { loadPlantillas } = store
  useEffect(() => { void loadPlantillas() }, [loadPlantillas])
  const [cascada, setCascada] = useState(false)
  const listo = store.plantillas.loaded && !store.plantillas.loading
  const deps = useMemo(() => store.data ? dependenciasCategoria(ambito, cat.name, store.data, store.plantillas.items) : null, [store.data, store.plantillas.items, ambito, cat.name])
  const uso = deps ? [
    deps.gastos && `${deps.gastos} gasto(s)`,
    deps.plantillas && `${deps.plantillas} plantilla(s)${deps.compromisos ? ` (${deps.compromisos} compromiso(s))` : ''}`,
    deps.cajas && `${deps.cajas} caja(s)`,
  ].filter(Boolean) as string[] : []
  const bloqueada = uso.length > 0
  const key = `cat-del:${ambito}|${cat.name}`
  const eliminar = () => {
    const ok = store.track(key, { pending: `Eliminando ${cat.name}…`, ok: `Categoría “${cat.name}” eliminada. No se borró ningún gasto.`, error: `No se pudo eliminar “${cat.name}”.` },
      () => store.actions.deleteCategoria(ambito, cat.name, cat.subs.length > 0))
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} size="sm" title={bloqueada ? `No se puede eliminar ${cat.name}` : `Eliminar ${cat.name}`} icon={bloqueada ? <AlertTriangle className="size-5" /> : <Trash2 className="size-5" />}
      footer={bloqueada
        ? <><Button variant="outline" onClick={onClose}>Cerrar</Button>{cat.activo && <Button onClick={onDesactivar}>Desactivar en su lugar</Button>}</>
        : <><Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" disabled={!listo || !deps || (cat.subs.length > 0 && !cascada) || store.pending.has(key)} onClick={eliminar}><Trash2 className="size-4" /> Eliminar</Button></>}>
      <div className="space-y-3 text-sm" data-testid="eliminar-categoria">
        <p className="font-semibold">“{cat.name}” · {ambito}</p>
        {!listo || !deps ? <p className="text-xs text-muted" role="status">Revisando dónde se usa…</p> : bloqueada ? (
          <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning" data-testid="categoria-en-uso">
            Esta categoría está en uso: {uso.join(', ')}. Para conservar el historial no se elimina.
            {cat.activo ? ' Puedes desactivarla: deja de ofrecerse en formularios y filtros, y puedes reactivarla cuando quieras.' : ' Ya está inactiva: se conserva sin ofrecerse.'}
          </p>
        ) : (
          <>
            <p className="text-muted">Nada la usa: ningún gasto, plantilla, compromiso ni caja. Se quitará del catálogo; ningún gasto se borra.</p>
            {cat.subs.length > 0 && (
              <label className="flex items-start gap-2 rounded-xl bg-bg px-3 py-2 text-xs">
                <Checkbox checked={cascada} onChange={setCascada} label={`Confirmo eliminar también sus ${cat.subs.length} subcategoría(s)`} />
                <span>Confirmo que también se eliminarán sus <b>{cat.subs.length}</b> subcategoría(s): {cat.subs.map(x => x.subcategoria).join(', ')}.</span>
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
