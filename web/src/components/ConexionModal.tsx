import { useState } from 'react'
import { KeyRound, Link2, Unplug } from 'lucide-react'
import { saveConnection, validarConexion, type Connection } from '../lib/api'
import { showToast } from '../lib/toast'
import { Button, ErrorBox, Field, inputCls, Modal } from './ui'

/** Conectar (o cambiar/desconectar) el Apps Script sin salir de la pantalla en la que estás: se abre desde la barra superior. */
export default function ConexionModal({ conn, onConnect, onClose }: { conn: Connection | null; onConnect: (c: Connection | null) => void; onClose: () => void }) {
  const [url, setUrl] = useState(conn?.url ?? '')
  const [token, setToken] = useState(conn?.token ?? '')
  const [error, setError] = useState('')

  function conectar() {
    const malo = validarConexion(url, token)
    if (malo) return setError(malo)
    const c = { url: url.trim(), token: token.trim() }
    saveConnection(c)
    onConnect(c)
    showToast('info', 'Conexión guardada. Sincronizando…')
    onClose()
  }
  function desconectar() {
    saveConnection(null)
    onConnect(null)
    showToast('info', 'Desconectado: vuelves a los datos de demostración.')
    onClose()
  }
  return (
    <Modal open onClose={onClose} size="md" title={conn ? 'Conexión con Google Sheets' : 'Conectar con Google Sheets'} icon={<Link2 className="size-5" />}
      subtitle="Pega la URL del despliegue de tu Apps Script y el token."
      footer={<>
        {conn && <Button variant="outline" onClick={desconectar} className="mr-auto"><Unplug className="size-4" /> Desconectar</Button>}
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={conectar}><Link2 className="size-4" /> Conectar</Button>
      </>}>
      <form className="space-y-3" noValidate onSubmit={e => { e.preventDefault(); conectar() }}>
        <Field label="URL de Apps Script (/exec)" htmlFor="conn-url">
          <input id="conn-url" className={inputCls} autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" />
        </Field>
        <Field label="Token" htmlFor="conn-token">
          <input id="conn-token" className={inputCls} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="••••••••" />
        </Field>
        {error && <ErrorBox message={error} />}
        <p className="flex items-center gap-1.5 text-[11px] text-muted"><KeyRound className="size-3.5 shrink-0" /> La URL y el token se guardan solo en este navegador.</p>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
