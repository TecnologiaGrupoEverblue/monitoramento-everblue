import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

/**
 * Lista que se adapta à tela: tabela a partir de 768 px e cartões no celular
 * (cada linha vira um cartão com rótulo e valor). Colunas secundárias podem
 * sair da tabela em telas médias (`ocultar`) e continuam nos cartões.
 */
export interface Coluna<T> {
  chave: string
  titulo: string
  render: (linha: T) => ReactNode
  alinhar?: 'left' | 'right'
  /** Some da TABELA abaixo deste tamanho (fica no cartão do celular). */
  ocultar?: 'lg' | 'xl' | '2xl'
  /** Título do cartão no celular (uma coluna só). */
  principal?: boolean
  /** Botões e controles: no cartão, vão para o rodapé, sem rótulo. */
  acao?: boolean
  /** Classe extra da célula (largura máxima, quebra etc.). */
  classe?: string
}

const OCULTAR: Record<NonNullable<Coluna<unknown>['ocultar']>, string> = {
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
}

export function TabelaResponsiva<T>({
  linhas,
  colunas,
  chave,
  aoClicar,
  estiloLinha,
  vazio = 'Nada para mostrar neste recorte.',
  rotulo,
}: {
  linhas: T[]
  colunas: Coluna<T>[]
  chave: (linha: T) => string
  aoClicar?: (linha: T) => void
  estiloLinha?: (linha: T) => CSSProperties | undefined
  vazio?: string
  /** Nome da lista para leitores de tela. */
  rotulo: string
}) {
  if (linhas.length === 0) return <p className="py-10 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>{vazio}</p>

  const teclado = (linha: T) => (e: KeyboardEvent) => {
    if (!aoClicar || e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      aoClicar(linha)
    }
  }
  const principal = colunas.find((c) => c.principal) ?? colunas[0]
  const demais = colunas.filter((c) => c !== principal && !c.acao)
  const acoes = colunas.filter((c) => c.acao)

  return (
    <>
      {/* Tabela: 768 px ou mais */}
      <div className="hidden overflow-x-auto border md:block" style={{ borderColor: 'var(--cor-borda)', backgroundColor: 'var(--cor-superficie-solida)' }}>
        <table className="w-full text-[13px]" aria-label={rotulo}>
          <thead className="border-b text-[12px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
            <tr>
              {colunas.map((c) => (
                <th key={c.chave} scope="col" className={`px-3 py-2.5 align-bottom ${c.alinhar === 'right' ? 'text-right' : 'text-left'} ${c.ocultar ? OCULTAR[c.ocultar] : ''}`}>
                  {c.acao ? <span className="sr-only">{c.titulo}</span> : c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr
                key={chave(l)}
                className={`border-t align-top ${aoClicar ? 'cursor-pointer hover:bg-[var(--cor-fundo-recuado)] focus-visible:bg-[var(--cor-fundo-recuado)]' : ''}`}
                style={{ borderColor: 'var(--cor-borda)', ...estiloLinha?.(l) }}
                onClick={aoClicar ? () => aoClicar(l) : undefined}
                onKeyDown={teclado(l)}
                tabIndex={aoClicar ? 0 : undefined}
              >
                {colunas.map((c) => (
                  <td
                    key={c.chave}
                    className={`px-3 py-2.5 ${c.alinhar === 'right' ? 'text-right' : 'text-left'} ${c.ocultar ? OCULTAR[c.ocultar] : ''} ${c.classe ?? ''}`}
                    onClick={c.acao ? (e) => e.stopPropagation() : undefined}
                  >
                    {c.render(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cartões: celular */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label={rotulo}>
        {linhas.map((l) => (
          <li
            key={chave(l)}
            className={`rounded-xl border p-3 ${aoClicar ? 'cursor-pointer active:bg-[var(--cor-fundo-recuado)]' : ''}`}
            style={{ borderColor: 'var(--cor-borda)', backgroundColor: 'var(--cor-superficie-solida)', ...estiloLinha?.(l) }}
            onClick={aoClicar ? () => aoClicar(l) : undefined}
            onKeyDown={teclado(l)}
            tabIndex={aoClicar ? 0 : undefined}
          >
            <div className="text-sm font-semibold break-words" style={{ color: 'var(--cor-primaria)' }}>
              {principal.render(l)}
            </div>
            {demais.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                {demais.map((c) => (
                  <div key={c.chave} className="min-w-0">
                    <dt className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                      {c.titulo}
                    </dt>
                    <dd className="min-w-0 break-words">{c.render(l)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {acoes.length > 0 && (
              <div className="mt-2 flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                {acoes.map((c) => (
                  <span key={c.chave}>{c.render(l)}</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
