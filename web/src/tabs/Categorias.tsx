import { useMemo, useState } from 'react'
import { Plus, RotateCcw, Search, X } from 'lucide-react'
import type { AppStore } from '../lib/store'
import type { CatalogoItem } from '../lib/types'
import { Button, Card, Empty, ErrorBox, Field, inputCls, Skeleton } from '../components/ui'
import { colorFor } from '../components/shared'

export default function Categorias({ store, notify }: { store: AppStore; notify: (m: string) => void }) {
  const [ambito, setAmbito] = useState('Personal')
  const [categoria, setCategoria] = useState('')
  const [sub, setSub] = useState('')
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const catalogo = useMemo(() => store.data?.catalogo ?? [], [store.data?.catalogo])

  const tree = useMemo(() => {
    const t = new Map<string, Map<string, CatalogoItem[]>>()
    for (const c of catalogo) {
      const cats = t.get(c.ambito) ?? new Map<string, CatalogoItem[]>()
      t.set(c.ambito, cats)
      if (c.categoria) cats.set(c.categoria, [...(cats.get(c.categoria) ?? []), c])
    }
    return t
  }, [catalogo])

  const ambitos = [...tree.keys()]
  const activos = catalogo.filter(c => c.activo)
  const counts = {
    ambitos: new Set(activos.map(c => c.ambito)).size,
    categorias: new Set(activos.filter(c => c.categoria).map(c => `${c.ambito}|${c.categoria}`)).size,
    subcategorias: activos.filter(c => c.subcategoria).length,
  }
  const categoriasDe = [...(tree.get(ambito)?.keys() ?? [])]
  const term = q.trim().toLowerCase()

  async function save(item: CatalogoItem, msg: string) {
    setSaving(true)
    setError('')
    try { await store.actions.saveCatalogo(item); notify(msg) } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const a = ambito.trim(), c = categoria.trim(), s = sub.trim()
    if (!a) return setError('Indica un ámbito.')
    if (s && !c) return setError('Una subcategoría necesita categoría.')
    const exists = catalogo.some(x => x.activo && [x.ambito, x.categoria, x.subcategoria].join('|').toLowerCase() === [a, c, s].join('|').toLowerCase())
    if (exists) return setError('Esa opción ya existe.')
    if (c && !catalogo.some(x => x.ambito === a && x.categoria === c && !x.subcategoria) && s) {
      await save({ ambito: a, categoria: c, subcategoria: '', activo: true }, 'Categoría agregada')
    }
    await save({ ambito: a, categoria: c, subcategoria: s, activo: true }, 'Opción agregada')
    setSub('')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {([['Ámbitos', counts.ambitos], ['Categorías', counts.categorias], ['Subcategorías', counts.subcategorias]] as const).map(([l, n]) => (
          <div key={l} className="rounded-2xl border border-line bg-card p-3 text-center shadow-sm">
            <p className="tabular text-2xl font-semibold text-navy dark:text-blue-300">{n}</p><p className="text-xs text-muted">{l}</p>
          </div>
        ))}
      </div>

      <Card title="Agregar opción">
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-4 sm:items-end">
          <Field label="Ámbito">
            <input className={inputCls} list="dl-ambitos" value={ambito} onChange={e => { setAmbito(e.target.value); setCategoria('') }} maxLength={40} />
            <datalist id="dl-ambitos">{ambitos.map(a => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Categoría">
            <input className={inputCls} list="dl-categorias" value={categoria} onChange={e => setCategoria(e.target.value)} maxLength={60} placeholder="Existente o nueva" />
            <datalist id="dl-categorias">{categoriasDe.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Subcategoría"><input className={inputCls} value={sub} onChange={e => setSub(e.target.value)} maxLength={60} placeholder="Opcional" /></Field>
          <Button type="submit" loading={saving} disabled={!store.data}><Plus className="size-4" /> Agregar</Button>
        </form>
        {error && <div className="mt-2"><ErrorBox message={error} /></div>}
      </Card>

      <label className="relative block">
        <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" aria-hidden />
        <input aria-label="Buscar en el catálogo" placeholder="Buscar categoría o subcategoría…" className={`${inputCls} pl-8`} value={q} onChange={e => setQ(e.target.value)} />
      </label>

      {!store.data ? <Skeleton className="h-48" /> : !ambitos.length ? <Empty>El catálogo está vacío.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {ambitos.map(a => {
            const cats = [...(tree.get(a)?.entries() ?? [])]
              .filter(([c, items]) => !term || c.toLowerCase().includes(term) || items.some(i => i.subcategoria.toLowerCase().includes(term)))
            if (term && !cats.length) return null
            return (
              <Card key={a} title={a} icon={<span className="size-2.5 rounded-full" style={{ background: colorFor(a, ambitos) }} />}
                action={<span className="text-xs text-muted">{cats.length} categorías</span>}>
                {!cats.length && <p className="text-xs text-muted">Sin categorías aún.</p>}
                <ul className="space-y-2">
                  {cats.map(([c, items]) => {
                    const head = items.find(i => !i.subcategoria)
                    const catActive = head ? head.activo : items.some(i => i.activo)
                    return (
                      <li key={c} className="rounded-xl border border-line p-2">
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-medium ${catActive ? '' : 'text-muted line-through'}`}>{c}</span>
                          <button aria-label={catActive ? `Desactivar ${c}` : `Reactivar ${c}`} className="rounded p-1 text-muted hover:bg-bg"
                            onClick={() => save({ ambito: a, categoria: c, subcategoria: '', activo: !catActive }, catActive ? 'Categoría desactivada' : 'Categoría reactivada')}>
                            {catActive ? <X className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                          </button>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {items.filter(i => i.subcategoria).map(i => (
                            <button key={i.subcategoria} title={i.activo ? 'Desactivar' : 'Reactivar'}
                              onClick={() => save({ ...i, activo: !i.activo }, i.activo ? 'Subcategoría desactivada' : 'Subcategoría reactivada')}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${i.activo ? 'bg-turquesa/10 text-turquesa' : 'bg-bg text-muted line-through'}`}>
                              {i.subcategoria}{i.activo ? <X className="size-3" /> : <RotateCcw className="size-3" />}
                            </button>
                          ))}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted">Desactivar oculta la opción en formularios sin borrar el historial. Los gastos ya registrados conservan su categoría.</p>
    </div>
  )
}
