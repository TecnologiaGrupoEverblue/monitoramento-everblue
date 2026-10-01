import { useEffect, useMemo, useState } from 'react'
import type { ChaveItemChecklist, Gravidade } from '../models/types'
import { checklistRepository, GRUPOS_CHECKLIST, ITENS_CHECKLIST, type ItemChecklistView } from '../repositories'
import type { DadoVisualChecklist, StatusJuridicoResumo } from '../regras/motorChecklist'
import { gravidadeCor } from '../theme/colors'
import { useSessao } from '../contexts/SessaoContext'
import { formatarPercentual } from '../utils/formatters'
import { StatusPlanoBadge } from './ui/Badges'
import DetalheItemChecklist from './DetalheItemChecklist'

const OPCOES_GRAVIDADE: Gravidade[] = ['VERDE', 'AMARELO', 'VERMELHO']
const LABEL_POR_CHAVE = new Map(ITENS_CHECKLIST.map((i) => [i.chave, i.label]))

function SeletorGravidade({ gravidade, onChange }: { gravidade: Gravidade; onChange: (g: Gravidade) => void }) {
  return (
    <div className="flex shrink-0 gap-1">
      {OPCOES_GRAVIDADE.map((g) => {
        const cor = gravidadeCor[g]
        const ativo = g === gravidade
        return (
          <button
            key={g}
            type="button"
            title={g === 'VERDE' ? 'Marcar como normal' : g === 'AMARELO' ? 'Marcar como atenção' : 'Marcar como crítico'}
            onClick={() => onChange(g)}
            className="h-2.5 w-2.5 rounded-full border"
            style={{ backgroundColor: ativo ? cor.texto : 'transparent', borderColor: cor.texto, opacity: ativo ? 1 : 0.5 }}
          />
        )
      })}
    </div>
  )
}

function Estatistica({ titulo, valor, cor, fundo }: { titulo: string; valor: number; cor: string; fundo: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center px-3 py-2" style={{ backgroundColor: fundo }}>
      <span className="fonte-editorial text-2xl font-bold leading-none" style={{ color: cor }}>
        {valor}
      </span>
      <span className="mt-0.5 text-[11px] font-medium" style={{ color: cor }}>
        {titulo}
      </span>
    </div>
  )
}

function BarraPercentual({ valor, cor }: { valor: number; cor: string }) {
  const larguraFundo = Math.min(100, valor)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--cor-superficie-solida)]/70">
        <div className="h-full rounded-full" style={{ width: `${larguraFundo}%`, backgroundColor: cor }} />
      </div>
      <span className="numeros-tabulares shrink-0 text-[12px] font-bold" style={{ color: cor }}>
        {formatarPercentual(valor, 0)}
      </span>
    </div>
  )
}

function Sparkline({ serie, cor }: { serie: number[]; cor: string }) {
  if (serie.length < 2) return null
  const w = 84
  const h = 24
  const pad = 3
  const min = Math.min(...serie)
  const max = Math.max(...serie)
  const range = max - min || 1
  const pontos = serie
    .map((v, i) => {
      const x = pad + (i / (serie.length - 1)) * (w - pad * 2)
      const y = h - pad - ((v - min) / range) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const ultimoX = w - pad
  const ultimoY = h - pad - ((serie[serie.length - 1] - min) / range) * (h - pad * 2)
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pontos} fill="none" stroke={cor} strokeWidth={1.5} />
      <circle cx={ultimoX} cy={ultimoY} r={2} fill={cor} />
    </svg>
  )
}

function StatusJuridicoBadge({ status }: { status: StatusJuridicoResumo }) {
  const mapa: Record<StatusJuridicoResumo, { label: string; cor: string; fundo: string }> = {
    EM_ANDAMENTO: { label: 'Em andamento', cor: gravidadeCor.VERMELHO.texto, fundo: gravidadeCor.VERMELHO.fundo },
    ACORDO: { label: 'Em acordo', cor: gravidadeCor.AMARELO.texto, fundo: gravidadeCor.AMARELO.fundo },
    ENCERRADO: { label: 'Encerrado', cor: gravidadeCor.VERDE.texto, fundo: gravidadeCor.VERDE.fundo },
    ATENCAO_PREVENTIVA: { label: 'Atenção preventiva', cor: gravidadeCor.AMARELO.texto, fundo: gravidadeCor.AMARELO.fundo },
    SEM_PROCESSO: { label: 'Sem processo', cor: gravidadeCor.VERDE.texto, fundo: gravidadeCor.VERDE.fundo },
  }
  const cfg = mapa[status]
  return (
    <span className="inline-flex items-center rounded-full border-l-2 px-2 py-0.5 text-[11px] font-medium" style={{ color: cfg.cor, backgroundColor: cfg.fundo, borderColor: cfg.cor }}>
      {cfg.label}
    </span>
  )
}

