import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KpiCard, Painel } from '../components/ui/Card'
import { StatusPlanoBadge } from '../components/ui/Badges'
import { BotaoExportar } from '../components/arquivos/BotaoExportar'
import ModalAndamentoPlano from '../components/comite/ModalAndamentoPlano'
import { useSessao } from '../contexts/SessaoContext'
import { useFiltros } from '../contexts/FiltrosContext'
import type { Cliente, PlanoAcao } from '../models/types'
import { clienteRepository, planoAcaoRepository } from '../repositories'
import { formatarData } from '../utils/formatters'

type FiltroStatus = 'TODOS' | 'ATRASADO' | 'EM_DIA' | 'CONCLUIDO'

export default function PlanosDeAcao() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const navigate = useNavigate()
  const [planos, setPlanos] = useState<PlanoAcao[]>([])
  const [clientesPorId, setClientesPorId] = useState<Map<string, Cliente>>(new Map())
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('TODOS')
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState<PlanoAcao | null>(null)
  const podeEditar = useSessao().pode('analista')

  useEffect(() => {
    if (carregandoFiltros) return
    let ativo = true
    setCarregando(true)
    Promise.all([clienteRepository.listarEnriquecidos(filtros), planoAcaoRepository.listarTodos()]).then(([clientes, todosPlanos]) => {
      if (!ativo) return
      const idsPermitidos = new Set(clientes.map((c) => c.id))
      setPlanos(todosPlanos.filter((p) => idsPermitidos.has(p.clienteId)))
      setClientesPorId(new Map(clientes.map((c) => [c.id, c])))
      setCarregando(false)
    })
    return () => {
      ativo = false
    }
  }, [filtros, carregandoFiltros])

  const planosFiltrados = useMemo(() => (filtroStatus === 'TODOS' ? planos : planos.filter((p) => p.status === filtroStatus)), [planos, filtroStatus])
  const planosOrdenados = useMemo(() => [...planosFiltrados].sort((a, b) => a.dataLimite.localeCompare(b.dataLimite)), [planosFiltrados])

  const qtdAtrasados = planos.filter((p) => p.status === 'ATRASADO').length
  const qtdEmDia = planos.filter((p) => p.status === 'EM_DIA').length
  const qtdConcluidos = planos.filter((p) => p.status === 'CONCLUIDO').length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            Planos de Ação
          </h1>
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            Acompanhamento dos compromissos assumidos pelos clientes em Monitoramento, Saída de Risco e Jurídico. Prazo vencido sem conclusão vira
            atrasado automaticamente e entra na pauta do próximo comitê.
          </p>
        </div>
        <BotaoExportar chave="planos-de-acao" filtros={filtros} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard titulo="Total de planos" valor={String(planos.length)} formatoVariacao="numero" onClick={() => setFiltroStatus('TODOS')} />
        <KpiCard titulo="Atrasados" valor={String(qtdAtrasados)} formatoVariacao="numero" destaque="critico" onClick={() => setFiltroStatus('ATRASADO')} />
        <KpiCard titulo="Em dia" valor={String(qtdEmDia)} formatoVariacao="numero" destaque="atencao" onClick={() => setFiltroStatus('EM_DIA')} />
        <KpiCard titulo="Concluídos" valor={String(qtdConcluidos)} formatoVariacao="numero" destaque="normal" onClick={() => setFiltroStatus('CONCLUIDO')} />
      </div>

      <Painel>
        {carregando ? (
          <p className="p-6 text-sm text-gray-500">Carregando…</p>
        ) : planosOrdenados.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">Nenhum plano de ação para este recorte.</p>
        ) : (
          <div className="overflow-x-auto border bg-[var(--cor-superficie-solida)]" style={{ borderColor: 'var(--cor-borda)' }}>
            <table className="w-full text-sm">
              <thead className="border-b text-[12.5px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
                <tr>
                  <th className="px-4 py-2.5 text-left">Cliente</th>
                  <th className="px-4 py-2.5 text-left">Decisão atual</th>
                  <th className="px-4 py-2.5 text-left">Plano</th>
                  <th className="px-4 py-2.5 text-left">Responsável</th>
                  <th className="px-4 py-2.5 text-left">Prazo</th>
                  <th className="px-4 py-2.5 text-left">Andamento</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  {podeEditar && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {planosOrdenados.map((p) => {
                  const cliente = clientesPorId.get(p.clienteId)
                  return (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-t hover:bg-[var(--cor-fundo-recuado)]"
                      style={{ borderColor: 'var(--cor-borda)', backgroundColor: p.status === 'ATRASADO' ? 'var(--cor-critico-fundo)' : undefined }}
                      onClick={() => navigate(`/clientes/${p.clienteId}`)}
                    >
                      <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--cor-primaria)' }}>
                        {cliente?.nome ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">{p.decisaoAtual}</td>
                      <td className="max-w-xs px-4 py-2.5 text-xs text-gray-600">{p.plano}</td>
                      <td className="px-4 py-2.5">{p.responsavel}</td>
                      <td className="px-4 py-2.5">{formatarData(p.dataLimite)}</td>
                      <td className="max-w-xs px-4 py-2.5 text-xs">
                        {p.oQueFoiFeito && <p style={{ color: 'var(--cor-normal)' }}>Feito: {p.oQueFoiFeito}</p>}
                        {p.oQueNaoFoiFeito && <p style={{ color: 'var(--cor-critico)' }}>Não feito: {p.oQueNaoFoiFeito}</p>}
                        {!p.oQueFoiFeito && !p.oQueNaoFoiFeito && <span style={{ color: 'var(--cor-texto-secundario)' }}>—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPlanoBadge status={p.status} />
                      </td>
                      {podeEditar && (
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            className="botao-secundario whitespace-nowrap px-2.5 py-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditando(p)
                            }}
                          >
                            Andamento
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Painel>
      {editando && (
        <ModalAndamentoPlano
          plano={editando}
          nomeCliente={clientesPorId.get(editando.clienteId)?.nome}
          aoFechar={(atualizado) => {
            setEditando(null)
            if (atualizado) setPlanos((lista) => lista.map((x) => (x.id === atualizado.id ? atualizado : x)))
          }}
        />
      )}
    </div>
  )
}
