import type { Cliente, FiltrosGlobais } from '../models/types'

export const FILTROS_VAZIOS: FiltrosGlobais = {
  semanaRef: null,
  plataformaId: null,
  gerenteId: null,
  clienteId: null,
  grupoEconomicoId: null,
  status: null,
  prioridade: null,
  setor: null,
  ramoAtividade: null,
  produto: null,
}

/** Aplica os filtros globais cruzados sobre uma lista de clientes.
 * Usado por todas as telas para que os filtros do topo afetem tudo. */
export function aplicarFiltrosClientes(clientes: Cliente[], filtros: FiltrosGlobais): Cliente[] {
  return clientes.filter((c) => {
    if (filtros.plataformaId && c.plataformaId !== filtros.plataformaId) return false
    if (filtros.gerenteId && c.gerenteId !== filtros.gerenteId) return false
    if (filtros.clienteId && c.id !== filtros.clienteId) return false
    if (filtros.grupoEconomicoId && c.grupoEconomicoId !== filtros.grupoEconomicoId) return false
    if (filtros.status && c.status !== filtros.status) return false
    if (filtros.prioridade && c.prioridade !== filtros.prioridade) return false
    if (filtros.setor && c.setor !== filtros.setor) return false
    if (filtros.ramoAtividade && c.ramoAtividade !== filtros.ramoAtividade) return false
    if (filtros.produto && !c.produtos.includes(filtros.produto)) return false
    return true
  })
}
