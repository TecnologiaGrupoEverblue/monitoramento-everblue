import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Alerta, ChaveItemChecklist, Juridico, PlanoAcao, SnapshotSemanal } from '../models/types'
import { alertaRepository, juridicoRepository, planoAcaoRepository, snapshotRepository } from '../repositories'
import { graficoPaleta } from '../theme/colors'
import { formatarData, formatarDataHora, formatarMoeda, formatarPercentual } from '../utils/formatters'
import PainelTransacional from './PainelTransacional'
import { GravidadeBadge, StatusPlanoBadge } from './ui/Badges'

type Formato = 'moeda' | 'percentual' | 'dias' | 'numero'

function formatarValor(v: number, formato: Formato): string {
  if (formato === 'moeda') return formatarMoeda(v)
  if (formato === 'percentual') return formatarPercentual(v)
  if (formato === 'dias') return `${v.toFixed(0)} dias`
  return v.toFixed(0)
}

const CAMPO_UNICO: Partial<Record<ChaveItemChecklist, { campo: keyof SnapshotSemanal; titulo: string; formato: Formato }>> = {
  RISCO_MENSAL: { campo: 'riscoCliente', titulo: 'Risco do cliente', formato: 'moeda' },
  LIMITE_CONSUMIDO: { campo: 'percConsumoLimite', titulo: '% do limite consumido', formato: 'percentual' },
  TRANCHE_CONSUMIDA: { campo: 'percConsumoTranche', titulo: '% da tranche consumida', formato: 'percentual' },
  VENCIDOS: { campo: 'vencidoOficial', titulo: 'Vencido oficial', formato: 'moeda' },
  VENCIDOS_DESDE_QUANDO: { campo: 'vencidoOficial', titulo: 'Vencido oficial', formato: 'moeda' },
  PRAZO_MEDIO_CARTEIRA: { campo: 'prazoMedioCarteiraDias', titulo: 'Prazo médio da carteira', formato: 'dias' },
  AGING_CARTEIRA: { campo: 'agingCarteiraDias', titulo: 'Aging da carteira', formato: 'dias' },
  COMPORTAMENTO_CALENDARIO: { campo: 'atrasoMedioDias', titulo: 'Atraso médio de pagamento', formato: 'dias' },
  EVOLUCAO_RESTRITIVOS: { campo: 'restritivos', titulo: 'Restritivos em aberto', formato: 'numero' },
}

const SERIE_LIQUIDEZ: { campo: keyof SnapshotSemanal; titulo: string }[] = [
  { campo: 'il30', titulo: 'IL 30' },
  { campo: 'il60', titulo: 'IL 60' },
  { campo: 'il90', titulo: 'IL 90' },
  { campo: 'il120', titulo: 'IL 120' },
  { campo: 'il150', titulo: 'IL 150' },
  { campo: 'il180', titulo: 'IL 180' },
]

const SERIE_MANIFESTOS: { campo: keyof SnapshotSemanal; titulo: string }[] = [
  { campo: 'manifestoInacessivel', titulo: 'Inacessível' },
  { campo: 'manifestoNaoConfirma', titulo: 'Não confirma' },
  { campo: 'manifestoTransacaoDesconhecida', titulo: 'Transação desconhecida' },
  { campo: 'manifestoLastroInconsistente', titulo: 'Lastro inconsistente' },
  { campo: 'manifestoTransacaoNaoConcluida', titulo: 'Transação não concluída' },
]

