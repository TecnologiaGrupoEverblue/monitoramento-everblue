import { useEffect, useState } from 'react'
import { Painel } from '../components/ui/Card'
import { useDrillDown } from '../contexts/DrillDownContext'
import { useFiltros } from '../contexts/FiltrosContext'
import { dashboardRepository, type RankingDimensao } from '../repositories'
import { formatarMoeda, formatarPercentual } from '../utils/formatters'

type Aba = 'gerenteId' | 'plataformaId'

function BotaoAba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="border-b-2 px-3 py-2 text-sm font-semibold"
      style={{ borderColor: ativa ? 'var(--cor-primaria)' : 'transparent', color: ativa ? 'var(--cor-primaria)' : 'var(--cor-texto-secundario)' }}
    >
      {children}
    </button>
  )
}

function Th({ children, alinhamento = 'left' }: { children: React.ReactNode; alinhamento?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 text-${alinhamento} font-medium`} style={{ color: 'var(--cor-texto-secundario)' }}>
      {children}
    </th>
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
  const [ranking, setRanking] = useState<RankingDimensao[] | null>(null)

  useEffect(() => {
    if (carregandoFiltros) return
    let ativo = true
    setRanking(null)
    dashboardRepository.rankingPorDimensao(filtros, aba).then((r) => {
      if (ativo) setRanking(r)
    })
    return () => {
      ativo = false
    }
  }, [filtros, carregandoFiltros, aba])

  const riscoMax = ranking && ranking.length > 0 ? Math.max(...ranking.map((r) => r.riscoTotal)) : 0

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
        {!ranking ? (
          <p className="py-8 text-center text-sm text-gray-400">Carregando…</p>
        ) : ranking.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Nenhum registro para os filtros selecionados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b" style={{ borderColor: 'var(--cor-borda-forte)' }}>
                <tr>
                  <Th>{aba === 'gerenteId' ? 'Gerente' : 'Plataforma'}</Th>
                  <Th alinhamento="right">Clientes</Th>
                  <Th alinhamento="right">Carteira (risco total)</Th>
                  <Th alinhamento="right">Monitoramento</Th>
                  <Th alinhamento="right">Saída de Risco</Th>
                  <Th alinhamento="right">Jurídico</Th>
                  <Th alinhamento="right">Vencido</Th>
                  <Th alinhamento="right">% Vencido</Th>
                  <Th alinhamento="right">Planos pendentes</Th>
                  <Th alinhamento="right">Planos atrasados</Th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-t hover:bg-[var(--cor-fundo-recuado)]"
                    style={{ borderColor: 'var(--cor-borda)' }}
                    onClick={() => abrir(`${aba === 'gerenteId' ? 'Gerente' : 'Plataforma'}: ${item.nome}`, item.clienteIds)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium" style={{ color: 'var(--cor-primaria)' }}>
                          {item.nome}
                        </span>
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--cor-fundo-recuado)]">
                          <div className="h-full rounded-full" style={{ width: `${riscoMax > 0 ? (item.riscoTotal / riscoMax) * 100 : 0}%`, backgroundColor: 'var(--cor-acento)' }} />
                        </div>
                      </div>
                    </td>
                    <td className="numeros-tabulares px-3 py-2 text-right">{item.qtdClientes}</td>
                    <td className="numeros-tabulares px-3 py-2 text-right font-semibold" style={{ color: 'var(--cor-primaria)' }}>
                      {formatarMoeda(item.riscoTotal)}
                    </td>
                    <td className="numeros-tabulares px-3 py-2 text-right">
                      {item.qtdMonitoramento > 0 ? `${formatarMoeda(item.riscoMonitoramento)} (${item.qtdMonitoramento})` : '—'}
                    </td>
                    <td className="numeros-tabulares px-3 py-2 text-right">
                      {item.qtdSaidaDeRisco > 0 ? `${formatarMoeda(item.riscoSaidaDeRisco)} (${item.qtdSaidaDeRisco})` : '—'}
                    </td>
                    <td className="numeros-tabulares px-3 py-2 text-right" style={{ color: item.qtdJuridico > 0 ? 'var(--cor-critico)' : undefined }}>
                      {item.qtdJuridico > 0 ? `${formatarMoeda(item.riscoJuridico)} (${item.qtdJuridico})` : '—'}
                    </td>
                    <td className="numeros-tabulares px-3 py-2 text-right">{formatarMoeda(item.vencido)}</td>
                    <td className="numeros-tabulares px-3 py-2 text-right" style={{ color: item.percVencido >= 15 ? 'var(--cor-critico)' : undefined }}>
                      {formatarPercentual(item.percVencido)}
                    </td>
                    <td className="numeros-tabulares px-3 py-2 text-right">{item.planosPendentes}</td>
                    <td className="numeros-tabulares px-3 py-2 text-right" style={{ color: item.planosAtrasados > 0 ? 'var(--cor-critico)' : undefined }}>
                      {item.planosAtrasados}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>
    </div>
  )
}
