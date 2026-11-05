import { useQuery } from '@tanstack/react-query'
import BotaoModoRevisao from '../components/BotaoModoRevisao'
import ClientesTabela from '../components/ClientesTabela'
import ResumoChecklistBadge from '../components/ResumoChecklistBadge'
import { Painel } from '../components/ui/Card'
import { Carregando, ErroCarga } from '../components/ui/EstadoCarga'
import { BotaoExportar } from '../components/arquivos/BotaoExportar'
import { useFiltros } from '../contexts/FiltrosContext'
import { consultas } from '../consultas'
import { formatarMoeda } from '../utils/formatters'

export default function ClientesMonitoramento() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const consulta = useQuery({ ...consultas.clientesEnriquecidos({ ...filtros, status: 'MONITORAMENTO' }), enabled: !carregandoFiltros })
  const clientes = consulta.data ?? []
  const riscoTotal = clientes.reduce((s, c) => s + (c.snapshotAtual?.riscoCliente ?? 0), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            Clientes em Monitoramento
          </h1>
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            {clientes.length} cliente(s) · risco total {formatarMoeda(riscoTotal)}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <BotaoExportar chave="carteira" filtros={{ ...filtros, status: 'MONITORAMENTO' }} />
          <BotaoModoRevisao clientes={clientes} statusAtual="MONITORAMENTO" />
        </div>
      </div>
      <Painel>
        {consulta.isError ? (
          <ErroCarga erro={consulta.error} aoTentarDeNovo={() => void consulta.refetch()} />
        ) : consulta.isPending ? (
          <Carregando />
        ) : (
          <ClientesTabela
            clientes={clientes}
            mostrarStatus={false}
            colunasExtras={[
              { header: 'Checklist', render: (c) => <ResumoChecklistBadge clienteId={c.id} semanaRef={filtros.semanaRef ?? c.snapshotAtual?.semanaRef ?? null} /> },
            ]}
          />
        )}
      </Painel>
    </div>
  )
}
