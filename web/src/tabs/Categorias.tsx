import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, FolderTree, Layers, Pencil, Plus, Search, Shapes, Tag } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { CatalogoItem } from '../lib/types'
import { ambitoLook, categoriaLook, COLORS, ICONS, subcategoriaLook } from '../lib/visual'
import { IconPicker } from '../components/IconPicker'
import { normName, otrosAlFinal } from '../lib/orden'
import { Button, Empty, ErrorBox, Field, IconButton, IconTile, inputCls, Modal, Skeleton, Switch, useDismiss } from '../components/ui'

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
  const [menu, setMenu] = useState(false)
  const menuRef = useDismiss(menu, () => setMenu(false))
  const term = q.trim().toLowerCase()
  const current = tree.find(a => a.name === sel) ?? tree[0]

  const activos = catalogo.filter(c => c.activo)
  const stats = [
    { label: 'Ámbitos', n: tree.filter(a => a.activo).length, Icon: Layers, cls: 'bg-primary-soft text-navy' },
    { label: 'Categorías', n: new Set(activos.filter(c => c.categoria).map(c => `${c.ambito}|${c.categoria}`)).size, Icon: Shapes, cls: 'bg-coral-soft text-coral' },
    { label: 'Subcategorías', n: activos.filter(c => c.subcategoria).length, Icon: Tag, cls: 'bg-verde-soft text-verde' },
  ]

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
            <h1 className="text-base font-semibold">Catálogo de gastos</h1>
            <p className="text-xs text-muted">Ámbito → categoría → subcategoría. Desactivar oculta una opción sin perder el historial.</p>
          </div>
          <div ref={menuRef} className="relative">
            <Button onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu} disabled={!store.data}><Plus className="size-4" /> Agregar <ChevronDown className="size-4" /></Button>
            {menu && (
              <div role="menu" className="absolute top-11 right-0 z-40 w-56 rounded-2xl border border-line bg-card p-1.5 shadow-xl">
                {([['ambito', 'Nuevo ámbito', Layers], ['categoria', 'Nueva categoría', Shapes], ['subcategoria', 'Nueva subcategoría', Tag]] as const).map(([nivel, label, Icon]) => (
                  <button key={nivel} role="menuitem" type="button" onClick={() => { setMenu(false); setTarget({ mode: 'create', nivel, ambito: current?.name }) }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-bg"><Icon className="size-4 text-muted" />{label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
          {stats.map(s => (
            <div key={s.label} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <span className={`grid size-9 place-items-center rounded-xl ${s.cls}`}><s.Icon className="size-4" /></span>
              <div><p className="tabular text-xl font-bold">{s.n}</p><p className="text-xs text-muted">{s.label}</p></div>
            </div>
          ))}
          <label className="relative self-center">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
            <input aria-label="Buscar en el catálogo" placeholder="Buscar ámbito, categoría o subcategoría…" className={`${inputCls} h-11 pl-9`} value={q} onChange={e => setQ(e.target.value)} />
          </label>
        </div>
      </section>

      {!store.data ? <Skeleton className="h-64" /> : !tree.length ? <Empty icon={<FolderTree className="size-5" />} title="El catálogo está vacío">Usa “Agregar” para crear tu primer ámbito.</Empty> : term ? (
        <section className="space-y-3" aria-label="Resultados de búsqueda">
          {!results.length && <Empty icon={<Search className="size-5" />} title="Sin coincidencias">Prueba con otra palabra.</Empty>}
          {results.map(a => (
            <div key={a.name} className="rounded-2xl border border-line bg-card p-4">
              <AmbHeader a={a} catalogo={catalogo} q={term} />
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {a.cats.map(c => <CatCard key={c.name} a={a.name} c={c} catalogo={catalogo} q={term} onEdit={setTarget} />)}
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
                <button key={a.name} role="tab" aria-selected={on} type="button" onClick={() => setSel(a.name)}
                  className={`relative rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${on ? 'shadow-md' : 'border-line bg-card hover:shadow-sm'} ${a.activo ? '' : 'opacity-60'}`}
                  style={on ? { borderColor: l.color, background: `linear-gradient(135deg, ${l.color}14, ${l.color}26)` } : undefined}>
                  <div className="flex items-center gap-2.5">
                    <IconTile color={l.color} Icon={l.Icon} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <p className="text-[11px] text-muted">{a.cats.filter(c => c.activo).length} categorías · {subs} sub.</p>
                    </div>
                  </div>
                  {!a.activo && <span className="absolute top-2 right-2 rounded-full bg-bg px-1.5 text-[10px] text-muted">Inactivo</span>}
                </button>
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
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {current.cats.map(c => <CatCard key={c.name} a={current.name} c={c} catalogo={catalogo} q="" onEdit={setTarget} />)}
                </div>
              )}
            </section>
          )}
        </>
      )}

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

function CatCard({ a, c, catalogo, q, onEdit }: { a: string; c: CatNode; catalogo: CatalogoItem[]; q: string; onEdit: (t: Target) => void }) {
  const l = categoriaLook(c.name, catalogo, a)
  return (
    <article className={`rounded-2xl border border-line p-3 transition hover:shadow-sm ${c.activo ? '' : 'opacity-60'}`} style={{ background: `linear-gradient(160deg, ${l.color}0D, transparent 60%)` }}>
      <div className="flex items-center gap-2.5">
        <IconTile color={l.color} Icon={l.Icon} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold ${c.activo ? '' : 'line-through'}`}><Hl text={c.name} q={q} /></p>
          <p className="text-[11px] text-muted">{c.subs.filter(s => s.activo).length} subcategorías{!c.activo && ' · inactiva'}</p>
        </div>
        <IconButton label={`Agregar subcategoría a ${c.name}`} tone="primary" onClick={() => onEdit({ mode: 'create', nivel: 'subcategoria', ambito: a, categoria: c.name })}><Plus className="size-4" /></IconButton>
        <IconButton label={`Editar ${c.name}`} onClick={() => onEdit({ mode: 'edit', nivel: 'categoria', ambito: a, categoria: c.name })}><Pencil className="size-4" /></IconButton>
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
  const [error, setError] = useState('')
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
  function save() {
    const n = nombre.trim().replace(/\s+/g, ' ')
    if (!n) return setError(`Escribe el nombre ${masc ? 'del' : 'de la'} ${label}.`)
    if (nivel !== 'ambito' && !ambito) return setError('Elige un ámbito.')
    if (nivel === 'subcategoria' && !categoria) return setError('Elige una categoría.')
    const key = (a: string, c: string, s: string) => `${normName(a)}|${normName(c)}|${normName(s)}`
    const finalKey = nivel === 'ambito' ? key(n, '', '') : nivel === 'categoria' ? key(ambito, n, '') : key(ambito, categoria, n)
    const exists = catalogo.some(c => key(c.ambito, nivel === 'ambito' ? '' : c.categoria, nivel === 'subcategoria' ? c.subcategoria : '') === finalKey)
    if (exists && (mode === 'create' || normName(n) !== normName(original))) return setError(`Ya existe ese nombre en este ${nivel === 'subcategoria' ? 'categoría' : nivel === 'categoria' ? 'ámbito' : 'catálogo'}.`)
    const Label = `${label.charAt(0).toUpperCase()}${label.slice(1)}`
    let renombrado = false
    const a = nivel === 'ambito' ? n : ambito
    const c = nivel === 'ambito' ? '' : nivel === 'categoria' ? n : categoria
    const s = nivel === 'subcategoria' ? n : ''
    const ok = store.track(`cat:${finalKey}`, mode === 'create'
      ? { pending: `Creando ${label}…`, ok: `${Label} ${masc ? 'creado' : 'creada'} correctamente.`, error: `No se pudo crear ${masc ? 'el' : 'la'} ${label}.` }
      : { pending: `Actualizando ${label}…`, ok: `${Label} ${masc ? 'actualizado' : 'actualizada'} correctamente.`, error: `Error al actualizar ${masc ? 'el' : 'la'} ${label}.` },
    async () => {
      // Si el renombrado ya se guardó y falló el paso siguiente, "Reintentar" no lo repite.
      if (mode === 'edit' && n !== original && !renombrado) {
        await store.actions.renameCatalogo({ nivel, ambito: target.ambito!, categoria: target.categoria, subcategoria: target.subcategoria, nuevo: n })
        renombrado = true
      }
      await store.actions.saveCatalogo({ ambito: a, categoria: c, subcategoria: s, activo, ...(usaVisual ? { icono, color } : icono !== iconoInicial ? { icono } : {}) })
    })
    if (ok) onClose()
  }

  const Preview = ICONS[icono] ?? ICONS.tag
  return (
    <Modal open onClose={onClose} size="md" title={`${mode === 'create' ? (masc ? 'Nuevo' : 'Nueva') : 'Editar'} ${label}`}
      subtitle={mode === 'create' ? 'Aparecerá de inmediato en el formulario de gastos.' : 'Los gastos existentes conservan su clasificación.'}
      icon={<Preview className="size-5" style={{ color: colorSub }} />}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save}>{mode === 'create' ? 'Agregar' : 'Guardar'}</Button></>}>
      <div className="space-y-4">
        {nivel !== 'ambito' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ámbito" htmlFor="cm-amb">
              <select id="cm-amb" className={inputCls} disabled={mode === 'edit'} value={ambito} onChange={e => { setAmbito(e.target.value); setCategoria('') }}>
                {tree.map(a => <option key={a.name}>{a.name}</option>)}
              </select>
            </Field>
            {nivel === 'subcategoria' && (
              <Field label="Categoría" htmlFor="cm-cat">
                <select id="cm-cat" className={inputCls} disabled={mode === 'edit'} value={categoria} onChange={e => setCategoria(e.target.value)}>
                  <option value="">Elige…</option>
                  {cats.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
        <Field label="Nombre" htmlFor="cm-nombre" hint={enUso ? `Se renombrará también en ${enUso} gasto(s) registrados.` : undefined}>
          <input id="cm-nombre" autoFocus className={inputCls} maxLength={nivel === 'ambito' ? 40 : 60} value={nombre} onChange={e => setNombre(e.target.value)} placeholder={`Nombre ${masc ? 'del' : 'de la'} ${label}`} />
        </Field>
        <Picker label="Icono">
          <IconPicker value={icono} onChange={setIcono} color={colorSub} nombre={nombre}
            contexto={nivel === 'ambito' ? [] : nivel === 'categoria' ? [ambito] : [categoria]} />
          {nivel === 'subcategoria' && <p className="mt-1 text-[11px] text-muted">El color lo hereda de su categoría.</p>}
        </Picker>
        {usaVisual && (
          <>
            <Picker label="Color">
              <div className="flex flex-wrap gap-2">
                {COLORS.map(c => (
                  <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                    className={`size-8 rounded-full ring-offset-2 ring-offset-[var(--card)] transition ${color === c ? 'ring-2' : 'hover:scale-110'}`}
                    style={{ background: c, ['--tw-ring-color' as string]: c }} />
                ))}
              </div>
            </Picker>
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
