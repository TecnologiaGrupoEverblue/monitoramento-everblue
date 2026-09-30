import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Alerta, ClienteEnriquecido, PlanoAcao, SnapshotSemanal } from '../models/types'
import {
  comiteAtaRepository,
  eventoRepository,
  planoAcaoRepository,
  semanaMesAnteriorRef,
  snapshotRepository,
} from '../repositories'
import { diasEntre, formatarData, formatarMoeda, formatarPercentual, STATUS_LABEL } from '../utils/formatters'
import ChecklistAnalise from './ChecklistAnalise'
import PainelTransacional from './PainelTransacional'
import { CriticidadeBadge, GravidadeBadge, PrioridadeBadge } from './ui/Badges'

interface DadosCaso {
  snapshotMesAnterior: SnapshotSemanal | null
  ultimoPlano: PlanoAcao | null
  dataEntradaStatus: string | null
  alertas: Alerta[]
  serieHistorica: SnapshotSemanal[]
}

function variacaoPerc(atual?: number, base?: number | null): number | null {
  if (atual === undefined || !base) return null
  return ((atual - base) / base) * 100
}

export default function ModoRevisao({
  clientes,
  statusAtual,
  aoFechar,
}: {
  clientes: ClienteEnriquecido[]
  statusAtual: string
  aoFechar: (houveDecisoes: boolean) => void
}) {
  const navigate = useNavigate()
  const [indice, setIndice] = useState(0)
  const [dadosCaso, setDadosCaso] = useState<DadosCaso | null>(null)
  const [decisao, setDecisao] = useState('')
  const [plano, setPlano] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [prazo, setPrazo] = useState(comiteAtaRepository.sugerirPrazo())
  const [salvando, setSalvando] = useState(false)
  const [qtdRegistradas, setQtdRegistradas] = useState(0)
  const [concluido, setConcluido] = useState(false)

  const cliente = clientes[indice]
  const ultimo = indice === clientes.length - 1

  useEffect(() => {
    if (!cliente) return
    let ativo = true
    setDadosCaso(null)
    setDecisao('')
    setPlano('')
    setResponsavel(cliente.responsavel)
    setPrazo(comiteAtaRepository.sugerirPrazo())

    async function carregar() {
      const semanas = await snapshotRepository.listarSemanasDisponiveis()
      const semanaAtualRef = cliente.snapshotAtual?.semanaRef ?? semanas[semanas.length - 1]
      const semanaMes = semanaMesAnteriorRef(semanas, semanaAtualRef)
      const [snapshotMesAnterior, planosDoCliente, eventosDoCliente, serieHistorica] = await Promise.all([
        semanaMes ? snapshotRepository.porClienteESemana(cliente.id, semanaMes) : Promise.resolve(null),
        planoAcaoRepository.porCliente(cliente.id),
        eventoRepository.porCliente(cliente.id),
        snapshotRepository.porCliente(cliente.id),
      ])
      const ultimoPlano = [...planosDoCliente].sort((a, b) => b.dataDecisaoAtual.localeCompare(a.dataDecisaoAtual))[0] ?? null
      const entradaStatus = eventosDoCliente.find((e) => e.tipo === 'MUDANCA_STATUS' && e.valorNovo === cliente.status)?.data ?? null
      if (!ativo) return
      setDadosCaso({ snapshotMesAnterior, ultimoPlano, dataEntradaStatus: entradaStatus, alertas: cliente.alertasAbertos, serieHistorica })
    }
    carregar()
    return () => {
      ativo = false
    }
  }, [cliente])

  if (!cliente) return null

  const atual = cliente.snapshotAtual
  const anterior = cliente.snapshotAnterior
  const percVencido = atual && atual.riscoCliente > 0 ? (atual.vencidoOficial / atual.riscoCliente) * 100 : 0
  const varSemana = variacaoPerc(atual?.riscoCliente, anterior?.riscoCliente)
  const varMes = variacaoPerc(atual?.riscoCliente, dadosCaso?.snapshotMesAnterior?.riscoCliente)
  const diasNoStatus = dadosCaso?.dataEntradaStatus ? diasEntre(dadosCaso.dataEntradaStatus) : null

  async function salvarERir() {
    if (!decisao.trim()) {
      await avancar()
      return
    }
    setSalvando(true)
    try {
      // Plano de ação e evento histórico são gravados juntos, no servidor,
      // vinculados ao comitê planejado; quem registrou é a pessoa da sessão.
      await comiteAtaRepository.registrarDecisao({
        clienteId: cliente.id,
        decisao: decisao.trim(),
        plano: plano.trim(),
        prazo,
        responsavel: responsavel.trim() || cliente.responsavel,
      })
    } finally {
      setSalvando(false)
    }
    setQtdRegistradas((n) => n + 1)
    await avancar()
  }

  async function avancar() {
    if (ultimo) {
      setConcluido(true)
    } else {
      setIndice((i) => i + 1)
    }
  }

  function voltar() {
    if (indice > 0) setIndice((i) => i - 1)
  }

  if (concluido) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'var(--cor-primaria-escura)' }}>
        <div className="w-full max-w-md border bg-[var(--cor-superficie-solida)] p-6 text-center" style={{ borderColor: 'var(--cor-borda-forte)' }}>
          <p className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            Revisão concluída
          </p>
          <p className="mt-2 text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            {qtdRegistradas} decisão(ões) registrada(s). Elas já aparecem no Plano de Ação e ficam vinculadas ao próximo Comitê para compor a ata.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button onClick={() => aoFechar(qtdRegistradas > 0)} className="border px-4 py-2 text-sm" style={{ borderColor: 'var(--cor-borda-forte)' }}>
              Fechar
            </button>
            <button
              onClick={() => navigate('/planos-de-acao')}
              className="px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: 'var(--cor-acao)' }}
            >
              Ver Planos de Ação
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--cor-fundo)' }}>
      <div className="flex items-center justify-between border-b bg-[var(--cor-superficie-solida)] px-6 py-3" style={{ borderColor: 'var(--cor-borda-forte)' }}>
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
            Modo de Revisão · {STATUS_LABEL[statusAtual] ?? statusAtual} · Caso {indice + 1} de {clientes.length}
          </p>
          <p className="fonte-editorial text-lg font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            {cliente.nome}
          </p>
        </div>
        <button onClick={() => aoFechar(qtdRegistradas > 0)} className="px-3 py-1.5 text-sm hover:bg-[var(--cor-fundo-recuado)]">
          Encerrar revisão ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <CriticidadeBadge criticidade={cliente.criticidade} />
            <PrioridadeBadge prioridade={cliente.prioridade} />
            <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              {cliente.grupoEconomico?.nome} · {cliente.gerente?.nome} · {cliente.plataforma?.nome}
            </span>
          </div>

          <div className="border bg-[var(--cor-superficie-solida)] p-4" style={{ borderColor: 'var(--cor-borda)' }}>
            <p className="mb-3 border-b pb-2 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
              Checklist de Análise Semanal — roteiro do comitê para este caso
            </p>
            <ChecklistAnalise clienteId={cliente.id} semanaRef={atual?.semanaRef ?? null} usuario={responsavel || cliente.responsavel} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="border bg-[var(--cor-superficie-solida)] p-4 lg:col-span-1" style={{ borderColor: 'var(--cor-borda)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
                Risco atual
              </p>
              <p className="fonte-editorial numeros-tabulares text-3xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
                {formatarMoeda(atual?.riscoCliente ?? 0)}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span style={{ color: varSemana !== null && varSemana >= 0 ? 'var(--cor-critico)' : 'var(--cor-normal)' }}>
                  {varSemana !== null ? `${varSemana >= 0 ? '+' : ''}${varSemana.toFixed(1)}% desde a semana anterior` : 'Sem semana anterior'}
                </span>
                <span style={{ color: varMes !== null && varMes >= 0 ? 'var(--cor-critico)' : 'var(--cor-normal)' }}>
                  {varMes !== null ? `${varMes >= 0 ? '+' : ''}${varMes.toFixed(1)}% desde o mês anterior` : 'Sem posição do mês anterior'}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                {diasNoStatus !== null
                  ? `Há ${diasNoStatus < 7 ? `${diasNoStatus} dia(s)` : `${Math.floor(diasNoStatus / 7)} semana(s)`} em ${STATUS_LABEL[cliente.status]}`
                  : `Data de entrada em ${STATUS_LABEL[cliente.status]} não registrada`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 border bg-[var(--cor-superficie-solida)] p-4 text-sm lg:col-span-2" style={{ borderColor: 'var(--cor-borda)' }}>
              <Fato titulo="Vencido oficial" valor={formatarMoeda(atual?.vencidoOficial ?? 0)} />
              <Fato titulo="% Vencido" valor={formatarPercentual(percVencido)} />
              <Fato titulo="IL 30 / 90 dias" valor={`${formatarPercentual(atual?.il30 ?? 0)} / ${formatarPercentual(atual?.il90 ?? 0)}`} />
              <Fato titulo="Aging da carteira" valor={`${atual?.agingCarteiraDias ?? 0} dias`} />
              <Fato titulo="Atraso médio" valor={`${atual?.atrasoMedioDias ?? 0} dias`} />
              <Fato titulo="Restritivos" valor={String(atual?.restritivos ?? 0)} />
            </div>
          </div>

          <div className="border bg-[var(--cor-superficie-solida)] p-4" style={{ borderColor: 'var(--cor-borda)' }}>
            <p className="mb-2 border-b pb-1.5 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
              Evolução do risco x vencido
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={(dadosCaso?.serieHistorica ?? []).map((s) => ({ semana: s.semanaRef, risco: s.riscoCliente, vencido: s.vencidoOficial }))} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
                <XAxis dataKey="semana" tickFormatter={(v) => formatarData(String(v))} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatarMoeda(Number(v))} width={90} />
                <Tooltip labelFormatter={(v) => formatarData(String(v))} formatter={(v) => formatarMoeda(Number(v))} />
                <Line type="monotone" dataKey="risco" stroke="var(--cor-primaria)" strokeWidth={2.5} dot={false} name="Risco" />
                <Line type="monotone" dataKey="vencido" stroke="var(--cor-critico)" strokeWidth={2.5} dot={false} name="Vencido" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <PainelTransacional clienteId={cliente.id} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="border bg-[var(--cor-superficie-solida)] p-4" style={{ borderColor: 'var(--cor-borda)' }}>
              <p className="mb-2 border-b pb-1.5 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
                Alertas abertos ({dadosCaso?.alertas.length ?? 0})
              </p>
              {!dadosCaso || dadosCaso.alertas.length === 0 ? (
                <p className="text-xs text-gray-400">Nenhum alerta em aberto.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {dadosCaso.alertas.slice(0, 4).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                      <span>{a.tipo}</span>
                      <GravidadeBadge gravidade={a.gravidade} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border bg-[var(--cor-superficie-solida)] p-4 text-sm" style={{ borderColor: 'var(--cor-borda)' }}>
              <p className="mb-1 border-b pb-1.5 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
                Última decisão registrada
              </p>
              {dadosCaso?.ultimoPlano ? (
                <>
                  <p>{dadosCaso.ultimoPlano.decisaoAtual}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                    {formatarData(dadosCaso.ultimoPlano.dataDecisaoAtual)} · Prazo: {formatarData(dadosCaso.ultimoPlano.dataLimite)} · {dadosCaso.ultimoPlano.responsavel}
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-400">Nenhuma decisão anterior registrada.</p>
              )}
            </div>
          </div>

          <div className="border bg-[var(--cor-superficie-solida)] p-4" style={{ borderColor: 'var(--cor-borda)' }}>
            <p className="mb-3 border-b pb-1.5 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
              Registrar decisão deste comitê
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Nova decisão
                <textarea
                  value={decisao}
                  onChange={(e) => setDecisao(e.target.value)}
                  rows={3}
                  placeholder="Ex.: Manter em monitoramento com revisão quinzenal…"
                  className="border px-2 py-1.5 text-sm"
                  style={{ borderColor: 'var(--cor-borda)' }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Plano de ação
                <textarea
                  value={plano}
                  onChange={(e) => setPlano(e.target.value)}
                  rows={3}
                  placeholder="O que o cliente precisa fazer e até quando…"
                  className="border px-2 py-1.5 text-sm"
                  style={{ borderColor: 'var(--cor-borda)' }}
                />
              </label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:w-1/2">
              <label className="flex flex-col gap-1 text-sm">
                Responsável
                <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--cor-borda)' }} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Prazo
                <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className="border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--cor-borda)' }} />
              </label>
            </div>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
              Ao salvar, a decisão vira um Plano de Ação vinculado ao próximo Comitê e passa a compor a Ata quando ela for gerada.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t bg-[var(--cor-superficie-solida)] px-6 py-3" style={{ borderColor: 'var(--cor-borda-forte)' }}>
        <button onClick={voltar} disabled={indice === 0} className="border px-4 py-2 text-sm disabled:opacity-30" style={{ borderColor: 'var(--cor-borda-forte)' }}>
          ← Caso anterior
        </button>
        <div className="flex gap-2">
          <button onClick={avancar} className="px-4 py-2 text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            Pular sem registrar
          </button>
          <button
            onClick={salvarERir}
            disabled={salvando}
            className="px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--cor-acao)' }}
          >
            {ultimo ? 'Salvar e concluir revisão' : 'Salvar e avançar →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Fato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        {titulo}
      </p>
      <p className="numeros-tabulares font-medium">{valor}</p>
    </div>
  )
}