function Widget({ dado }: { dado: DadoVisualChecklist }) {
  switch (dado.tipo) {
    case 'percentual':
      return <BarraPercentual valor={dado.valor} cor={dado.valor >= 100 ? gravidadeCor.VERMELHO.texto : dado.valor >= 85 ? gravidadeCor.AMARELO.texto : gravidadeCor.VERDE.texto} />
    case 'percentuais':
      return (
        <div className="flex flex-col gap-1">
          {dado.itens.map((it) => (
            <div key={it.label} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[10.5px] font-medium">{it.label}</span>
              <BarraPercentual valor={it.valor} cor={it.valor < 60 ? gravidadeCor.VERMELHO.texto : it.valor < 80 ? gravidadeCor.AMARELO.texto : gravidadeCor.VERDE.texto} />
            </div>
          ))}
        </div>
      )
    case 'tendencia': {
      const subiu = (dado.variacaoPerc ?? 0) >= 0
      const cor = dado.variacaoPerc === null ? 'var(--cor-texto-secundario)' : subiu ? gravidadeCor.VERMELHO.texto : gravidadeCor.VERDE.texto
      return (
        <div className="flex items-center gap-2">
          <Sparkline serie={dado.serie} cor={cor} />
          {dado.variacaoPerc !== null && (
            <span className="numeros-tabulares text-[12px] font-bold" style={{ color: cor }}>
              {subiu ? '▲' : '▼'} {Math.abs(dado.variacaoPerc).toFixed(1)}%
            </span>
          )}
        </div>
      )
    }
    case 'statusPlano':
      return <StatusPlanoBadge status={dado.status} />
    case 'statusJuridico':
      return <StatusJuridicoBadge status={dado.status} />
    case 'categorias':
      return (
        <div className="flex flex-wrap gap-1">
          {dado.itens.map((it) => {
            const cor = it.cor ? gravidadeCor[it.cor] : { texto: 'var(--cor-texto-primario)', fundo: 'rgba(255,255,255,0.6)' }
            return (
              <span key={it.label} className="rounded-full border-l-2 px-2 py-0.5 text-[10.5px] font-medium" style={{ color: cor.texto, backgroundColor: cor.fundo, borderColor: cor.texto }}>
                {it.label}
                {it.exibicao ? ` · ${it.exibicao}` : ''}
              </span>
            )
          })}
        </div>
      )
    default:
      return null
  }
}

/** Checklist de Análise Semanal — os 17 pontos do roteiro oficial do
 * comitê, agrupados em 4 blocos temáticos, TODOS sempre visíveis (nada
 * escondido atrás de clique). Cada bloco é a cor da gravidade + um widget
 * visual do dado real (barra, sparkline, badge ou chips) + o parecer do
 * executivo, lado a lado. */
