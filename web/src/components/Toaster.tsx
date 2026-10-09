import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { dismiss, useModalOpen, useToasts, type ToastKind } from '../lib/toast'

const STYLE: Record<ToastKind, { box: string; icon: React.ComponentType<{ className?: string }>; iconCls: string }> = {
  success: { box: 'border-[#BFE7CF] bg-[#EEF9F2] text-[#17603A] dark:border-[#1F5F3D] dark:bg-[#12291E] dark:text-[#8FE0B0]', icon: CheckCircle2, iconCls: 'text-[#22A35A]' },
  error: { box: 'border-[#F5C6C2] bg-[#FDF0EF] text-[#9B2C24] dark:border-[#6B2620] dark:bg-[#2C1513] dark:text-[#F3A49C]', icon: XCircle, iconCls: 'text-[#D2463C]' },
  pending: { box: 'border-line bg-card text-ink', icon: Loader2, iconCls: 'animate-spin text-navy' },
  info: { box: 'border-line bg-card text-ink', icon: Info, iconCls: 'text-navy' },
}

/** Pila de notificaciones arriba a la derecha. Solo cada tarjeta recibe clics: el resto de la pantalla sigue usable. */
export default function Toaster({ layer = 'page' }: { layer?: 'page' | 'modal' }) {
  const toasts = useToasts()
  const modalOpen = useModalOpen()
  if (layer === 'page' && modalOpen) return null // con un modal abierto se muestran dentro del modal
  return (
    <div className="pointer-events-none fixed top-3 right-3 left-3 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-96" data-toaster={layer}>
      {toasts.map(t => {
        const s = STYLE[t.kind]
        return (
          // La clave cambia con el tipo: al pasar de "Guardando…" a error se vuelve a anunciar como alerta.
          <div key={`${t.id}-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} data-kind={t.kind}
            className={`toast-in pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm shadow-lg ${s.box}`}>
            <s.icon className={`mt-0.5 size-4.5 shrink-0 ${s.iconCls}`} />
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{t.message}</p>
              {!!t.actions?.length && (
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {t.actions.map(a => (
                    <button key={a.label} type="button" onClick={() => { dismiss(t.id); a.run() }} className="text-xs font-semibold underline underline-offset-2">{a.label}</button>
                  ))}
                </div>
              )}
            </div>
            {t.kind !== 'pending' && (
              <button type="button" aria-label="Cerrar notificación" onClick={() => dismiss(t.id)} className="-m-1 rounded-md p-1 opacity-70 hover:opacity-100">
                <X className="size-4" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
