import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSessao } from '../contexts/SessaoContext'
import { Painel } from '../components/ui/Card'
import { TabelaResponsiva } from '../components/ui/TabelaResponsiva'
import { NomeCliente } from '../components/ui/NomeCliente'
import { CriticidadeClassificadaBadge, StatusBadge, StatusPlanoBadge } from '../components/ui/Badges'
import { Carregando, ErroCarga } from '../components/ui/EstadoCarga'
import type { MotivoPauta } from '../models/types'
import { comiteAtaRepository, FILTROS_VAZIOS } from '../repositories'
import { consultas, invalidar } from '../consultas'
import { ErroApi } from '../api/cliente'
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
  const clienteConsultas = useQueryClient()
  const [ataQ, comitesQ, clientesQ, kpisQ, pautaQ] = useQueries({
    queries: [consultas.ultimaAta(), consultas.comites(), consultas.clientes(), consultas.kpis(FILTROS_VAZIOS), consultas.pauta()],
  })
  const comites = comitesQ.data ?? []
  const proximoComite = comites.find((c) => c.status === 'PLANEJADO')
  const decisoesQ = useQuery({ ...consultas.decisoesRegistradas(proximoComite?.id ?? ''), enabled: Boolean(proximoComite) })
  const ata = ataQ.data ?? null
  const pauta = pautaQ.data ?? null
  const clientesPorId = useMemo(() => new Map((clientesQ.data ?? []).map((c) => [c.id, c])), [clientesQ.data])
  const decisoesRegistradas = decisoesQ.data ?? 0
  const kpis = kpisQ.data
  const resumoAtual = kpis
    ? {
        risco: kpis.atual.risco,
        vencido: kpis.atual.vencido,
        percVencido: kpis.atual.percVencido,
        limiteConsumido: kpis.atual.percLimiteConsumido,
        trancheConsumida: kpis.atual.percTrancheConsumida,
      }
    : null
  const consultasTela = [ataQ, comitesQ, clientesQ, kpisQ, pautaQ]
  const carregando = consultasTela.some((q) => q.isPending)
  const falha = consultasTela.find((q) => q.isError)

  const gerar = useMutation({
    mutationFn: (comiteId: string) => comiteAtaRepository.gerarAta(comiteId),
    onSuccess: () => invalidar(clienteConsultas, 'carteira'),
  })
  const gerando = gerar.isPending
  function gerarAta() {
    if (proximoComite) gerar.mutate(proximoComite.id)
  }

  if (falha) return <ErroCarga erro={falha.error} aoTentarDeNovo={() => consultasTela.forEach((q) => q.isError && void q.refetch())} />
  if (carregando) return <Carregando />

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
            <p className="mb-4 py-4 text-center text-sm text-[color:var(--cor-texto-secundario)]">Nenhum caso com decisão registrada neste comitê.</p>
          ) : (
            <div className="mb-4">
              <TabelaResponsiva
                rotulo="Clientes discutidos"
                linhas={ata.clientesDiscutidos}
                chave={(cd) => `${cd.clienteId}-${cd.planoAcaoId ?? ''}`}
                aoClicar={(cd) => navigate(`/clientes/${cd.clienteId}`)}
                colunas={[
                  { chave: 'cliente', titulo: 'Cliente', principal: true, classe: 'font-medium min-w-[160px]', render: (cd) => <NomeCliente nome={clientesPorId.get(cd.clienteId)?.nome} documento={clientesPorId.get(cd.clienteId)?.cnpj} /> },
                  { chave: 'risco', titulo: 'Risco', alinhar: 'right', classe: 'numeros-tabulares whitespace-nowrap', render: (cd) => formatarMoeda(cd.riscoTomado) },
                  { chave: 'vencido', titulo: '% Vencido', alinhar: 'right', classe: 'numeros-tabulares whitespace-nowrap', render: (cd) => formatarPercentual(cd.percVencido) },
                  { chave: 'decisao', titulo: 'Nova decisão', classe: 'min-w-[180px]', render: (cd) => cd.novaDecisao },
                  { chave: 'responsavel', titulo: 'Responsável', render: (cd) => cd.responsavel },
                  { chave: 'prazo', titulo: 'Prazo', classe: 'whitespace-nowrap', render: (cd) => formatarData(cd.prazo) },
                ]}
              />
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
                      <NomeCliente nome={clientesPorId.get(cd.clienteId)?.nome} documento={clientesPorId.get(cd.clienteId)?.cnpj} />
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
          <TabelaResponsiva
            rotulo="Pendências do comitê"
            linhas={ata.pendencias}
            chave={(p) => `${p.clienteId}-${p.decisao}-${p.prazo}`}
            aoClicar={(p) => navigate(`/clientes/${p.clienteId}`)}
            vazio="Sem pendências registradas."
            colunas={[
              { chave: 'cliente', titulo: 'Cliente', principal: true, classe: 'font-medium min-w-[160px]', render: (p) => <NomeCliente nome={clientesPorId.get(p.clienteId)?.nome} documento={clientesPorId.get(p.clienteId)?.cnpj} /> },
              { chave: 'status', titulo: 'Status', render: (p) => <StatusPlanoBadge status={p.status} /> },
              { chave: 'decisao', titulo: 'Decisão', classe: 'min-w-[160px]', render: (p) => p.decisao },
              { chave: 'acao', titulo: 'Ação', classe: 'min-w-[160px] text-xs', render: (p) => <span style={{ color: 'var(--cor-texto-secundario)' }}>{p.acao}</span> },
              { chave: 'responsavel', titulo: 'Responsável', render: (p) => p.responsavel },
              { chave: 'prazo', titulo: 'Prazo', classe: 'whitespace-nowrap', render: (p) => formatarData(p.prazo) },
            ]}
          />
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
          {gerar.isError && (
            <p role="alert" className="mb-3 border-l-2 p-2 text-xs" style={{ borderColor: 'var(--cor-critico)', backgroundColor: 'var(--cor-critico-fundo)', color: 'var(--cor-critico)' }}>
              {gerar.error instanceof ErroApi ? gerar.error.message : 'Não foi possível gerar a ata.'}
            </p>
          )}
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
                          <NomeCliente nome={item.nome} documento={clientesPorId.get(item.clienteId)?.cnpj} />
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
