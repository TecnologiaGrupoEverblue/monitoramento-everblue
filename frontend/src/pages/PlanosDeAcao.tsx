import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { TabelaResponsiva } from '../components/ui/TabelaResponsiva'
import { NomeCliente } from '../components/ui/NomeCliente'
import { KpiCard, Painel } from '../components/ui/Card'
import { StatusPlanoBadge } from '../components/ui/Badges'
import { BotaoExportar } from '../components/arquivos/BotaoExportar'
import ModalAndamentoPlano from '../components/comite/ModalAndamentoPlano'
import { useSessao } from '../contexts/SessaoContext'
import { useFiltros } from '../contexts/FiltrosContext'
import { Carregando, ErroCarga } from '../components/ui/EstadoCarga'
import { consultas } from '../consultas'
import type { PlanoAcao } from '../models/types'
import { formatarData } from '../utils/formatters'

type FiltroStatus = 'TODOS' | 'ATRASADO' | 'EM_DIA' | 'CONCLUIDO'

export default function PlanosDeAcao() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const navigate = useNavigate()
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('TODOS')
  const [editando, setEditando] = useState<PlanoAcao | null>(null)
  const podeEditar = useSessao().pode('analista')
  const qClientes = useQuery({ ...consultas.clientesEnriquecidos(filtros), enabled: !carregandoFiltros })
  const qPlanos = useQuery(consultas.planos())
  const clientesPorId = useMemo(() => new Map((qClientes.data ?? []).map((c) => [c.id, c])), [qClientes.data])
  const planos = useMemo(() => (qPlanos.data ?? []).filter((p) => clientesPorId.has(p.clienteId)), [qPlanos.data, clientesPorId])
  const carregando = qClientes.isPending || qPlanos.isPending
  const erro = qClientes.error ?? qPlanos.error

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
        {erro ? (
          <ErroCarga erro={erro} aoTentarDeNovo={() => void Promise.all([qClientes.refetch(), qPlanos.refetch()])} />
        ) : carregando ? (
          <Carregando />
        ) : planosOrdenados.length === 0 ? (
          <p className="py-10 text-center text-sm text-[color:var(--cor-texto-secundario)]">Nenhum plano de ação para este recorte.</p>
        ) : (
          <TabelaResponsiva<PlanoAcao>
            rotulo="Planos de ação"
            linhas={planosOrdenados}
            chave={(p) => p.id}
            aoClicar={(p) => navigate(`/clientes/${p.clienteId}`)}
            estiloLinha={(p) => (p.status === 'ATRASADO' ? { backgroundColor: 'var(--cor-critico-fundo)' } : undefined)}
            colunas={[
              { chave: 'cliente', titulo: 'Cliente', principal: true, classe: 'font-medium min-w-[160px]', render: (p) => <NomeCliente nome={clientesPorId.get(p.clienteId)?.nome} documento={clientesPorId.get(p.clienteId)?.cnpj} /> },
              { chave: 'status', titulo: 'Status', render: (p) => <StatusPlanoBadge status={p.status} /> },
              { chave: 'decisao', titulo: 'Decisão atual', classe: 'min-w-[160px]', render: (p) => p.decisaoAtual },
              { chave: 'plano', titulo: 'Plano', ocultar: 'xl', classe: 'max-w-xs text-xs', render: (p) => <span style={{ color: 'var(--cor-texto-secundario)' }}>{p.plano || '—'}</span> },
              { chave: 'responsavel', titulo: 'Responsável', render: (p) => p.responsavel || '—' },
              { chave: 'prazo', titulo: 'Prazo', classe: 'whitespace-nowrap', render: (p) => formatarData(p.dataLimite) },
              {
                chave: 'andamento',
                titulo: 'Andamento',
                ocultar: 'lg',
                classe: 'max-w-xs text-xs',
                render: (p) =>
                  p.oQueFoiFeito || p.oQueNaoFoiFeito ? (
                    <>
                      {p.oQueFoiFeito && <p style={{ color: 'var(--cor-normal)' }}>Feito: {p.oQueFoiFeito}</p>}
                      {p.oQueNaoFoiFeito && <p style={{ color: 'var(--cor-critico)' }}>Não feito: {p.oQueNaoFoiFeito}</p>}
                    </>
                  ) : (
                    <span style={{ color: 'var(--cor-texto-secundario)' }}>—</span>
                  ),
              },
              ...(podeEditar
                ? [
                    {
                      chave: 'acao',
                      titulo: 'Registrar andamento',
                      acao: true,
                      alinhar: 'right' as const,
                      render: (p: PlanoAcao) => (
                        <button type="button" className="botao-secundario min-h-[40px] whitespace-nowrap px-3 text-xs" onClick={() => setEditando(p)}>
                          Andamento
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Painel>
      {editando && (
        <ModalAndamentoPlano
          plano={editando}
          nomeCliente={clientesPorId.get(editando.clienteId)?.nome}
          aoFechar={() => setEditando(null)}
        />
      )}
    </div>
  )
}