function GraficoHistorico({ serie, campos, formato }: { serie: SnapshotSemanal[]; campos: { campo: keyof SnapshotSemanal; titulo: string }[]; formato: Formato }) {
  const dados = serie.map((s) => {
    const linha: Record<string, string | number> = { semana: s.semanaRef }
    for (const c of campos) linha[c.titulo] = s[c.campo] as number
    return linha
  })
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={dados} margin={{ left: 8, right: 16, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
        <XAxis dataKey="semana" tickFormatter={(v) => formatarData(String(v))} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatarValor(Number(v), formato)} width={formato === 'moeda' ? 90 : 50} />
        <Tooltip labelFormatter={(v) => formatarData(String(v))} formatter={(v) => formatarValor(Number(v), formato)} />
        {campos.map((c, i) => (
          <Line key={c.titulo} type="monotone" dataKey={c.titulo} stroke={graficoPaleta[i % graficoPaleta.length]} strokeWidth={2} dot={{ r: 2 }} name={c.titulo} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function ListaAlertas({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return <p className="py-4 text-center text-sm text-gray-400">Nenhum alerta registrado para este cliente.</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {alertas.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-2 border-b py-1.5 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
          <div>
            <p className="font-medium">{a.tipo}</p>
            <p className="text-xs text-gray-600">{a.descricao}</p>
            <p className="text-[11px] text-gray-400">
              {formatarData(a.data)} · {a.responsavel} · {a.status}
            </p>
          </div>
          <GravidadeBadge gravidade={a.gravidade} />
        </li>
      ))}
    </ul>
  )
}

function ListaPlanos({ planos }: { planos: PlanoAcao[] }) {
  if (planos.length === 0) return <p className="py-4 text-center text-sm text-gray-400">Nenhum plano de ação registrado para este cliente.</p>
  return (
    <ul className="flex flex-col gap-2">
      {planos.map((p) => (
        <li key={p.id} className="border-b pb-2 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">{p.decisaoAtual}</span>
            <StatusPlanoBadge status={p.status} />
          </div>
          <p className="text-xs text-gray-600">{p.plano}</p>
          <p className="text-[11px] text-gray-400">
            {p.responsavel} · Decisão em {formatarData(p.dataDecisaoAtual)} · Prazo {formatarData(p.dataLimite)}
          </p>
          {p.oQueFoiFeito && <p className="mt-1 text-xs">Feito: {p.oQueFoiFeito}</p>}
          {p.oQueNaoFoiFeito && (
            <p className="mt-1 text-xs" style={{ color: 'var(--cor-critico)' }}>
              Não feito: {p.oQueNaoFoiFeito}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function BlocoJuridico({ juridico }: { juridico: Juridico }) {
  const linhas: [string, string][] = [
    ['Data de envio', formatarData(juridico.dataEnvio)],
    ['Motivo', juridico.motivo],
    ['Medida adotada', juridico.medidaAdotada],
    ['Responsável jurídico', juridico.responsavelJuridico],
    ['Status', juridico.status],
    ['Valor recuperado', formatarMoeda(juridico.valorRecuperado)],
    ['Saldo', formatarMoeda(juridico.saldo)],
    ['Próximo passo', juridico.proximoPasso],
    ['Prazo', formatarData(juridico.prazo)],
    ['Última atualização', formatarDataHora(juridico.ultimaAtualizacao)],
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {linhas.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] font-semibold uppercase" style={{ color: 'var(--cor-texto-secundario)' }}>
            {k}
          </dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Detalhe granular de um item do checklist — abre ao clicar no quadrado,
 * para quando o comitê quiser entender o dado por trás da gravidade: série
 * histórica completa (todas as semanas, não só as últimas 8), lista de
 * alertas, planos de ação ou o processo jurídico, conforme o item. */
export default function DetalheItemChecklist({
  clienteId,
  item,
  label,
  resumo,
  gravidade,
  aoFechar,
}: {
  clienteId: string
  item: ChaveItemChecklist
  label: string
  resumo: string
  gravidade: 'VERDE' | 'AMARELO' | 'VERMELHO'
  aoFechar: () => void
}) {
  const navigate = useNavigate()
  const [serie, setSerie] = useState<SnapshotSemanal[] | null>(null)
  const [alertas, setAlertas] = useState<Alerta[] | null>(null)
  const [planos, setPlanos] = useState<PlanoAcao[] | null>(null)
  const [juridico, setJuridico] = useState<Juridico | null>(null)

  useEffect(() => {
    let ativo = true
    Promise.all([snapshotRepository.porCliente(clienteId), alertaRepository.porCliente(clienteId), planoAcaoRepository.porCliente(clienteId), juridicoRepository.porCliente(clienteId)]).then(
      ([s, a, p, j]) => {
        if (!ativo) return
        setSerie(s)
        setAlertas([...a].sort((x, y) => y.data.localeCompare(x.data)))
        setPlanos([...p].sort((x, y) => y.dataDecisaoAtual.localeCompare(x.dataDecisaoAtual)))
        setJuridico(j)
      },
    )
    return () => {
      ativo = false
    }
  }, [clienteId])

  const carregando = !serie || !alertas || !planos

  function conteudo() {
    if (carregando) return <p className="py-8 text-center text-sm text-gray-400">Carregando…</p>

    if (item === 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO') return <PainelTransacional clienteId={clienteId} />

    if (item === 'EVENTOS') return <ListaAlertas alertas={alertas!} />

    if (item === 'PLANO_ACAO_NOVA_DECISAO') return <ListaPlanos planos={planos!} />

    if (item === 'PARECER_JURIDICO') {
      if (juridico) return <BlocoJuridico juridico={juridico} />
      return (
        <div>
          <p className="mb-3 text-sm">{resumo}</p>
          <p className="mb-1 text-xs font-semibold uppercase" style={{ color: 'var(--cor-texto-secundario)' }}>
            Restritivos em aberto (histórico)
          </p>
          <GraficoHistorico serie={serie!} campos={[{ campo: 'restritivos', titulo: 'Restritivos' }]} formato="numero" />
        </div>
      )
    }

    if (item === 'LIQUIDEZ_15_30_60') return <GraficoHistorico serie={serie!} campos={SERIE_LIQUIDEZ} formato="percentual" />
    if (item === 'MANIFESTOS') return <GraficoHistorico serie={serie!} campos={SERIE_MANIFESTOS} formato="moeda" />

    const config = CAMPO_UNICO[item]
    if (config) return <GraficoHistorico serie={serie!} campos={[{ campo: config.campo, titulo: config.titulo }]} formato={config.formato} />

    return <p className="py-6 text-center text-sm text-gray-400">Sem dado histórico estruturado para este item — o parecer do executivo é a fonte principal.</p>
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={aoFechar}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col border bg-[var(--cor-superficie-solida)]" style={{ borderColor: 'var(--cor-borda-forte)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--cor-borda)' }}>
          <div className="flex items-center gap-2">
            <h2 className="fonte-editorial text-lg font-semibold" style={{ color: 'var(--cor-primaria)' }}>
              {label}
            </h2>
            <GravidadeBadge gravidade={gravidade} />
          </div>
          <button onClick={aoFechar} className="px-2 py-1 text-sm hover:bg-[var(--cor-fundo-recuado)]" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <p className="mb-3 text-sm" style={{ color: 'var(--cor-texto-primario)' }}>
            {resumo}
          </p>
          {conteudo()}
          <button onClick={() => navigate(`/clientes/${clienteId}`)} className="mt-4 text-xs font-medium underline" style={{ color: 'var(--cor-destaque)' }}>
            Ver ficha completa do cliente →
          </button>
        </div>
      </div>
    </div>
  )
}
