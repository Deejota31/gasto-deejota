import { Link2, Plug } from 'lucide-react'
import { Button, Card, Empty } from './ui'

type Seccion = 'dashboard' | 'cajas' | 'gastos' | 'salud' | 'catalogo'

const TEXTOS: Record<Seccion, { titulo: string; texto: string }> = {
  dashboard: { titulo: 'Todavía no hay datos', texto: 'Conéctate para ver tu resumen financiero.' },
  cajas: { titulo: 'Aún no tienes cajas registradas', texto: 'Conéctate para ver y administrar tus cajas.' },
  gastos: { titulo: 'Aún no hay gastos registrados', texto: 'Conéctate para ver y registrar tus gastos.' },
  salud: { titulo: 'Todavía no hay información disponible', texto: 'Conéctate para analizar tu salud financiera.' },
  catalogo: { titulo: 'Conéctate para ver y administrar tu catálogo', texto: 'Tus ámbitos, categorías, subcategorías y medios de pago aparecerán cuando te conectes.' },
}

/** Estado "sin conexión": nunca muestra datos de ejemplo; solo indica cómo conectarse. */
export function Desconectado({ seccion, onConectar }: { seccion: Seccion; onConectar: () => void }) {
  const t = TEXTOS[seccion]
  return (
    <div className="space-y-4" data-testid={`desconectado-${seccion}`}>
      {seccion === 'dashboard' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {['Gastado este mes', 'Disponible', 'Presupuesto', 'Consumido'].map(k => (
            <Card key={k}><p className="text-xs text-muted">{k}</p><p className="mt-1 text-2xl font-semibold text-ink">—</p></Card>
          ))}
        </div>
      )}
      <Card>
        <Empty icon={<Plug className="size-5" />} title={t.titulo}>{t.texto}</Empty>
        <div className="flex justify-center pb-4">
          <Button onClick={onConectar}><Link2 className="size-4" /> Conectar mi hoja</Button>
        </div>
      </Card>
    </div>
  )
}
