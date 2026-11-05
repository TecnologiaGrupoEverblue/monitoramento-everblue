import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Painel } from '../components/ui/Card'
import { TabelaResponsiva } from '../components/ui/TabelaResponsiva'
import { ErroCarga } from '../components/ui/EstadoCarga'
import { consultas } from '../consultas'
import { useDrillDown } from '../contexts/DrillDownContext'
import { useFiltros } from '../contexts/FiltrosContext'
import { formatarMoeda, formatarPercentual, SEM_GERENTE } from '../utils/formatters'

type Aba = 'gerenteId' | 'plataformaId'

function BotaoAba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[44px] border-b-2 px-3 py-2 text-sm font-semibold"
      style={{ borderColor: ativa ? 'var(--cor-primaria)' : 'transparent', color: ativa ? 'var(--cor-primaria)' : 'var(--cor-texto-secundario)' }}
    >
      {children}
    </button>
  )
}


/** Visão por Gerente / Visão por Plataforma Comercial — ranking comparativo
 * (spec itens 9 e 10): carteira, risco por status, vencido e planos de
 * ação de cada gerente/plataforma, para achar concentração de risco e
 * cobrança de planos. Clicar numa linha abre o drill-down dos clientes. */
export default function VisaoGerentesPlataformas() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const { abrir } = useDrillDown()
  const [aba, setAba] = useState<Aba>('gerenteId')
  const consulta = useQuery({ ...consultas.ranking(filtros, aba), enabled: !carregandoFiltros })
  const ranking = consulta.data ?? null

  const riscoMax = ranking && ranking.length > 0 ? Math.max(...ranking.map((r) => r.riscoTotal)) : 0
  // Cadastro sem nome nunca aparece em branco.
  const nomeDe = (item: { nome: string }) => item.nome.trim() || (aba === 'gerenteId' ? SEM_GERENTE : '—')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
          Visão por Gerente / Plataforma
        </h1>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Compare concentração de risco, status da carteira e cobrança de planos de ação entre gerentes e plataformas comerciais.
        </p>
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--cor-borda)' }}>
        <BotaoAba ativa={aba === 'gerenteId'} onClick={() => setAba('gerenteId')}>
          Por Gerente
        </BotaoAba>
        <BotaoAba ativa={aba === 'plataformaId'} onClick={() => setAba('plataformaId')}>
          Por Plataforma Comercial
        </BotaoAba>
      </div>

      <Painel>
        {consulta.isError ? (
          <ErroCarga erro={consulta.error} aoTentarDeNovo={() => void consulta.refetch()} />
        ) : !ranking ? (
          <p className="py-8 text-center text-sm text-[color:var(--cor-texto-secundario)]">Carregando…</p>
        ) : ranking.length === 0 ? (
          <p className="py-8 text-center text-sm text-[color:var(--cor-texto-secundario)]">Nenhum registro para os filtros selecionados.</p>
        ) : (
          <TabelaResponsiva<(typeof ranking)[number]>
            rotulo={aba === 'gerenteId' ? 'Gerentes' : 'Plataformas'}
            linhas={ranking}
            chave={(item) => item.id}
            aoClicar={(item) => abrir(`${aba === 'gerenteId' ? 'Gerente' : 'Plataforma'}: ${nomeDe(item)}`, item.clienteIds)}
            colunas={[
              {
                chave: 'nome',
                titulo: aba === 'gerenteId' ? 'Gerente' : 'Plataforma',
                principal: true,
                classe: 'min-w-[170px]',
                render: (item) => (
                  <span className="flex flex-col gap-1">
                    <span className="font-medium" style={{ color: 'var(--cor-primaria)' }}>
                      {nomeDe(item)}
                    </span>
                    <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-[var(--cor-fundo-recuado)]" aria-hidden="true">
                      <span className="block h-full rounded-full" style={{ width: `${riscoMax > 0 ? (item.riscoTotal / riscoMax) * 100 : 0}%`, backgroundColor: 'var(--cor-acento)' }} />
                    </span>
                  </span>
                ),
              },
              { chave: 'clientes', titulo: 'Clientes', alinhar: 'right', classe: 'numeros-tabulares', render: (item) => item.qtdClientes },
              { chave: 'risco', titulo: 'Carteira (risco total)', alinhar: 'right', classe: 'numeros-tabulares whitespace-nowrap font-semibold', render: (item) => <span style={{ color: 'var(--cor-primaria)' }}>{formatarMoeda(item.riscoTotal)}</span> },
              { chave: 'monit', titulo: 'Monitoramento', alinhar: 'right', ocultar: 'xl', classe: 'numeros-tabulares whitespace-nowrap', render: (item) => (item.qtdMonitoramento > 0 ? `${formatarMoeda(item.riscoMonitoramento)} (${item.qtdMonitoramento})` : '—') },
              { chave: 'saida', titulo: 'Saída de Risco', alinhar: 'right', ocultar: 'xl', classe: 'numeros-tabulares whitespace-nowrap', render: (item) => (item.qtdSaidaDeRisco > 0 ? `${formatarMoeda(item.riscoSaidaDeRisco)} (${item.qtdSaidaDeRisco})` : '—') },
              {
                chave: 'juridico',
                titulo: 'Jurídico',
                alinhar: 'right',
                ocultar: 'lg',
                classe: 'numeros-tabulares whitespace-nowrap',
                render: (item) => <span style={{ color: item.qtdJuridico > 0 ? 'var(--cor-critico)' : undefined }}>{item.qtdJuridico > 0 ? `${formatarMoeda(item.riscoJuridico)} (${item.qtdJuridico})` : '—'}</span>,
              },
              { chave: 'vencido', titulo: 'Vencido', alinhar: 'right', classe: 'numeros-tabulares whitespace-nowrap', render: (item) => formatarMoeda(item.vencido) },
              { chave: 'perc', titulo: '% Vencido', alinhar: 'right', classe: 'numeros-tabulares', render: (item) => <span style={{ color: item.percVencido >= 15 ? 'var(--cor-critico)' : undefined }}>{formatarPercentual(item.percVencido)}</span> },
              { chave: 'pend', titulo: 'Planos pendentes', alinhar: 'right', ocultar: 'lg', classe: 'numeros-tabulares', render: (item) => item.planosPendentes },
              { chave: 'atras', titulo: 'Planos atrasados', alinhar: 'right', classe: 'numeros-tabulares', render: (item) => <span style={{ color: item.planosAtrasados > 0 ? 'var(--cor-critico)' : undefined }}>{item.planosAtrasados}</span> },
            ]}
          />
        )}
      </Painel>
    </div>
  )
}
