// Notificaciones (toasts) en un store mínimo: cualquier parte de la app puede publicar sin pasar props.
import { useEffect, useSyncExternalStore } from 'react'

export type ToastKind = 'pending' | 'success' | 'error' | 'info'
export interface ToastAction { label: string; run: () => void }
export interface Toast { id: number; kind: ToastKind; message: string; actions?: ToastAction[] }

// Los errores no se van solos: quedan hasta que los cierres (llevan Reintentar / Abrir formulario).
export const TOAST_MS: Record<ToastKind, number | null> = { pending: null, success: 4000, info: 4000, error: null }
const MAX = 6

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const emit = () => listeners.forEach(l => l())

function schedule(t: Toast) {
  clearTimeout(timers.get(t.id))
  const ms = TOAST_MS[t.kind]
  if (ms !== null) timers.set(t.id, setTimeout(() => dismiss(t.id), ms))
}

export function showToast(kind: ToastKind, message: string, actions?: ToastAction[]): number {
  const t = { id: nextId++, kind, message, actions }
  toasts = [...toasts, t]
  // Nunca más de 6 apiladas: se descartan primero las más viejas que no sean errores ni operaciones en curso.
  while (toasts.length > MAX) {
    const i = toasts.findIndex(x => x.kind === 'success' || x.kind === 'info')
    const drop = toasts[i >= 0 ? i : 0]
    clearTimeout(timers.get(drop.id)); timers.delete(drop.id)
    toasts = toasts.filter(x => x !== drop)
  }
  schedule(t)
  emit()
  return t.id
}

/** Convierte una notificación (p. ej. "Guardando…") en su resultado final, en el mismo lugar de la pila. */
export function updateToast(id: number, kind: ToastKind, message: string, actions?: ToastAction[]) {
  const i = toasts.findIndex(t => t.id === id)
  if (i < 0) { showToast(kind, message, actions); return }
  const t = { ...toasts[i], kind, message, actions }
  toasts = toasts.map(x => (x.id === id ? t : x))
  schedule(t)
  emit()
}

export function dismiss(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts = toasts.filter(t => t.id !== id)
  emit()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => toasts, () => toasts)
}

// Un <dialog> modal se dibuja por encima de todo y deja inerte el resto de la página. Mientras haya uno abierto,
// las notificaciones se muestran dentro de él (ver Modal) para que se vean y se puedan pulsar.
let modals = 0
const modalListeners = new Set<() => void>()
export function useModalLayer(open: boolean) {
  useEffect(() => {
    if (!open) return
    modals++; modalListeners.forEach(l => l())
    return () => { modals--; modalListeners.forEach(l => l()) }
  }, [open])
}
export function useModalOpen(): boolean {
  return useSyncExternalStore(cb => { modalListeners.add(cb); return () => modalListeners.delete(cb) }, () => modals > 0, () => false)
}
