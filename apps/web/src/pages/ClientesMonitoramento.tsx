import { useCallback, useEffect, useState } from 'react'
import BotaoModoRevisao from '../components/BotaoModoRevisao'
import ClientesTabela from '../components/ClientesTabela'
import ResumoChecklistBadge from '../components/ResumoChecklistBadge'
import { Painel } from '../components/ui/Card'
import { BotaoExportar } from '../components/arquivos/BotaoExportar'
import { useFiltros } from '../contexts/FiltrosContext'
import type { ClienteEnriquecido } from '../models/types'
import { clienteRepository } from '../repositories'
import { formatarMoeda } from '../utils/formatters'

export default function ClientesMonitoramento() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const [clientes, setClientes] = useState<ClienteEnriquecido[]>([])
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(() => {
    setCarregando(true)
    return clienteRepository.listarEnriquecidos({ ...filtros, status: 'MONITORAMENTO' }).then((lista) => {
      setClientes(lista)
      setCarregando(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros])

  useEffect(() => {
    if (carregandoFiltros) return
    carregar()
  }, [carregandoFiltros, carregar])

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
          <BotaoModoRevisao clientes={clientes} statusAtual="MONITORAMENTO" aoConcluir={carregar} />
        </div>
      </div>
      <Painel>
        {carregando ? (
          <p className="p-6 text-sm text-gray-500">Carregando…</p>
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
