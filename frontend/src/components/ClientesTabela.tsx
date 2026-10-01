import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClienteEnriquecido } from '../models/types'
import { formatarMoeda, formatarPercentual } from '../utils/formatters'
import { CriticidadeBadge, PrioridadeBadge, StatusBadge } from './ui/Badges'

export interface ColunaExtra {
  header: string
  render: (cliente: ClienteEnriquecido) => ReactNode
  alinhamento?: 'left' | 'right'
}

export default function ClientesTabela({
  clientes,
  colunasExtras = [],
  mostrarStatus = true,
}: {
  clientes: ClienteEnriquecido[]
  colunasExtras?: ColunaExtra[]
  mostrarStatus?: boolean
}) {
  const navigate = useNavigate()

  if (clientes.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">Nenhum cliente encontrado para os filtros selecionados.</p>
  }

  return (
    <div className="overflow-x-auto border bg-[var(--cor-superficie-solida)]" style={{ borderColor: 'var(--cor-borda)' }}>
      <table className="w-full text-[13px]">
        <thead className="border-b text-[12.5px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
          <tr>
            <th className="px-4 py-2.5 text-left">Cliente</th>
            <th className="px-4 py-2.5 text-left">Grupo econômico</th>
            <th className="px-4 py-2.5 text-left">Gerente</th>
            <th className="px-4 py-2.5 text-left">Plataforma</th>
            {mostrarStatus && <th className="px-4 py-2.5 text-left">Status</th>}
            <th className="px-4 py-2.5 text-left">Criticidade</th>
            <th className="px-4 py-2.5 text-left">Prioridade</th>
            <th className="px-4 py-2.5 text-right">Risco</th>
            <th className="px-4 py-2.5 text-right">% Vencido</th>
            {colunasExtras.map((c) => (
              <th key={c.header} className={`px-4 py-2.5 ${c.alinhamento === 'right' ? 'text-right' : 'text-left'}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => {
            const risco = c.snapshotAtual?.riscoCliente ?? 0
            const percVencido = c.snapshotAtual && c.snapshotAtual.riscoCliente > 0 ? (c.snapshotAtual.vencidoOficial / c.snapshotAtual.riscoCliente) * 100 : 0
            return (
              <tr
                key={c.id}
                className="cursor-pointer border-t hover:bg-[var(--cor-fundo-recuado)]"
                style={{ borderColor: 'var(--cor-borda)' }}
                onClick={() => navigate(`/clientes/${c.id}`)}
              >
                <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--cor-primaria)' }}>
                  {c.nome}
                </td>
                <td className="px-4 py-2.5" style={{ color: 'var(--cor-texto-secundario)' }}>{c.grupoEconomico?.nome}</td>
                <td className="px-4 py-2.5" style={{ color: 'var(--cor-texto-secundario)' }}>{c.gerente?.nome}</td>
                <td className="px-4 py-2.5" style={{ color: 'var(--cor-texto-secundario)' }}>{c.plataforma?.nome}</td>
                {mostrarStatus && (
                  <td className="px-4 py-2.5">
                    <StatusBadge status={c.status} />
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <CriticidadeBadge criticidade={c.criticidade} />
                </td>
                <td className="px-4 py-2.5">
                  <PrioridadeBadge prioridade={c.prioridade} />
                </td>
                <td className="numeros-tabulares px-4 py-2.5 text-right font-medium">{formatarMoeda(risco)}</td>
                <td className="numeros-tabulares px-4 py-2.5 text-right">{formatarPercentual(percVencido)}</td>
                {colunasExtras.map((col) => (
                  <td key={col.header} className={`px-4 py-2.5 ${col.alinhamento === 'right' ? 'text-right' : 'text-left'}`} onClick={(e) => e.stopPropagation()}>
                    {col.render(c)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
