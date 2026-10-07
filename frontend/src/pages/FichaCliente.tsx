import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChecklistAnalise from '../components/ChecklistAnalise'
import HistoricoDecisoes from '../components/ficha/HistoricoDecisoes'
import PainelClassificacao from '../components/ficha/PainelClassificacao'
import PainelRestritivos from '../components/ficha/PainelRestritivos'
import { useSessao } from '../contexts/SessaoContext'
import PainelTransacional from '../components/PainelTransacional'
import { Painel } from '../components/ui/Card'
import { useFiltros } from '../contexts/FiltrosContext'
import { CriticidadeBadge, GravidadeBadge, PrioridadeBadge, StatusBadge } from '../components/ui/Badges'
import type {
  Alerta,
  ClassificacaoSemanal,
  Cliente,
  DocumentoCliente,
  EventoHistorico,
  Gerente,
  GrupoEconomico,
  Juridico,
  PlanoAcao,
  Plataforma,
  RestritivoSemanal,
  SaidaDeRisco,
  SnapshotSemanal,
} from '../models/types'
import {
  alertaRepository,
  cadastrosRepository,
  classificacaoRepository,
  clienteRepository,
  eventoRepository,
  iasrRepository,
  juridicoRepository,
  planoAcaoRepository,
  restritivoRepository,
  saidaDeRiscoRepository,
  snapshotRepository,
} from '../repositories'
import { formatarData, formatarDataHora, formatarMoeda, formatarMoedaCompacta, formatarPercentual, formatarPercentualOpcional, STATUS_LABEL, STATUS_PROPOSTA_LABEL } from '../utils/formatters'

/** Sem posição importada o valor é DESCONHECIDO, não zero (dado ausente nunca
 * aparece como favorável). */
const SEM_POSICAO = '—'
const moeda = (v: number | null | undefined) => (v === null || v === undefined ? SEM_POSICAO : formatarMoeda(v))
const perc = (v: number | null | undefined) => (v === null || v === undefined ? SEM_POSICAO : formatarPercentual(v))
const dias = (v: number | null | undefined) => (v === null || v === undefined ? SEM_POSICAO : `${v} dias`)

const ROTULO_EVENTO: Record<string, string> = {
  MUDANCA_CRITICIDADE: 'Criticidade',
  RESTRITIVOS: 'Restritivos',
  PLANO_ACAO: 'Plano de ação',
  DECISAO_COMITE: 'Decisão do comitê',
}