export default function ChecklistAnalise({
  clienteId,
  semanaRef,
  usuario,
  compacto = false,
}: {
  clienteId: string
  semanaRef: string | null
  usuario: string
  compacto?: boolean
}) {
  const [itens, setItens] = useState<ItemChecklistView[] | null>(null)
  const [detalheAberto, setDetalheAberto] = useState<ChaveItemChecklist | null>(null)

  useEffect(() => {
    if (!semanaRef) {
      setItens([])
      return
    }
    let ativo = true
    checklistRepository.obterChecklist(clienteId, semanaRef).then((lista) => {
      if (ativo) setItens(lista)
    })
    return () => {
      ativo = false
    }
  }, [clienteId, semanaRef])

  const contagem = useMemo(
    () => ({
      vermelho: itens?.filter((i) => i.gravidade === 'VERMELHO').length ?? 0,
      amarelo: itens?.filter((i) => i.gravidade === 'AMARELO').length ?? 0,
      verde: itens?.filter((i) => i.gravidade === 'VERDE').length ?? 0,
    }),
    [itens],
  )

  const { pode } = useSessao()
  async function salvar(item: ChaveItemChecklist, alteracoes: { parecer?: string; gravidade?: Gravidade; gravidadeManual?: boolean }) {
    if (!semanaRef || !pode('analista')) return
    await checklistRepository.salvarItem(clienteId, semanaRef, item, { ...alteracoes, atualizadoPor: usuario })
    setItens((atual) => (atual ? atual.map((i) => (i.item === item ? { ...i, ...alteracoes, persistido: true } : i)) : atual))
  }

  if (!semanaRef) return <p className="text-xs text-gray-400">Selecione uma posição de carteira para ver o checklist.</p>
  if (!itens || itens.length === 0) return <p className="text-xs text-gray-400">Carregando checklist…</p>

  const porChave = new Map(itens.map((it) => [it.item, it]))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-px" style={{ backgroundColor: 'var(--cor-borda)' }}>
        <Estatistica titulo="crítico(s)" valor={contagem.vermelho} cor={gravidadeCor.VERMELHO.texto} fundo={gravidadeCor.VERMELHO.fundo} />
        <Estatistica titulo="atenção" valor={contagem.amarelo} cor={gravidadeCor.AMARELO.texto} fundo={gravidadeCor.AMARELO.fundo} />
        <Estatistica titulo="normal" valor={contagem.verde} cor={gravidadeCor.VERDE.texto} fundo={gravidadeCor.VERDE.fundo} />
      </div>

      <div className="flex flex-col gap-3">
        {GRUPOS_CHECKLIST.map((grupo) => (
          <div key={grupo.titulo} className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--cor-texto-secundario)' }}>
              {grupo.titulo}
            </p>
            <div className={`grid grid-cols-1 gap-1.5 sm:grid-cols-2 ${compacto ? 'lg:grid-cols-2' : 'lg:grid-cols-4'}`}>
              {grupo.itens.map((chave) => {
                const it = porChave.get(chave)
                if (!it) return null
                return (
                  <Bloco
                    key={chave}
                    item={it}
                    label={LABEL_POR_CHAVE.get(chave) ?? chave}
                    compacto={compacto}
                    onSalvar={(a) => salvar(chave, a)}
                    onAbrirDetalhe={() => setDetalheAberto(chave)}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {detalheAberto && (
        <DetalheItemChecklist
          clienteId={clienteId}
          item={detalheAberto}
          label={LABEL_POR_CHAVE.get(detalheAberto) ?? detalheAberto}
          resumo={porChave.get(detalheAberto)?.resumo ?? ''}
          gravidade={porChave.get(detalheAberto)?.gravidade ?? 'VERDE'}
          aoFechar={() => setDetalheAberto(null)}
        />
      )}
    </div>
  )
}

function Bloco({
  item,
  label,
  compacto,
  onSalvar,
  onAbrirDetalhe,
}: {
  item: ItemChecklistView
  label: string
  compacto: boolean
  onSalvar: (a: { parecer?: string; gravidade?: Gravidade; gravidadeManual?: boolean }) => void
  onAbrirDetalhe: () => void
}) {
  const podeEditar = useSessao().pode('analista')
  const cor = gravidadeCor[item.gravidade]
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrirDetalhe}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onAbrirDetalhe()}
      title="Clique para ver o detalhe completo"
      className="flex cursor-pointer flex-col gap-1 p-2 transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)]"
      style={{ backgroundColor: cor.fundo }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-bold uppercase tracking-tight" style={{ color: cor.texto }}>
          {label}
        </p>
        <div onClick={(e) => e.stopPropagation()}>
          <SeletorGravidade gravidade={item.gravidade} onChange={(g) => onSalvar({ gravidade: g, gravidadeManual: true })} />
        </div>
      </div>
      {item.dado && <Widget dado={item.dado} />}
      <p className="text-[11.5px] leading-snug" style={{ color: 'var(--cor-texto-primario)' }}>
        {item.resumo}
      </p>
      <textarea
        readOnly={!podeEditar}
        defaultValue={item.parecer}
        onBlur={(e) => onSalvar({ parecer: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        placeholder="Parecer do executivo…"
        rows={compacto ? 1 : 2}
        className="mt-0.5 w-full border-0 bg-[var(--cor-superficie-solida)]/70 px-1.5 py-1 text-[12px]"
        style={{ outlineColor: cor.texto }}
      />
      {item.atualizadoEm && (
        <p className="text-[10px] opacity-70" style={{ color: cor.texto }}>
          {item.atualizadoPor} {item.gravidadeManual && '· ajustado manualmente'}
        </p>
      )}
    </div>
  )
}
