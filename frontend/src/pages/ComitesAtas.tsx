import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessao } from '../contexts/SessaoContext'
import { Painel } from '../components/ui/Card'
import { StatusPlanoBadge } from '../components/ui/Badges'
import type { Ata, Cliente, Comite } from '../models/types'
import { clienteRepository, comiteAtaRepository, dashboardRepository, FILTROS_VAZIOS } from '../repositories'
import { formatarData, formatarMoeda, formatarPercentual } from '../utils/formatters'

const ROTEIRO = [
  'Risco mensal',
  'Limite consumido',
  'Tranche consumida',
  'Risco por produto',
  'Vencidos',
  'Desde quando estão vencidos',
  'Prazo médio da carteira',
  'Liquidez 15/30/60 dias',
  'Valores liquidados',
  'Recompras e causa das recompras',
  'Manifestos',
  'Comportamento no calendário',
  'Evolução dos restritivos',
  'Aging da carteira',
  'Praça de pagamento',
  'Clientes em Monitoramento',
  'Clientes em Saída de Risco',
  'Clientes no Jurídico',
  'Planos de ação',
  'Novas decisões',
  'Eventos relevantes',
]

export default function ComitesAtas() {
  const podeGerar = useSessao().pode('analista')
  const navigate = useNavigate()
  const [ata, setAta] = useState<Ata | null>(null)
  const [comites, setComites] = useState<Comite[]>([])
  const [clientesPorId, setClientesPorId] = useState<Map<string, Cliente>>(new Map())
  const [decisoesRegistradas, setDecisoesRegistradas] = useState(0)
  const [resumoAtual, setResumoAtual] = useState<{ risco: number; vencido: number; percVencido: number; limiteConsumido: number; trancheConsumida: number } | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(() => {
    setCarregando(true)
    return Promise.all([comiteAtaRepository.ultimaAtaRealizada(), comiteAtaRepository.listarComites(), clienteRepository.listarTodos(), dashboardRepository.obterKPIs(FILTROS_VAZIOS)]).then(
      async ([ataAnterior, listaComites, clientes, kpis]) => {
        setAta(ataAnterior)
        setComites(listaComites)
        setClientesPorId(new Map(clientes.map((c) => [c.id, c])))
        setResumoAtual({
          risco: kpis.atual.risco,
          vencido: kpis.atual.vencido,
          percVencido: kpis.atual.percVencido,
          limiteConsumido: kpis.atual.percLimiteConsumido,
          trancheConsumida: kpis.atual.percTrancheConsumida,
        })
        const planejado = listaComites.find((c) => c.status === 'PLANEJADO')
        setDecisoesRegistradas(planejado ? await comiteAtaRepository.decisoesRegistradas(planejado.id) : 0)
        setCarregando(false)
      },
    )
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function gerarAta() {
    const proximoComite = comites.find((c) => c.status === 'PLANEJADO')
    if (!proximoComite) return
    setGerando(true)
    await comiteAtaRepository.gerarAta(proximoComite.id)
    await carregar()
    setGerando(false)
  }

  const proximoComite = comites.find((c) => c.status === 'PLANEJADO')

  if (carregando) return <p className="text-sm text-gray-500">Carregando…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
          Comitês / Atas
        </h1>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Ao abrir o comitê, a ata anterior aparece primeiro com as pendências — depois segue o roteiro automático.
        </p>
      </div>

      {ata && (
        <Painel
          titulo={`Ata anterior — Comitê de ${formatarData(ata.dataComite)}`}
          acao={
            <button onClick={() => window.print()} className="sem-impressao px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: 'var(--cor-acao)' }}>
              Exportar em PDF
            </button>
          }
        >
          <div id="ata-para-impressao">
          <div className="mb-4 hidden print:block">
            <p className="fonte-editorial text-lg font-semibold" style={{ color: 'var(--cor-primaria)' }}>
              EverBlue — Ata do Comitê de Monitoramento
            </p>
            <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
              Comitê de {formatarData(ata.dataComite)} · gerada em {formatarData(ata.dataGeracao)}
            </p>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResumoItem titulo="Risco total" valor={formatarMoeda(ata.resumoExecutivo.riscoTotal)} />
            <ResumoItem titulo="Vencido total" valor={formatarMoeda(ata.resumoExecutivo.vencidoTotal)} />
            <ResumoItem titulo="% Vencido" valor={formatarPercentual(ata.resumoExecutivo.percVencido)} />
            <ResumoItem titulo="Clientes discutidos" valor={String(ata.resumoExecutivo.qtdClientesDiscutidos)} />
          </div>
          <p className="mb-3 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
            Participantes: {ata.participantes.join(', ')}
          </p>
          <div className="mb-4">
            <h4 className="mb-1.5 border-b pb-1 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
              Principais variações da semana
            </h4>
            <ul className="list-inside list-disc text-sm">
              {ata.resumoExecutivo.principaisVariacoes.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>

          <h4 className="mb-1.5 border-b pb-1 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
            Clientes discutidos
          </h4>
          {ata.clientesDiscutidos.length === 0 ? (
            <p className="mb-4 py-4 text-center text-sm text-gray-400">Nenhum caso com decisão registrada neste comitê.</p>
          ) : (
            <div className="mb-4 overflow-x-auto border" style={{ borderColor: 'var(--cor-borda)' }}>
              <table className="w-full text-sm">
                <thead className="border-b text-[12.5px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
                  <tr>
                    <th className="px-3 py-2 text-left">Cliente</th>
                    <th className="px-3 py-2 text-right">Risco</th>
                    <th className="px-3 py-2 text-right">% Vencido</th>
                    <th className="px-3 py-2 text-left">Nova decisão</th>
                    <th className="px-3 py-2 text-left">Responsável</th>
                    <th className="px-3 py-2 text-left">Prazo</th>
                  </tr>
                </thead>
                <tbody>
                  {ata.clientesDiscutidos.map((cd) => (
                    <tr key={cd.clienteId} className="cursor-pointer border-t hover:bg-[var(--cor-fundo-recuado)]" style={{ borderColor: 'var(--cor-borda)' }} onClick={() => navigate(`/clientes/${cd.clienteId}`)}>
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--cor-primaria)' }}>
                        {clientesPorId.get(cd.clienteId)?.nome ?? '—'}
                      </td>
                      <td className="numeros-tabulares px-3 py-2 text-right">{formatarMoeda(cd.riscoTomado)}</td>
                      <td className="numeros-tabulares px-3 py-2 text-right">{formatarPercentual(cd.percVencido)}</td>
                      <td className="px-3 py-2">{cd.novaDecisao}</td>
                      <td className="px-3 py-2">{cd.responsavel}</td>
                      <td className="px-3 py-2">{formatarData(cd.prazo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 className="mb-1.5 border-b pb-1 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
            Pendências do comitê
          </h4>
          <div className="overflow-x-auto border" style={{ borderColor: 'var(--cor-borda)' }}>
            <table className="w-full text-sm">
              <thead className="border-b text-[12.5px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
                <tr>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Decisão</th>
                  <th className="px-3 py-2 text-left">Ação</th>
                  <th className="px-3 py-2 text-left">Responsável</th>
                  <th className="px-3 py-2 text-left">Prazo</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {ata.pendencias.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                      Sem pendências registradas.
                    </td>
                  </tr>
                )}
                {ata.pendencias.map((p, i) => (
                  <tr key={i} className="cursor-pointer border-t hover:bg-[var(--cor-fundo-recuado)]" style={{ borderColor: 'var(--cor-borda)' }} onClick={() => navigate(`/clientes/${p.clienteId}`)}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--cor-primaria)' }}>
                      {clientesPorId.get(p.clienteId)?.nome ?? '—'}
                    </td>
                    <td className="px-3 py-2">{p.decisao}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>{p.acao}</td>
                    <td className="px-3 py-2">{p.responsavel}</td>
                    <td className="px-3 py-2">{formatarData(p.prazo)}</td>
                    <td className="px-3 py-2">
                      <StatusPlanoBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </Painel>
      )}

      {proximoComite && resumoAtual && (
        <Painel
          titulo={`Próximo Comitê — ${formatarData(proximoComite.data)}`}
          acao={
            <button
              onClick={gerarAta}
              disabled={gerando || decisoesRegistradas === 0 || !podeGerar}
              title={decisoesRegistradas === 0 ? 'Registre decisões pelo Modo de Revisão (Monitoramento, Saída de Risco ou Jurídico) antes de gerar a ata' : undefined}
              className="px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--cor-acao)' }}
            >
              {gerando ? 'Gerando…' : 'Gerar Ata'}
            </button>
          }
        >
          <p className="mb-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
            Roteiro automático do comitê — posição consolidada de {formatarData(comites.find((c) => c.status === 'REALIZADO')?.data ?? null)} até hoje.
          </p>
          <p className="mb-3 text-xs font-medium" style={{ color: decisoesRegistradas > 0 ? 'var(--cor-normal)' : 'var(--cor-texto-secundario)' }}>
            {decisoesRegistradas} decisão(ões) já registrada(s) via Modo de Revisão para este comitê.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ROTEIRO.map((item, i) => (
              <div key={item} className="flex items-center gap-2 border px-3 py-2 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: 'var(--cor-acao)' }}>
                  {i + 1}
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResumoItem titulo="Risco total" valor={formatarMoeda(resumoAtual.risco)} />
            <ResumoItem titulo="Vencido (% carteira)" valor={`${formatarMoeda(resumoAtual.vencido)} (${formatarPercentual(resumoAtual.percVencido)})`} />
            <ResumoItem titulo="Limite consumido" valor={formatarPercentual(resumoAtual.limiteConsumido)} />
            <ResumoItem titulo="Tranche consumida" valor={formatarPercentual(resumoAtual.trancheConsumida)} />
          </div>
        </Painel>
      )}
    </div>
  )
}

function ResumoItem({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="border px-3 py-2" style={{ borderColor: 'var(--cor-borda)' }}>
      <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        {titulo}
      </p>
      <p className="fonte-editorial numeros-tabulares text-base font-semibold" style={{ color: 'var(--cor-primaria)' }}>
        {valor}
      </p>
    </div>
  )
}