export default function FichaCliente() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { filtros, opcoes } = useFiltros()
  const podeEditar = useSessao().pode('analista')
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [grupo, setGrupo] = useState<GrupoEconomico | null>(null)
  const [gerente, setGerente] = useState<Gerente | null>(null)
  const [plataforma, setPlataforma] = useState<Plataforma | null>(null)
  const [serie, setSerie] = useState<SnapshotSemanal[]>([])
  const [eventos, setEventos] = useState<EventoHistorico[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [planos, setPlanos] = useState<PlanoAcao[]>([])
  const [saida, setSaida] = useState<SaidaDeRisco | null>(null)
  const [juridico, setJuridico] = useState<Juridico | null>(null)
  const [eventosIasr, setEventosIasr] = useState<{ tipo: string; data: string; descricao: string }[]>([])
  const [documentos, setDocumentos] = useState<DocumentoCliente[]>([])
  const [classificacoes, setClassificacoes] = useState<ClassificacaoSemanal[]>([])
  const [restritivos, setRestritivos] = useState<RestritivoSemanal[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (!id) return
    let ativo = true
    setCarregando(true)
    Promise.all([
      clienteRepository.porId(id),
      cadastrosRepository.mapaGrupos(),
      cadastrosRepository.mapaGerentes(),
      cadastrosRepository.mapaPlataformas(),
      snapshotRepository.porCliente(id),
      eventoRepository.porCliente(id),
      alertaRepository.porCliente(id),
      planoAcaoRepository.porCliente(id),
      saidaDeRiscoRepository.porCliente(id),
      juridicoRepository.porCliente(id),
      iasrRepository.listarComEventos(),
      clienteRepository.documentos(id),
      classificacaoRepository.porCliente(id),
      restritivoRepository.porCliente(id),
    ]).then(([cli, grupos, gerentes, plataformas, snaps, ev, al, pl, sdr, jur, iasr, docs, cls, rest]) => {
      if (!ativo || !cli) return
      setCliente(cli)
      setGrupo(grupos.get(cli.grupoEconomicoId) ?? null)
      setGerente(gerentes.get(cli.gerenteId) ?? null)
      setPlataforma(plataformas.get(cli.plataformaId) ?? null)
      setSerie(snaps)
      setEventos(ev)
      setAlertas(al)
      setPlanos(pl)
      setSaida(sdr)
      setJuridico(jur)
      setEventosIasr(iasr.filter((r) => r.clienteId === id).flatMap((r) => r.eventos))
      setDocumentos(docs)
      setClassificacoes(cls)
      setRestritivos(rest)
      setCarregando(false)
    })
    return () => {
      ativo = false
    }
  }, [id])

  if (carregando || !cliente) return <p className="text-sm text-gray-500">Carregando…</p>

  const atual = serie[serie.length - 1]
  const anterior = serie[serie.length - 2]
  const variacaoRisco = atual && anterior && anterior.riscoCliente > 0 ? ((atual.riscoCliente - anterior.riscoCliente) / anterior.riscoCliente) * 100 : null
  const percVencido = atual && atual.riscoCliente > 0 ? (atual.vencidoOficial / atual.riscoCliente) * 100 : null
  const ilsComBase = atual ? [atual.il30, atual.il60, atual.il90, atual.il120, atual.il150, atual.il180].filter((v): v is number => v !== null && v !== undefined) : []
  const ilMedio = ilsComBase.length > 0 ? ilsComBase.reduce((a, b) => a + b, 0) / ilsComBase.length : null
  const carteira = opcoes.carteiras.find((c) => c.id === (cliente.carteiraId ?? 'car_everblue'))
  const documentosTexto = documentos.length > 0 ? documentos.map((d) => d.documento).join(', ') : cliente.cnpj

  const dadosLiquidez = serie.map((s) => ({ semana: s.semanaRef, IL30: s.il30, IL90: s.il90, IL180: s.il180 }))
  const dadosRisco = serie.map((s) => ({ semana: s.semanaRef, risco: s.riscoCliente, vencido: s.vencidoOficial }))
  const semanaRefChecklist = filtros.semanaRef ?? atual?.semanaRef ?? null

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => navigate(-1)} className="w-fit text-xs font-medium underline" style={{ color: 'var(--cor-destaque)' }}>
        ← Voltar
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            {cliente.nome}
          </h1>
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            {documentos.length > 1 ? `${cliente.cnpj} (+${documentos.length - 1} CNPJ)` : cliente.cnpj} · {grupo?.nome} · {cliente.setor} / {cliente.ramoAtividade}
            {carteira && ` · Carteira ${carteira.nome}${carteira.apartada ? ' (apartada)' : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={cliente.status} />
          <CriticidadeBadge criticidade={cliente.criticidade} />
          <PrioridadeBadge prioridade={cliente.prioridade} />
        </div>
      </div>

      <Painel titulo="Checklist de Análise Semanal — roteiro do comitê para este cliente">
        <ChecklistAnalise clienteId={cliente.id} semanaRef={semanaRefChecklist} usuario={cliente.responsavel} />
      </Painel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PainelClassificacao historico={classificacoes} semanaRef={semanaRefChecklist} />

        <Painel titulo="Identificação">
          <DlGrid
            itens={[
              ['Cliente', cliente.nome],
              [documentos.length > 1 ? `CNPJs (${documentos.length})` : 'CNPJ', documentosTexto],
              ['Carteira', carteira ? `${carteira.nome}${carteira.apartada ? ' — apartada dos indicadores' : ''}` : '—'],
              ['Grupo econômico', grupo?.nome ?? '—'],
              ['Plataforma/Carteira', plataforma?.nome ?? '—'],
              ['Gerente', gerente?.nome ?? '—'],
              ['Setor', cliente.setor],
              ['Ramo de atividade', cliente.ramoAtividade],
              ['Responsável', cliente.responsavel],
              ['Produtos utilizados', cliente.produtos.join(', ')],
            ]}
          />
        </Painel>

        <Painel titulo="Exposição">
          <DlGrid
            itens={[
              ['Risco do cliente', moeda(atual?.riscoCliente)],
              ['Risco consolidado do grupo', moeda(atual?.riscoGrupo)],
              ['Risco da semana anterior', moeda(anterior?.riscoCliente)],
              ['Variação do risco', variacaoRisco === null ? 'Sem posição anterior para comparar' : `${variacaoRisco >= 0 ? '+' : ''}${variacaoRisco.toFixed(1)}%`],
              ['Limite global', moeda(atual?.limiteGlobal)],
              ['% consumo do limite', perc(atual?.percConsumoLimite)],
              ['Status da proposta', atual ? (STATUS_PROPOSTA_LABEL[atual.statusProposta] ?? atual.statusProposta) : '—'],
              ['Validade da proposta', formatarData(atual?.validadeProposta)],
              ['Tranche consolidada', moeda(atual?.trancheConsolidada)],
              ['Valor em andamento', moeda(atual?.valorEmAndamento)],
              ['% consumo da tranche', perc(atual?.percConsumoTranche)],
              ['Status da tranche', atual?.statusTranche ?? '—'],
            ]}
          />
        </Painel>

        <Painel titulo="Inadimplência">
          <DlGrid
            itens={[
              ['Vencido oficial', moeda(atual?.vencidoOficial)],
              ['% Vencido', perc(percVencido)],
              ['Vencido desde', formatarData(atual?.vencidoDesde)],
              ['Aging da carteira', dias(atual?.agingCarteiraDias)],
              ['Prazo médio da carteira', dias(atual?.prazoMedioCarteiraDias)],
            ]}
          />
        </Painel>

        <Painel titulo="Liquidez">
          <DlGrid
            itens={[
              ['IL 30 dias', formatarPercentualOpcional(atual?.il30)],
              ['IL 60 dias', formatarPercentualOpcional(atual?.il60)],
              ['IL 90 dias', formatarPercentualOpcional(atual?.il90)],
              ['IL 120 dias', formatarPercentualOpcional(atual?.il120)],
              ['IL 150 dias', formatarPercentualOpcional(atual?.il150)],
              ['IL 180 dias', formatarPercentualOpcional(atual?.il180)],
              ['IL médio (janelas com base)', formatarPercentualOpcional(ilMedio)],
            ]}
          />
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={dadosLiquidez} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
              <XAxis dataKey="semana" tickFormatter={(v) => formatarData(v)} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip labelFormatter={(v) => formatarData(String(v))} formatter={(v) => formatarPercentual(Number(v))} />
              <Line type="monotone" dataKey="IL30" stroke="var(--cor-atencao)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="IL90" stroke="var(--cor-destaque)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="IL180" stroke="var(--cor-normal)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Painel>

        <Painel titulo="Manifestos e qualidade do recebível">
          <DlGrid
            itens={[
              ['% sem atuação de manifesto', perc(atual?.manifestoPercSemAtuacao)],
              ['Inacessível', moeda(atual?.manifestoInacessivel)],
              ['Não confirma', moeda(atual?.manifestoNaoConfirma)],
              ['Transação desconhecida', moeda(atual?.manifestoTransacaoDesconhecida)],
              ['Lastro inconsistente', moeda(atual?.manifestoLastroInconsistente)],
              ['Transação não concluída', moeda(atual?.manifestoTransacaoNaoConcluida)],
            ]}
          />
        </Painel>

        <Painel titulo="Performance da carteira">
          <DlGrid
            itens={[
              ['Liquidado no período', moeda(atual?.liquidadoNoPeriodo)],
              ['Recompras', moeda(atual?.recompras)],
              ['Motivo da recompra', atual?.motivoRecompra ?? '—'],
              ['% liquidado no prazo', perc(atual?.percLiquidadoNoPrazo)],
              ['Atraso médio', dias(atual?.atrasoMedioDias)],
              ['Restritivos (total)', atual ? String(atual.restritivos) : SEM_POSICAO],
              ['Prorrogações > 60 dias', atual?.prorrogacoesAcima60d === null || atual?.prorrogacoesAcima60d === undefined ? 'Não informado' : formatarMoeda(atual.prorrogacoesAcima60d)],
              [
                'Operações (mês anterior → mês)',
                atual?.operacoesMes === null || atual?.operacoesMes === undefined ? 'Não informado' : `${moeda(atual.operacoesMesAnterior)} → ${formatarMoeda(atual.operacoesMes)}`,
              ],
            ]}
          />
        </Painel>

        <PainelRestritivos clienteId={cliente.id} semanaRef={semanaRefChecklist} restritivos={restritivos} podeEditar={podeEditar} aoAtualizar={setRestritivos} />

        <Painel titulo="Evolução do risco x vencido" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dadosRisco} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
              <XAxis dataKey="semana" tickFormatter={(v) => formatarData(v)} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatarMoedaCompacta(Number(v))} width={80} />
              <Tooltip labelFormatter={(v) => formatarData(String(v))} formatter={(v) => formatarMoeda(Number(v))} />
              <Line type="monotone" dataKey="risco" stroke="var(--cor-acento)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="vencido" stroke="var(--cor-critico)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Painel>

        <div className="lg:col-span-2">
          <PainelTransacional clienteId={cliente.id} />
        </div>

        {saida && (
          <Painel titulo="Saída de Risco" className="lg:col-span-2">
            <DlGrid
              itens={[
                ['Data de entrada', formatarData(saida.dataEntrada)],
                ['Motivo', saida.motivo],
                ['Risco na entrada', formatarMoeda(saida.riscoNaEntrada)],
                ['Risco atual', moeda(atual?.riscoCliente)],
                ['Plano de saída', saida.planoSaida],
                ['Prazo esperado', formatarData(saida.prazoEsperado)],
                ['Responsável', saida.responsavel],
              ]}
            />
            {eventosIasr.length > 0 && (
              <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: 'var(--cor-critico-fundo)' }}>
                <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--cor-critico)' }}>
                  Eventos posteriores identificados (IASR)
                </p>
                <ul className="list-inside list-disc text-xs">
                  {eventosIasr.map((e, i) => (
                    <li key={i}>
                      {formatarData(e.data)} — {e.tipo}: {e.descricao}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Painel>
        )}

        {juridico && (
          <Painel titulo="Jurídico" className="lg:col-span-2">
            <DlGrid
              itens={[
                ['Data de envio', formatarData(juridico.dataEnvio)],
                ['Motivo', juridico.motivo],
                ['Medida adotada', juridico.medidaAdotada],
                ['Responsável jurídico', juridico.responsavelJuridico],
                ['Status', juridico.status],
                ['Valor recuperado', formatarMoeda(juridico.valorRecuperado)],
                ['Saldo', formatarMoeda(juridico.saldo)],
                ['Próximo passo', juridico.proximoPasso],
                ['Prazo', formatarData(juridico.prazo)],
              ]}
            />
          </Painel>
        )}

        <Painel titulo={`Alertas (${alertas.length})`} className="lg:col-span-2">
          {alertas.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">Nenhum alerta registrado.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {alertas.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
                  <div>
                    <p className="font-medium">{a.tipo}</p>
                    <p className="text-xs text-gray-600">{a.descricao}</p>
                    <p className="text-[11px] text-gray-400">{formatarData(a.data)} · {a.responsavel}</p>
                  </div>
                  <GravidadeBadge gravidade={a.gravidade} />
                </li>
              ))}
            </ul>
          )}
        </Painel>

        <HistoricoDecisoes planos={planos} podeEditar={podeEditar} aoAtualizar={(p) => setPlanos((lista) => lista.map((x) => (x.id === p.id ? p : x)))} />

        <Painel titulo="Linha do tempo" className="lg:col-span-2">
          {eventos.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">Nenhum evento no histórico.</p>
          ) : (
            <ul className="flex flex-col gap-3 border-l-2 pl-4" style={{ borderColor: 'var(--cor-borda)' }}>
              {eventos.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--cor-acao)' }} />
                  <p className="text-xs font-semibold" style={{ color: 'var(--cor-texto-secundario)' }}>
                    {formatarDataHora(e.data)} · {e.usuario}
                  </p>
                  <p>
                    {e.tipo === 'MUDANCA_STATUS' ? (
                      <>
                        Status alterado de <strong>{STATUS_LABEL[e.valorAnterior ?? ''] ?? e.valorAnterior}</strong> para{' '}
                        <strong>{STATUS_LABEL[e.valorNovo ?? ''] ?? e.valorNovo}</strong> — {e.justificativa}
                      </>
                    ) : (
                      <>
                        {ROTULO_EVENTO[e.tipo] && <strong>{ROTULO_EVENTO[e.tipo]}: </strong>}
                        {e.justificativa}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Painel>
      </div>
    </div>
  )
}

function DlGrid({ itens }: { itens: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {itens.map(([chave, valor]) => (
        <div key={chave}>
          <dt className="text-[11px] font-semibold uppercase" style={{ color: 'var(--cor-texto-secundario)' }}>
            {chave}
          </dt>
          <dd className="font-medium" style={{ color: 'var(--cor-texto-primario)' }}>
            {valor}
          </dd>
        </div>
      ))}
    </dl>
  )
}
