import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { aoOcorrerErroApi, type ErroApi } from '../../api/cliente'

interface Aviso {
  id: number
  mensagem: string
}

/** Aviso global para falhas de API (o servidor explica o motivo sem expor
 * detalhe interno). Some sozinho em alguns segundos. */
export default function AvisoErros() {
  const [avisos, setAvisos] = useState<Aviso[]>([])

  useEffect(() => {
    let sequencia = 0
    return aoOcorrerErroApi((erro: ErroApi) => {
      const id = ++sequencia
      setAvisos((lista) => [...lista.slice(-2), { id, mensagem: erro.message }])
      window.setTimeout(() => setAvisos((lista) => lista.filter((a) => a.id !== id)), 7000)
    })
  }, [])

  if (avisos.length === 0) return null
  return (
    <div className="sem-impressao fixed bottom-4 right-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" role="alert" aria-live="assertive">
      {avisos.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-xl border border-[#f87171]/30 bg-[#1a0f2e]/95 p-3 text-sm text-white shadow-lg backdrop-blur-md">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#f87171]" />
          <p className="flex-1">{a.mensagem}</p>
          <button onClick={() => setAvisos((l) => l.filter((x) => x.id !== a.id))} aria-label="Fechar aviso" className="text-white/50 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
