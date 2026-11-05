import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClienteEnriquecido } from '../models/types'
import { formatarMoeda, formatarPercentual } from '../utils/formatters'
import { CriticidadeBadge, PrioridadeBadge, StatusBadge } from './ui/Badges'
import { TabelaResponsiva, type Coluna } from './ui/TabelaResponsiva'
import { NomeCliente } from './ui/NomeCliente'

export interface ColunaExtra {
  header: string
  render: (cliente: ClienteEnriquecido) => ReactNode
  alinhamento?: 'left' | 'right'
  /** Some da tabela em telas menores (continua nos cartões do celular e na ficha). */
  ocultar?: 'lg' | 'xl' | '2xl'
}

export default function ClientesTabela({
  clientes,
  colunasExtras = [],
  mostrarStatus = true,
  semColunas = [],
  complementoGerente,
}: {
  clientes: ClienteEnriquecido[]
  colunasExtras?: ColunaExtra[]
  mostrarStatus?: boolean
  /** Colunas padrão que esta tela não precisa (menos colunas = leitura limpa). */
  semColunas?: ('grupo' | 'plataforma' | 'prioridade')[]
  /** Linha extra abaixo do gerente (ex.: responsável, quando é outra pessoa). */
  complementoGerente?: (c: ClienteEnriquecido) => ReactNode
}) {
  const navigate = useNavigate()
  const risco = (c: ClienteEnriquecido) => c.snapshotAtual?.riscoCliente ?? 0
  const percVencido = (c: ClienteEnriquecido) => (c.snapshotAtual && c.snapshotAtual.riscoCliente > 0 ? (c.snapshotAtual.vencidoOficial / c.snapshotAtual.riscoCliente) * 100 : 0)
  const secundario = (t: ReactNode) => <span style={{ color: 'var(--cor-texto-secundario)' }}>{t}</span>
  const colunas: Coluna<ClienteEnriquecido>[] = [
    { chave: 'cliente', titulo: 'Cliente', principal: true, classe: 'font-medium min-w-[180px]', render: (c) => <NomeCliente nome={c.nome} documento={c.cnpj} /> },
    { chave: 'grupo', titulo: 'Grupo econômico', ocultar: 'xl', render: (c) => secundario(c.grupoEconomico?.nome) },
    {
      chave: 'gerente',
      titulo: 'Gerente',
      render: (c) => (
        <>
          {secundario(c.gerente?.nome)}
          {complementoGerente?.(c)}
        </>
      ),
    },
    { chave: 'plataforma', titulo: 'Plataforma', ocultar: 'xl', render: (c) => secundario(c.plataforma?.nome) },
    ...(mostrarStatus ? [{ chave: 'status', titulo: 'Status', render: (c: ClienteEnriquecido) => <StatusBadge status={c.status} /> }] : []),
    { chave: 'criticidade', titulo: 'Criticidade', render: (c) => <CriticidadeBadge criticidade={c.criticidade} /> },
    { chave: 'prioridade', titulo: 'Prioridade', ocultar: 'lg', render: (c) => <PrioridadeBadge prioridade={c.prioridade} /> },
    { chave: 'risco', titulo: 'Risco', alinhar: 'right', classe: 'numeros-tabulares font-medium whitespace-nowrap', render: (c) => formatarMoeda(risco(c)) },
    { chave: 'vencido', titulo: '% Vencido', alinhar: 'right', classe: 'numeros-tabulares whitespace-nowrap', render: (c) => formatarPercentual(percVencido(c)) },
    ...colunasExtras.map((col) => ({ chave: `extra-${col.header}`, titulo: col.header, alinhar: col.alinhamento, ocultar: col.ocultar, render: col.render, classe: col.alinhamento === 'right' ? 'numeros-tabulares whitespace-nowrap' : 'min-w-[120px]' })),
  ]

  const visiveis = colunas.filter((c) => !semColunas.includes(c.chave as 'grupo'))

  return (
    <TabelaResponsiva
      rotulo="Clientes"
      linhas={clientes}
      colunas={visiveis}
      chave={(c) => c.id}
      aoClicar={(c) => navigate(`/clientes/${c.id}`)}
      vazio="Nenhum cliente encontrado para os filtros selecionados."
    />
  )
}
