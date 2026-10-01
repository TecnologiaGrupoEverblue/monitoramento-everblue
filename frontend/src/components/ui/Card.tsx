import type { ReactNode } from 'react'
import { formatarVariacao } from '../../utils/formatters'

export function Painel({ titulo, acao, children, className }: { titulo?: string; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border bg-[var(--cor-superficie)] p-4 backdrop-blur-md ${className ?? ''}`} style={{ borderColor: 'var(--cor-borda)' }}>
      {titulo && (
        <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--cor-borda)' }}>
          <h3 className="text-[13px] font-semibold tracking-wide" style={{ color: 'var(--cor-texto-secundario)' }}>
            {titulo}
          </h3>
          {acao}
        </div>
      )}
      {children}
    </div>
  )
}

/** Número-herói — reservado para UM único indicador por tela (o mais importante).
 * É o único lugar, além do menu ativo, onde a tipografia editorial em tamanho
 * grande aparece: gaste esse destaque com parcimônia. */
export function NumeroHero({
  titulo,
  valor,
  contexto,
  variacao,
  onClick,
  escuro,
}: {
  titulo: string
  valor: string
  contexto?: string
  variacao?: { texto: string; positivo: boolean }
  onClick?: () => void
  /** Fundo escuro com glow da marca (ex.: dentro de um contêiner `.fundo-glow`) — troca as cores de texto para branco/dourado. */
  escuro?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex flex-col items-start gap-1 border-b pb-5 pt-1 text-left ${onClick ? 'cursor-pointer group' : ''}`}
      style={{ borderColor: escuro ? 'rgba(255,255,255,0.15)' : 'var(--cor-borda-forte)' }}
    >
      <span className="text-xs font-medium" style={{ color: escuro ? 'rgba(255,255,255,0.65)' : 'var(--cor-texto-secundario)' }}>
        {titulo}
      </span>
      <span className="fonte-editorial numeros-tabulares text-5xl leading-none font-semibold tracking-tight" style={{ color: escuro ? 'var(--cor-acento-claro)' : 'var(--cor-primaria)' }}>
        {valor}
      </span>
      {(contexto || variacao) && (
        <span className="mt-1 text-xs" style={{ color: escuro ? 'rgba(255,255,255,0.65)' : 'var(--cor-texto-secundario)' }}>
          {variacao && (
            <span className="numeros-tabulares font-medium" style={{ color: variacao.positivo ? 'var(--cor-critico)' : (escuro ? '#7FE0B0' : 'var(--cor-normal)') }}>
              {variacao.texto}{' '}
            </span>
          )}
          {contexto}
        </span>
      )}
    </button>
  )
}

export function KpiCard({
  titulo,
  valor,
  valorAnterior,
  formatoVariacao = 'moeda',
  onClick,
  destaque,
}: {
  titulo: string
  valor: string
  valorAnterior?: { atual: number; anterior: number }
  formatoVariacao?: 'moeda' | 'percentual' | 'numero'
  onClick?: () => void
  destaque?: 'normal' | 'atencao' | 'critico'
}) {
  const variacao = valorAnterior ? formatarVariacao(valorAnterior.atual, valorAnterior.anterior) : null
  const corValor = destaque === 'critico' ? 'var(--cor-critico)' : destaque === 'atencao' ? 'var(--cor-atencao)' : 'var(--cor-texto-primario)'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full flex-col gap-1 border-b py-3 pr-3 text-left ${onClick ? 'cursor-pointer hover:bg-[var(--cor-fundo-recuado)]' : ''}`}
      style={{ borderColor: 'var(--cor-borda)' }}
    >
      <span className="text-[12.5px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        {titulo}
      </span>
      <span className="fonte-editorial numeros-tabulares text-xl font-semibold" style={{ color: corValor }}>
        {valor}
      </span>
      {variacao && formatoVariacao === 'moeda' && (
        <span className="numeros-tabulares text-[11px] font-medium" style={{ color: variacao.positivo ? 'var(--cor-critico)' : 'var(--cor-normal)' }}>
          {variacao.texto} vs. semana anterior
        </span>
      )}
    </button>
  )
}
