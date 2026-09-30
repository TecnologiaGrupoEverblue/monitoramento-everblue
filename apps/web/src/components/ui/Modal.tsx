import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Diálogo acessível: Esc fecha, foco entra no diálogo e volta a quem abriu,
 * cabe na tela em qualquer largura (rola por dentro), título e ações sempre
 * visíveis. Em celular ocupa a largura toda, colado à base.
 */
export function Modal({
  titulo,
  subtitulo,
  aoFechar,
  children,
  rodape,
  largura = 'max-w-2xl',
}: {
  titulo: string
  subtitulo?: ReactNode
  aoFechar: () => void
  children: ReactNode
  rodape?: ReactNode
  largura?: string
}) {
  const caixa = useRef<HTMLDivElement>(null)
  // Em ref: quem chama costuma passar função nova a cada render, e o efeito
  // abaixo não pode rodar de novo (roubaria o foco de quem está digitando).
  const fechar = useRef(aoFechar)
  useEffect(() => {
    fechar.current = aoFechar
  }, [aoFechar])

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    caixa.current?.focus()
    const tecla = (e: KeyboardEvent) => {
      // Só o diálogo do topo responde (diálogo aberto por cima de outro).
      const abertos = document.querySelectorAll('[role="dialog"]')
      if (e.key === 'Escape' && abertos[abertos.length - 1] === caixa.current) fechar.current()
    }
    document.addEventListener('keydown', tecla)
    const rolagem = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = rolagem
      anterior?.focus?.()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onMouseDown={aoFechar}>
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-[92dvh] w-full ${largura} flex-col rounded-t-2xl border outline-none sm:rounded-2xl`}
        style={{ borderColor: 'var(--cor-borda-forte)', background: 'var(--cor-superficie-solida)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5" style={{ borderColor: 'var(--cor-borda)' }}>
          <div className="min-w-0">
            <h2 className="fonte-editorial break-words text-lg">{titulo}</h2>
            {subtitulo && (
              <div className="mt-0.5 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                {subtitulo}
              </div>
            )}
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
        {rodape && (
          <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3 sm:px-5" style={{ borderColor: 'var(--cor-borda)' }}>
            {rodape}
          </div>
        )}
      </div>
    </div>
  )
}
