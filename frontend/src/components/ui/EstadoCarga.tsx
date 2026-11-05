import { RefreshCw } from 'lucide-react'

/**
 * Estados de carga padronizados das telas (skill: carregando, vazio, erro,
 * indisponível). Erro nunca vira lista vazia: mostra que não foi possível
 * carregar e oferece tentar de novo.
 */
export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <p className="p-6 text-sm" style={{ color: 'var(--cor-texto-secundario)' }} role="status" aria-live="polite">
      {texto}
    </p>
  )
}

export function ErroCarga({ erro, aoTentarDeNovo, titulo = 'Não foi possível carregar estes dados.' }: { erro: unknown; aoTentarDeNovo?: () => void; titulo?: string }) {
  const detalhe = erro instanceof Error ? erro.message : null
  return (
    <div className="flex flex-col items-start gap-2 p-6 text-sm" role="alert">
      <p className="font-medium" style={{ color: 'var(--cor-critico)' }}>
        {titulo}
      </p>
      {detalhe && <p style={{ color: 'var(--cor-texto-secundario)' }}>{detalhe}</p>}
      {aoTentarDeNovo && (
        <button type="button" onClick={aoTentarDeNovo} className="botao-secundario inline-flex min-h-[44px] items-center gap-2 px-3 text-sm">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Tentar de novo
        </button>
      )}
    </div>
  )
}
