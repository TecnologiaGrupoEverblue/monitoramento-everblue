import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClienteEnriquecido } from '../../models/types'
import { cadastrosRepository, clienteRepository, snapshotRepository } from '../../repositories'
import { formatarMoeda, formatarPercentual } from '../../utils/formatters'
import { CriticidadeBadge, StatusBadge } from './Badges'

export default function DrillDownModal({ titulo, clienteIds, aoFechar }: { titulo: string; clienteIds: string[]; aoFechar: () => void }) {
  const [clientes, setClientes] = useState<ClienteEnriquecido[] | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let ativo = true
    async function carregar() {
      const [todos, grupos, gerentes, plataformas, semanaRef] = await Promise.all([
        clienteRepository.listarTodos(),
        cadastrosRepository.mapaGrupos(),
        cadastrosRepository.mapaGerentes(),
        cadastrosRepository.mapaPlataformas(),
        snapshotRepository.ultimaSemanaDisponivel(),
      ])
      const idsSet = new Set(clienteIds)
      const selecionados = todos.filter((c) => idsSet.has(c.id))
      const resultado: ClienteEnriquecido[] = []
      for (const cliente of selecionados) {
        const snapshotAtual = semanaRef ? await snapshotRepository.porClienteESemana(cliente.id, semanaRef) : null
        resultado.push({
          ...cliente,
          grupoEconomico: grupos.get(cliente.grupoEconomicoId)!,
          gerente: gerentes.get(cliente.gerenteId)!,
          plataforma: plataformas.get(cliente.plataformaId)!,
          snapshotAtual,
          snapshotAnterior: null,
          alertasAbertos: [],
          planosPendentes: [],
        })
      }
      if (ativo) setClientes(resultado.sort((a, b) => (b.snapshotAtual?.riscoCliente ?? 0) - (a.snapshotAtual?.riscoCliente ?? 0)))
    }
    carregar()
    return () => {
      ativo = false
    }
  }, [clienteIds])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={aoFechar}>
      <div className="flex max-h-[80vh] w-full max-w-4xl flex-col border bg-[var(--cor-superficie-solida)]" style={{ borderColor: 'var(--cor-borda-forte)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--cor-borda)' }}>
          <div>
            <h2 className="fonte-editorial text-lg font-semibold" style={{ color: 'var(--cor-primaria)' }}>
              {titulo}
            </h2>
            <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              {clienteIds.length} cliente(s)
            </p>
          </div>
          <button onClick={aoFechar} className="px-2 py-1 text-sm hover:bg-[var(--cor-fundo-recuado)]" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 border-b bg-[var(--cor-superficie-solida)] text-[12.5px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
              <tr>
                <th className="px-4 py-2 text-left">Cliente</th>
                <th className="px-4 py-2 text-left">Grupo</th>
                <th className="px-4 py-2 text-left">Gerente</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Criticidade</th>
                <th className="px-4 py-2 text-right">Risco</th>
                <th className="px-4 py-2 text-right">% Vencido</th>
              </tr>
            </thead>
            <tbody>
              {clientes === null && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-gray-500">
                    Carregando…
                  </td>
                </tr>
              )}
              {clientes?.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-gray-500">
                    Nenhum cliente encontrado para este recorte.
                  </td>
                </tr>
              )}
              {clientes?.map((c) => {
                const risco = c.snapshotAtual?.riscoCliente ?? 0
                const percVencido = c.snapshotAtual && c.snapshotAtual.riscoCliente > 0 ? (c.snapshotAtual.vencidoOficial / c.snapshotAtual.riscoCliente) * 100 : 0
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-t hover:bg-[var(--cor-fundo-recuado)]"
                    style={{ borderColor: 'var(--cor-borda)' }}
                    onClick={() => {
                      navigate(`/clientes/${c.id}`)
                      aoFechar()
                    }}
                  >
                    <td className="px-4 py-2 font-medium">{c.nome}</td>
                    <td className="px-4 py-2" style={{ color: 'var(--cor-texto-secundario)' }}>{c.grupoEconomico?.nome}</td>
                    <td className="px-4 py-2" style={{ color: 'var(--cor-texto-secundario)' }}>{c.gerente?.nome}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-2">
                      <CriticidadeBadge criticidade={c.criticidade} />
                    </td>
                    <td className="numeros-tabulares px-4 py-2 text-right font-medium">{formatarMoeda(risco)}</td>
                    <td className="numeros-tabulares px-4 py-2 text-right">{formatarPercentual(percVencido)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
