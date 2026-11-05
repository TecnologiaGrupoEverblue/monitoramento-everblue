import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FILTROS_VAZIOS } from '../../repositories'
import { consultas } from '../../consultas'
import { Portal } from './Portal'
import { TabelaResponsiva } from './TabelaResponsiva'
import { NomeCliente } from './NomeCliente'
import type { ClienteEnriquecido } from '../../models/types'
import { formatarMoeda, formatarPercentual } from '../../utils/formatters'
import { CriticidadeBadge, StatusBadge } from './Badges'

export default function DrillDownModal({ titulo, clienteIds, aoFechar }: { titulo: string; clienteIds: string[]; aoFechar: () => void }) {
  const navigate = useNavigate()
  // Uma chamada só (última semana com posição), em vez de uma por cliente.
  const q = useQuery(consultas.clientesEnriquecidos(FILTROS_VAZIOS))
  const clientes = useMemo(() => {
    if (!q.data) return null
    const ids = new Set(clienteIds)
    return q.data.filter((c) => ids.has(c.id)).sort((a, b) => (b.snapshotAtual?.riscoCliente ?? 0) - (a.snapshotAtual?.riscoCliente ?? 0))
  }, [q.data, clienteIds])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [aoFechar])

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={aoFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className="flex max-h-[92dvh] w-full max-w-4xl flex-col rounded-t-2xl border bg-[var(--cor-superficie-solida)] sm:rounded-2xl" style={{ borderColor: 'var(--cor-borda-forte)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--cor-borda)' }}>
          <div>
            <h2 className="fonte-editorial text-lg font-semibold" style={{ color: 'var(--cor-primaria)' }}>
              {titulo}
            </h2>
            <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              {clienteIds.length} cliente(s)
            </p>
          </div>
          <button onClick={aoFechar} className="flex h-11 w-11 items-center justify-center rounded-lg text-sm hover:bg-[var(--cor-fundo-recuado)]" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="overflow-auto p-3">
          {q.isError ? (
            <p className="p-6 text-center text-sm" role="alert" style={{ color: 'var(--cor-critico)' }}>
              Não foi possível carregar os clientes.{' '}
              <button type="button" className="underline" onClick={() => void q.refetch()}>
                Tentar de novo
              </button>
            </p>
          ) : clientes === null ? (
            <p className="p-6 text-center text-sm" role="status" style={{ color: 'var(--cor-texto-secundario)' }}>
              Carregando…
            </p>
          ) : (
            <TabelaResponsiva<ClienteEnriquecido>
              rotulo={titulo}
              linhas={clientes}
              chave={(c) => c.id}
              vazio="Nenhum cliente encontrado para este recorte."
              aoClicar={(c) => {
                navigate(`/clientes/${c.id}`)
                aoFechar()
              }}
              colunas={[
                { chave: 'cliente', titulo: 'Cliente', principal: true, classe: 'min-w-[170px]', render: (c) => <NomeCliente nome={c.nome} documento={c.cnpj} /> },
                { chave: 'grupo', titulo: 'Grupo', ocultar: 'lg', render: (c) => <span style={{ color: 'var(--cor-texto-secundario)' }}>{c.grupoEconomico?.nome}</span> },
                { chave: 'gerente', titulo: 'Gerente', render: (c) => <span style={{ color: 'var(--cor-texto-secundario)' }}>{c.gerente?.nome}</span> },
                { chave: 'status', titulo: 'Status', render: (c) => <StatusBadge status={c.status} /> },
                { chave: 'crit', titulo: 'Criticidade', render: (c) => <CriticidadeBadge criticidade={c.criticidade} /> },
                { chave: 'risco', titulo: 'Risco', alinhar: 'right', classe: 'numeros-tabulares whitespace-nowrap font-medium', render: (c) => formatarMoeda(c.snapshotAtual?.riscoCliente ?? 0) },
                {
                  chave: 'venc',
                  titulo: '% Vencido',
                  alinhar: 'right',
                  classe: 'numeros-tabulares',
                  render: (c) => formatarPercentual(c.snapshotAtual && c.snapshotAtual.riscoCliente > 0 ? (c.snapshotAtual.vencidoOficial / c.snapshotAtual.riscoCliente) * 100 : 0),
                },
              ]}
            />
          )}
        </div>
      </div>
    </div>
    </Portal>
  )
}
