import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { consultas } from '../consultas'
import { Portal } from './ui/Portal'
import { faixasVencimentario, type DadoVisualChecklist, type FaixaVencimentario } from '@monitoramento/dominio'
import { useLocation, useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BitfinEvento, ChaveItemChecklist, DetalheBitfinDoCliente, Juridico, PlanoAcao, SnapshotSemanal } from '../models/types'
import { graficoPaleta } from '../theme/colors'
import { formatarData, formatarDataHora, formatarDias, formatarMoeda, formatarPercentual } from '../utils/formatters'
import PainelTransacional from './PainelTransacional'
import { GravidadeBadge, StatusPlanoBadge } from './ui/Badges'

type Formato = 'moeda' | 'percentual' | 'dias' | 'numero'

function formatarValor(v: number, formato: Formato): string {
  if (formato === 'moeda') return formatarMoeda(v)
  if (formato === 'percentual') return formatarPercentual(v)
  if (formato === 'dias') return formatarDias(v)
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

/** Eventos do Bitfin da última semana (1.2), com as ocorrências completas. */
function ListaEventosBitfin({ bitfin }: { bitfin: DetalheBitfinDoCliente | null }) {
  if (!bitfin) return <p className="py-4 text-center text-sm text-[color:var(--cor-texto-secundario)]">Sem foto do Bitfin para este cliente até esta semana.</p>
  const eventos: BitfinEvento[] = bitfin.detalhe.eventos
  const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        Foto do Bitfin de {formatarDataHora(bitfin.tiradaEm)} · eventos dos 7 dias anteriores à foto.
      </p>
      {eventos.length === 0 ? (
        <p className="py-4 text-center text-sm text-[color:var(--cor-texto-secundario)]">Nenhum evento no Bitfin na última semana.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {eventos.map((e) => (
            <li key={e.eventoId} className="border-b pb-2 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
              <p className="font-medium" style={{ color: 'var(--cor-primaria)' }}>
                {e.titulo}
                {e.categoria && (
                  <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--cor-texto-secundario)' }}>
                    {e.categoria}
                  </span>
                )}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                {quando(e.dataCadastro)} · {e.criadoPor ?? 'Bitfin (automático)'}
              </p>
              {e.ocorrencias.length === 0 ? (
                <p className="mt-1 text-xs italic" style={{ color: 'var(--cor-texto-secundario)' }}>
                  Sem texto registrado.
                </p>
              ) : (
                e.ocorrencias.map((o, i) => (
                  <div key={i} className="mt-1 border-l-2 pl-2 text-xs" style={{ borderColor: 'var(--cor-borda-forte)' }}>
                    <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                      {quando(o.data)} · {o.autor ?? 'Bitfin (automático)'}
                    </p>
                    <p className="whitespace-pre-wrap break-words font-mono text-[11.5px]">{o.mensagem ?? 'Sem texto registrado.'}</p>
                  </div>
                ))
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Limite do cliente no Bitfin, por produto (1.2). */
/** Manifesto como na tela do Bitfin: todas as categorias, % do risco e total;
 * os 4 tipos que somam no card em destaque. */
function TabelaManifesto({ dado }: { dado: Extract<DadoVisualChecklist, { tipo: 'manifesto' }> }) {
  const problema = new Set(dado.tipos.map((t) => t.chave))
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full min-w-[340px] text-sm">
        <thead className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
          <tr>
            <th className="py-1 text-left">Categoria</th>
            <th className="py-1 text-right">%</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {dado.todas.map((c) => (
            <tr key={c.chave} className="border-t align-top" style={{ borderColor: 'var(--cor-borda)', opacity: c.valor > 0 ? 1 : 0.5 }}>
              <td className="py-1">
                <span className="font-medium" style={{ color: problema.has(c.chave) && c.valor > 0 ? 'var(--cor-critico)' : undefined }}>
                  {c.label}
                  {problema.has(c.chave) && <span className="ml-1 text-[10px]" style={{ color: 'var(--cor-texto-secundario)' }}>(soma do card)</span>}
                </span>
                <span className="block text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                  {c.descricao}
                </span>
              </td>
              <td className="numeros-tabulares py-1 text-right">{c.valor > 0 && c.perc !== null ? formatarPercentual(c.perc, 0) : '—'}</td>
              <td className="numeros-tabulares py-1 text-right">{c.valor > 0 ? formatarMoeda(c.valor) : '—'}</td>
            </tr>
          ))}
          <tr className="border-t font-semibold" style={{ borderColor: 'var(--cor-borda-forte)' }}>
            <td className="py-1.5">Risco com manifesto</td>
            <td className="py-1.5 text-right">100%</td>
            <td className="numeros-tabulares py-1.5 text-right">{formatarMoeda(dado.baseRisco)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Vencimentário (aging) do Bitfin: a vencer e vencido por faixa, da foto. */
function VencimentarioBitfin({ bitfin }: { bitfin: DetalheBitfinDoCliente | null }) {
  if (!bitfin) return <p className="py-4 text-sm" style={{ color: 'var(--cor-atencao)' }}>Sem foto do Bitfin para este cliente: vencimentário não conferido.</p>
  const aging = bitfin.detalhe.aging
  if (!aging) return <p className="py-4 text-sm" style={{ color: 'var(--cor-atencao)' }}>O Bitfin não trouxe o vencimentário deste cliente na foto de {formatarDataHora(bitfin.tiradaEm)}.</p>
  const faixas = faixasVencimentario(aging)
  const total = faixas.reduce((t, f) => t + f.valor, 0)
  const grupo = (g: FaixaVencimentario['grupo'], titulo: string) => {
    const linhas = faixas.filter((f) => f.grupo === g)
    const soma = linhas.reduce((t, f) => t + f.valor, 0)
    return (
      <tbody>
        <tr className="border-t" style={{ borderColor: 'var(--cor-borda-forte)' }}>
          <th className="py-1.5 text-left font-semibold">{titulo}</th>
          <th className="numeros-tabulares py-1.5 text-right font-semibold">{formatarMoeda(soma)}</th>
          <th className="numeros-tabulares py-1.5 text-right font-semibold">{total > 0 ? formatarPercentual((soma / total) * 100) : '—'}</th>
        </tr>
        {linhas.map((f) => (
          <tr key={f.faixa} className="border-t" style={{ borderColor: 'var(--cor-borda)', color: f.valor > 0 && f.grupo === 'VENCIDO' ? (f.acima90 ? 'var(--cor-critico)' : 'var(--cor-atencao)') : undefined }}>
            <td className="py-1 pl-3">{f.faixa}</td>
            <td className="numeros-tabulares py-1 text-right">{f.valor > 0 ? formatarMoeda(f.valor) : '—'}</td>
            <td className="numeros-tabulares py-1 text-right">{f.valor > 0 && total > 0 ? formatarPercentual((f.valor / total) * 100) : '—'}</td>
          </tr>
        ))}
      </tbody>
    )
  }
  return (
    <div className="mb-3 overflow-x-auto">
      <p className="mb-1 text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        Vencimentário do Bitfin (foto de {formatarDataHora(bitfin.tiradaEm)}) · total {formatarMoeda(total)}
      </p>
      <table className="w-full min-w-[320px] text-sm">
        <thead className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
          <tr>
            <th className="py-1 text-left">Faixa</th>
            <th className="py-1 text-right">Valor</th>
            <th className="py-1 text-right">% do total</th>
          </tr>
        </thead>
        {grupo('A_VENCER', 'A vencer')}
        {grupo('VENCIDO', 'Vencido')}
      </table>
    </div>
  )
}

function LimiteBitfin({ bitfin }: { bitfin: DetalheBitfinDoCliente | null }) {
  if (!bitfin) return null
  const l = bitfin.detalhe.limite
  return (
    <div className="mb-3 overflow-x-auto">
      <p className="mb-1 text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        Bitfin ({formatarDataHora(bitfin.tiradaEm)}): limite {formatarMoeda(l.total)}
        {l.origem === 'PROPOSTA' ? ` · proposta ${l.propostaId}${l.validade ? `, validade ${formatarData(l.validade)}` : ''}` : l.origem === 'PRODUTOS' ? ' · soma dos limites por produto (sem proposta vigente)' : ' · sem limite cadastrado'}
      </p>
      {l.porProduto.length > 0 && (
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
            <tr>
              <th className="py-1 text-left">Produto</th>
              <th className="py-1 text-right">Limite</th>
              <th className="py-1 text-right">Tranche</th>
              <th className="py-1 text-right">Risco</th>
            </tr>
          </thead>
          <tbody>
            {l.porProduto.map((p) => (
              <tr key={p.produto} className="border-t" style={{ borderColor: 'var(--cor-borda)' }}>
                <td className="py-1">{p.produto}</td>
                <td className="numeros-tabulares py-1 text-right">{formatarMoeda(p.limite)}</td>
                <td className="numeros-tabulares py-1 text-right">{p.tranche > 0 ? formatarMoeda(p.tranche) : '—'}</td>
                <td className="numeros-tabulares py-1 text-right">{formatarMoeda(p.risco)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ListaPlanos({ planos }: { planos: PlanoAcao[] }) {
  if (planos.length === 0) return <p className="py-4 text-center text-sm text-[color:var(--cor-texto-secundario)]">Nenhum plano de ação registrado para este cliente.</p>
  return (
    <ul className="flex flex-col gap-2">
      {planos.map((p) => (
        <li key={p.id} className="border-b pb-2 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">{p.decisaoAtual}</span>
            <StatusPlanoBadge status={p.status} />
          </div>
          <p className="text-xs text-[color:var(--cor-texto-secundario)]">{p.plano}</p>
          <p className="text-[11px] text-[color:var(--cor-texto-secundario)]">
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
  semanaRef,
  item,
  label,
  resumo,
  gravidade,
  dado,
  aoFechar,
}: {
  clienteId: string
  semanaRef?: string | null
  item: ChaveItemChecklist
  label: string
  resumo: string
  gravidade: 'VERDE' | 'AMARELO' | 'VERMELHO'
  dado?: DadoVisualChecklist
  aoFechar: () => void
}) {
  const navigate = useNavigate()
  const local = useLocation()
  const usaBitfin = item === 'EVENTOS' || item === 'LIMITE_CONSUMIDO' || item === 'AGING_CARTEIRA'
  const bitfinQ = useQuery({ ...consultas.bitfinDoCliente(clienteId, semanaRef ?? undefined), enabled: usaBitfin })
  // Falha da leitura do Bitfin aparece como indisponível (null), nunca como "sem eventos".
  const bitfin: DetalheBitfinDoCliente | null | undefined = bitfinQ.isError ? null : bitfinQ.data
  const [serieQ, alertasQ, planosQ, juridicoQ] = useQueries({
    queries: [consultas.snapshotsCliente(clienteId), consultas.alertasCliente(clienteId), consultas.planosCliente(clienteId), consultas.juridicoCliente(clienteId)],
  })
  const serie = serieQ.data ?? null
  const alertas = useMemo(() => (alertasQ.data ? [...alertasQ.data].sort((x, y) => y.data.localeCompare(x.data)) : null), [alertasQ.data])
  const planos = useMemo(() => (planosQ.data ? [...planosQ.data].sort((x, y) => y.dataDecisaoAtual.localeCompare(x.dataDecisaoAtual)) : null), [planosQ.data])
  const juridico = juridicoQ.data ?? null

  const carregando = !serie || !alertas || !planos

  function conteudo() {
    if (carregando) return <p className="py-8 text-center text-sm text-[color:var(--cor-texto-secundario)]">Carregando…</p>

    if (item === 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO') return <PainelTransacional clienteId={clienteId} />

    if (item === 'EVENTOS') return bitfin === undefined ? <p className="py-8 text-center text-sm text-[color:var(--cor-texto-secundario)]">Carregando…</p> : <ListaEventosBitfin bitfin={bitfin} />
    if (item === 'LIMITE_CONSUMIDO')
      return (
        <>
          <LimiteBitfin bitfin={bitfin ?? null} />
          <GraficoHistorico serie={serie!} campos={[{ campo: 'percConsumoLimite', titulo: '% do limite consumido' }]} formato="percentual" />
        </>
      )

    if (item === 'AGING_CARTEIRA')
      return bitfin === undefined ? <p className="py-8 text-center text-sm text-[color:var(--cor-texto-secundario)]">Carregando…</p> : <VencimentarioBitfin bitfin={bitfin} />

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
    if (item === 'MANIFESTOS')
      return (
        <>
          {dado?.tipo === 'manifesto' && <TabelaManifesto dado={dado} />}
          <GraficoHistorico serie={serie!} campos={SERIE_MANIFESTOS} formato="moeda" />
        </>
      )

    const config = CAMPO_UNICO[item]
    if (config) return <GraficoHistorico serie={serie!} campos={[{ campo: config.campo, titulo: config.titulo }]} formato={config.formato} />

    return <p className="py-6 text-center text-sm text-[color:var(--cor-texto-secundario)]">Sem dado histórico estruturado para este item — o parecer do executivo é a fonte principal.</p>
  }

  return (
    <Portal>
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
          {/* Na própria ficha o link não leva a lugar nenhum: some. Fora dela, fecha o
              detalhe (e o Modo de Revisão, que é da página de origem) e abre a ficha. */}
          {local.pathname !== `/clientes/${clienteId}` && (
            <button
              type="button"
              onClick={() => {
                aoFechar()
                navigate(`/clientes/${clienteId}`)
              }}
              className="mt-4 min-h-[40px] text-xs font-medium underline"
              style={{ color: 'var(--cor-destaque)' }}
            >
              Ver ficha completa do cliente →
            </button>
          )}
        </div>
      </div>
    </div>
    </Portal>
  )
}
