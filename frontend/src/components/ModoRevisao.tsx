import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { esquemaDecisaoComite, formatarDocumento } from '@monitoramento/dominio'
import { ErroApi } from '../api/cliente'
import { Portal } from './ui/Portal'
import { consultas, invalidar } from '../consultas'
import { useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Alerta, ClienteEnriquecido, PlanoAcao, SnapshotSemanal } from '../models/types'
import { comiteAtaRepository, semanaMesAnteriorRef } from '../repositories'
import { diasEntre, formatarData, formatarDias, formatarMoeda, formatarPercentual, formatarPercentualOpcional, STATUS_LABEL } from '../utils/formatters'
import ChecklistAnalise from './ChecklistAnalise'
import PainelTransacional from './PainelTransacional'
import { CriticidadeBadge, GravidadeBadge, PrioridadeBadge } from './ui/Badges'

const esquemaFormDecisao = esquemaDecisaoComite.omit({ clienteId: true })
type FormDecisao = z.input<typeof esquemaFormDecisao>
type DecisaoValidada = z.output<typeof esquemaFormDecisao>

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
  const [qtdRegistradas, setQtdRegistradas] = useState(0)
  const [concluido, setConcluido] = useState(false)
  const clienteConsultas = useQueryClient()

  const cliente = clientes[indice]
  const ultimo = indice === clientes.length - 1
  const cid = cliente?.id ?? ''

  // Dados do caso: semana do mês anterior, último plano, entrada no status e série.
  const semanasQ = useQuery(consultas.semanas())
  const semanas = semanasQ.data
  const semanaAtualRef = cliente?.snapshotAtual?.semanaRef ?? semanas?.[semanas.length - 1]
  const semanaMes = semanas && semanaAtualRef ? semanaMesAnteriorRef(semanas, semanaAtualRef) : null
  const mesAnteriorQ = useQuery({ ...consultas.snapshotClienteSemana(cid, semanaMes ?? ''), enabled: Boolean(cliente && semanaMes) })
  const [planosQ, eventosQ, serieQ] = useQueries({
    queries: [
      { ...consultas.planosCliente(cid), enabled: Boolean(cliente) },
      { ...consultas.eventosCliente(cid), enabled: Boolean(cliente) },
      { ...consultas.snapshotsCliente(cid), enabled: Boolean(cliente) },
    ],
  })
  const dadosCaso = useMemo<DadosCaso | null>(() => {
    if (!cliente || !semanas || !planosQ.data || !eventosQ.data || !serieQ.data) return null
    if (semanaMes && mesAnteriorQ.isPending) return null
    return {
      snapshotMesAnterior: mesAnteriorQ.data ?? null,
      ultimoPlano: [...planosQ.data].sort((a, b) => b.dataDecisaoAtual.localeCompare(a.dataDecisaoAtual))[0] ?? null,
      dataEntradaStatus: eventosQ.data.find((e) => e.tipo === 'MUDANCA_STATUS' && e.valorNovo === cliente.status)?.data ?? null,
      alertas: cliente.alertasAbertos,
      serieHistorica: serieQ.data,
    }
  }, [cliente, semanas, semanaMes, mesAnteriorQ.isPending, mesAnteriorQ.data, planosQ.data, eventosQ.data, serieQ.data])

  // Decisão do caso: mesmas regras da API (dominio/esquemas); limpa a cada caso.
  const { register, handleSubmit, reset, control, formState } = useForm<FormDecisao, unknown, DecisaoValidada>({
    resolver: zodResolver(esquemaFormDecisao),
    defaultValues: { decisao: '', plano: '', responsavel: cliente?.responsavel ?? '', prazo: comiteAtaRepository.sugerirPrazo() },
  })
  useEffect(() => {
    reset({ decisao: '', plano: '', responsavel: cliente?.responsavel ?? '', prazo: comiteAtaRepository.sugerirPrazo() })
  }, [cliente, reset])

  const [decisaoDigitada, responsavelDigitado] = useWatch({ control, name: ['decisao', 'responsavel'] })

  const registrar = useMutation({
    // Plano de ação e evento histórico são gravados juntos, no servidor,
    // vinculados ao comitê planejado; quem registrou é a pessoa da sessão.
    mutationFn: (d: DecisaoValidada) => comiteAtaRepository.registrarDecisao({ clienteId: cid, ...d, responsavel: d.responsavel || cliente!.responsavel }),
    onSuccess: () => {
      void invalidar(clienteConsultas, 'carteira')
      setQtdRegistradas((n) => n + 1)
      avancar()
    },
  })
  const salvando = registrar.isPending
  const erroDecisao =
    formState.errors.decisao?.message ??
    formState.errors.prazo?.message ??
    formState.errors.plano?.message ??
    formState.errors.responsavel?.message ??
    (registrar.error ? (registrar.error instanceof ErroApi ? registrar.error.message : 'Não foi possível registrar a decisão.') : null)

  if (!cliente) return null

  const atual = cliente.snapshotAtual
  const anterior = cliente.snapshotAnterior
  const percVencido = atual && atual.riscoCliente > 0 ? (atual.vencidoOficial / atual.riscoCliente) * 100 : 0
  const varSemana = variacaoPerc(atual?.riscoCliente, anterior?.riscoCliente)
  const varMes = variacaoPerc(atual?.riscoCliente, dadosCaso?.snapshotMesAnterior?.riscoCliente)
  const diasNoStatus = dadosCaso?.dataEntradaStatus ? diasEntre(dadosCaso.dataEntradaStatus) : null

  function salvarERir() {
    // Sem decisão digitada: só avança (o caso fica sem registro).
    if (!decisaoDigitada.trim()) {
      avancar()
      return
    }
    void handleSubmit((d) => registrar.mutate(d))()
  }

  function avancar() {
    registrar.reset()
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
      <Portal>
      <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" style={{ backgroundColor: 'var(--cor-primaria-escura)' }}>
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
      </Portal>
    )
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-[55] flex flex-col" style={{ backgroundColor: 'var(--cor-fundo)' }}>
      <div className="flex items-center justify-between gap-3 border-b bg-[var(--cor-superficie-solida)] px-4 py-3 sm:px-6" style={{ borderColor: 'var(--cor-borda-forte)' }}>
        <div className="min-w-0">
          <p className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
            Modo de Revisão · {STATUS_LABEL[statusAtual] ?? statusAtual} · Caso {indice + 1} de {clientes.length}
          </p>
          <p className="fonte-editorial truncate text-base font-semibold sm:text-lg" style={{ color: 'var(--cor-primaria)' }} title={cliente.nome}>
            {cliente.nome}
          </p>
        </div>
        <button onClick={() => aoFechar(qtdRegistradas > 0)} className="min-h-[44px] shrink-0 whitespace-nowrap px-3 text-sm hover:bg-[var(--cor-fundo-recuado)]">
          Encerrar <span className="hidden sm:inline">revisão</span> ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <CriticidadeBadge criticidade={cliente.criticidade} />
            <PrioridadeBadge prioridade={cliente.prioridade} />
            <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              {formatarDocumento(cliente.cnpj)} · {cliente.grupoEconomico?.nome} · {cliente.gerente?.nome} · {cliente.plataforma?.nome}
            </span>
          </div>

          <div className="border bg-[var(--cor-superficie-solida)] p-3 sm:p-4" style={{ borderColor: 'var(--cor-borda)' }}>
            <p className="mb-3 border-b pb-2 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda)' }}>
              Checklist de Análise Semanal — roteiro do comitê para este caso
            </p>
            <ChecklistAnalise clienteId={cliente.id} semanaRef={atual?.semanaRef ?? null} usuario={responsavelDigitado || cliente.responsavel} />
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
              <Fato titulo="IL 30 / 90 dias" valor={`${formatarPercentualOpcional(atual?.il30)} / ${formatarPercentualOpcional(atual?.il90)}`} />
              <Fato titulo="Aging da carteira" valor={atual ? formatarDias(atual.agingCarteiraDias) : '—'} />
              <Fato titulo="Atraso médio" valor={atual && atual.atrasoMedioDias !== null ? formatarDias(atual.atrasoMedioDias) : 'Não informado'} />
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
                <p className="text-xs text-[color:var(--cor-texto-secundario)]">Nenhum alerta em aberto.</p>
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
                <p className="text-xs text-[color:var(--cor-texto-secundario)]">Nenhuma decisão anterior registrada.</p>
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
                  {...register('decisao')}
                  maxLength={2000}
                  aria-invalid={Boolean(formState.errors.decisao)}
                  rows={3}
                  placeholder="Ex.: Manter em monitoramento com revisão quinzenal…"
                  className="border px-2 py-1.5 text-sm"
                  style={{ borderColor: 'var(--cor-borda)' }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Plano de ação
                <textarea
                  {...register('plano')}
                  maxLength={4000}
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
                <input {...register('responsavel')} maxLength={200} className="border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--cor-borda)' }} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Prazo
                <input type="date" {...register('prazo')} aria-invalid={Boolean(formState.errors.prazo)} className="border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--cor-borda)' }} />
              </label>
            </div>
            {erroDecisao && (
              <p role="alert" className="mt-3 border-l-2 p-2 text-xs" style={{ borderColor: 'var(--cor-critico)', backgroundColor: 'var(--cor-critico-fundo)', color: 'var(--cor-critico)' }}>
                {erroDecisao}
              </p>
            )}
            <p className="mt-3 text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
              Ao salvar, a decisão vira um Plano de Ação vinculado ao próximo Comitê e passa a compor a Ata quando ela for gerada.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t bg-[var(--cor-superficie-solida)] px-3 py-3 sm:px-6" style={{ borderColor: 'var(--cor-borda-forte)' }}>
        <button onClick={voltar} disabled={indice === 0} aria-label="Caso anterior" className="min-h-[44px] shrink-0 border px-3 text-sm disabled:opacity-30 sm:px-4" style={{ borderColor: 'var(--cor-borda-forte)' }}>
          ← <span className="hidden sm:inline">Caso anterior</span>
        </button>
        <div className="flex min-w-0 gap-2">
          <button onClick={avancar} className="min-h-[44px] px-2 text-sm sm:px-4" style={{ color: 'var(--cor-texto-secundario)' }}>
            Pular<span className="hidden sm:inline"> sem registrar</span>
          </button>
          <button
            onClick={salvarERir}
            disabled={salvando}
            className="min-h-[44px] px-4 text-sm font-medium text-white disabled:opacity-60 sm:px-5"
            style={{ backgroundColor: 'var(--cor-acao)' }}
          >
            {salvando ? 'Salvando…' : ultimo ? 'Salvar e concluir' : 'Salvar e avançar →'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
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
