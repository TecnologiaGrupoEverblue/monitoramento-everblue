/** Tradução dos filtros globais cruzados para SQL parametrizado. */
import type { FiltrosGlobais } from '@monitoramento/dominio'

export function condicoesClientes(filtros: Partial<FiltrosGlobais>, parametros: unknown[], alias = 'c'): string {
  const condicoes: string[] = []
  const adicionar = (coluna: string, valor: unknown) => {
    parametros.push(valor)
    condicoes.push(`${alias}.${coluna} = $${parametros.length}`)
  }
  if (filtros.plataformaId) adicionar('plataforma_id', filtros.plataformaId)
  if (filtros.gerenteId) adicionar('gerente_id', filtros.gerenteId)
  if (filtros.clienteId) adicionar('id', filtros.clienteId)
  if (filtros.grupoEconomicoId) adicionar('grupo_economico_id', filtros.grupoEconomicoId)
  if (filtros.status) adicionar('status', filtros.status)
  if (filtros.prioridade) adicionar('prioridade', filtros.prioridade)
  if (filtros.setor) adicionar('setor', filtros.setor)
  if (filtros.ramoAtividade) adicionar('ramo_atividade', filtros.ramoAtividade)
  if (filtros.produto) {
    parametros.push(filtros.produto)
    condicoes.push(`$${parametros.length} = ANY(${alias}.produtos)`)
  }
  return condicoes.length > 0 ? condicoes.join(' AND ') : 'TRUE'
}
