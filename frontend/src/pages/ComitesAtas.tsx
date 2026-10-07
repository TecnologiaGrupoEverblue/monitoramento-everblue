import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessao } from '../contexts/SessaoContext'
import { Painel } from '../components/ui/Card'
import { CriticidadeClassificadaBadge, StatusBadge, StatusPlanoBadge } from '../components/ui/Badges'
import type { Ata, Cliente, Comite, MotivoPauta, PautaComite } from '../models/types'
import { clienteRepository, comiteAtaRepository, dashboardRepository, FILTROS_VAZIOS } from '../repositories'
import { formatarData, formatarMoeda, formatarPercentual } from '../utils/formatters'

const ROTULO_MOTIVO: Record<MotivoPauta, string> = {
  PLANO_ATRASADO: 'Plano atrasado',
  PLANO_VENCE_ATE_COMITE: 'Plano vence até o comitê',
  CRITICO: 'Crítico',
  ALERTA_VERMELHO_NOVO: 'Alerta vermelho novo',
  MUDANCA_STATUS: 'Mudança de status',
  PIORA_RESTRITIVOS: 'Piora de restritivos',
  JURIDICO_OU_SAIDA: 'Jurídico / Saída de Risco',
}

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
  const [pauta, setPauta] = useState<PautaComite | null>(null)

  const carregar = useCallback(() => {
    setCarregando(true)
    return Promise.all([
      comiteAtaRepository.ultimaAtaRealizada(),
      comiteAtaRepository.listarComites(),
      clienteRepository.listarTodos(),
      dashboardRepository.obterKPIs(FILTROS_VAZIOS),
      comiteAtaRepository.pauta(),
    ]).then(
      async ([ataAnterior, listaComites, clientes, kpis, pautaProxima]) => {
        setAta(ataAnterior)
        setPauta(pautaProxima)
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

          {ata.clientesDiscutidos.some((cd) => cd.situacaoAtual !== undefined) && (
            <>
              <h4 className="mb-1.5 border-b pb-1 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
                Registro por cliente
              </h4>
              <div className="mb-4 flex flex-col gap-3">
                {ata.clientesDiscutidos.map((cd) => (
                  <div key={`det-${cd.clienteId}-${cd.planoAcaoId}`} className="ata-bloco border p-3 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-semibold" style={{ color: 'var(--cor-primaria)' }}>
                        {clientesPorId.get(cd.clienteId)?.nome ?? '—'}
                      </span>
                      {cd.criticidadeCalculada && <span className="text-xs">Criticidade: {cd.criticidadeCalculada}</span>}
                      {cd.enquadramento && <span className="text-xs">· {cd.enquadramento}</span>}
                      <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                        · Risco {formatarMoeda(cd.riscoTomado)} · Vencido {formatarMoeda(cd.valorVencido)} ({formatarPercentual(cd.percVencido)}) · {cd.evolucaoDesdeUltimoComite}
                      </span>
                    </div>
                    {cd.principaisAlertas.length > 0 && (
                      <p className="mb-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                        Alertas: {cd.principaisAlertas.join(' | ')}
                      </p>
                    )}
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                      <ItemAta rotulo="Status atual" valor={cd.situacaoAtual} />
                      <ItemAta rotulo="Evolução do quadro restritivo" valor={cd.evolucaoRestritivos} />
                      <ItemAta rotulo="Praça de pagamento" valor={cd.pracaPagamento} />
                      <ItemAta rotulo="Considerações sobre o transacional" valor={cd.consideracoesTransacional} />
                      <ItemAta rotulo={`Decisão do comitê anterior${cd.dataDecisaoAnterior ? ` (${formatarData(cd.dataDecisaoAnterior)})` : ''}`} valor={cd.decisaoAnterior} />
                      <ItemAta rotulo={`Decisão do comitê atual (${formatarData(ata.dataComite)})`} valor={cd.novaDecisao} />
                      <ItemAta rotulo="Plano de ação" valor={cd.plano} />
                      <ItemAta rotulo="Responsável por fazer acontecer · prazo" valor={`${cd.responsavel} · ${formatarData(cd.prazo)}`} />
                      <ItemAta rotulo="O que foi feito" valor={cd.oQueFoiRealizado} />
                      <ItemAta rotulo="O que não foi feito" valor={cd.oQueNaoFoiRealizado} />
                    </dl>
                  </div>
                ))}
              </div>
            </>
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
          {pauta && (
            <div className="mb-4">
              <h4 className="mb-1.5 border-b pb-1 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
                Pauta automática — {pauta.itens.length} cliente(s){pauta.desde ? ` · mudanças desde o comitê de ${formatarData(pauta.desde)}` : ''}
              </h4>
              {pauta.itens.length === 0 ? (
                <p className="py-3 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
                  Nenhum plano atrasado, cliente crítico ou alerta vermelho novo para pautar.
                </p>
              ) : (
                <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--cor-borda)' }}>
                  {pauta.itens.map((item) => (
                    <li key={item.clienteId}>
                      <button
                        type="button"
                        onClick={() => navigate(`/clientes/${item.clienteId}`)}
                        className="flex w-full flex-col gap-1 py-2 text-left hover:bg-[var(--cor-fundo-recuado)] sm:flex-row sm:items-start sm:gap-3"
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-2 sm:w-72 sm:shrink-0">
                          <span className="font-medium" style={{ color: 'var(--cor-primaria)' }}>
                            {item.nome}
                          </span>
                          <StatusBadge status={item.status} />
                          {item.criticidade && <CriticidadeClassificadaBadge criticidade={item.criticidade} />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
                          {item.motivos.map((m, i) => (
                            <span key={i} className="break-words">
                              <strong>{ROTULO_MOTIVO[m.motivo]}:</strong> {m.descricao}
                            </span>
                          ))}
                        </span>
                        <span className="numeros-tabulares text-xs sm:w-28 sm:shrink-0 sm:text-right">{formatarMoeda(item.risco)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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

function ItemAta({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase" style={{ color: 'var(--cor-texto-secundario)' }}>
        {rotulo}
      </dt>
      <dd className="whitespace-pre-line break-words">{valor?.trim() ? valor : '—'}</dd>
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
