import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Sobreposições (modais, Modo de Revisão, detalhe do checklist) ficam fora do
 * conteúdo da página, direto no <body>: assim nada do layout (menu lateral,
 * barra superior) fica por cima delas. Enquanto aberta, a página de trás não rola.
 */
export function Portal({ children, travarRolagem = true }: { children: ReactNode; travarRolagem?: boolean }) {
  useEffect(() => {
    if (!travarRolagem) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = antes
    }
  }, [travarRolagem])
  return createPortal(children, document.body)
}
