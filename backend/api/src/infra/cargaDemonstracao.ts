/**
 * Carga de DEMONSTRAÇÃO (dados fictícios determinísticos do protótipo).
 * Só roda com a base de clientes vazia, e é recusada em produção.
 */
import { gerarDadosFicticios } from '@monitoramento/dominio/fixtures'
import type { Banco } from './banco'
import { inserirEmLote } from './banco'

export async function carregarDemonstracao(banco: Banco, log: (m: string) => void): Promise<boolean> {
  const { rows } = await banco.pool.query('SELECT count(*)::int AS n FROM cliente')
  if (rows[0].n > 0) {
    log('base já possui clientes — carga de demonstração ignorada')
    return false
  }
  const d = gerarDadosFicticios()
  await banco.transacao(async (tx) => {
    // Comitê planejado criado automaticamente numa base vazia dá lugar ao do conjunto fictício.
    await tx.query(
      `DELETE FROM comite c WHERE c.status = 'PLANEJADO'
         AND NOT EXISTS (SELECT 1 FROM plano_acao p WHERE p.comite_origem_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM ata a WHERE a.comite_id = c.id)`,
    )
    await inserirEmLote(tx, 'grupo_economico', d.gruposEconomicos as never)
    await inserirEmLote(tx, 'gerente', d.gerentes.map((g) => ({ id: g.id, nome: g.nome, email: g.email ?? null })))
    await inserirEmLote(tx, 'plataforma', d.plataformas as never)
    await inserirEmLote(tx, 'cliente', d.clientes as never)
    await inserirEmLote(tx, 'snapshot_semanal', d.snapshots as never, [], 200)
    await inserirEmLote(tx, 'evento_historico', d.eventos as never)
    await inserirEmLote(tx, 'alerta', d.alertas as never)
    await inserirEmLote(tx, 'comite', d.comites as never)
    await inserirEmLote(tx, 'plano_acao', d.planosAcao as never)
    await inserirEmLote(tx, 'saida_de_risco', d.saidasDeRisco as never)
    await inserirEmLote(tx, 'registro_iasr', d.registrosIasr as never, ['indicadores_na_data'])
    await inserirEmLote(tx, 'evento_iasr', d.eventosIasr as never)
    await inserirEmLote(tx, 'juridico', d.juridico as never)
    await inserirEmLote(tx, 'ata', d.atas as never, ['resumo_executivo', 'clientes_discutidos', 'pendencias'])
    await inserirEmLote(tx, 'movimento_conta_mensal', d.movimentosConta as never)
  })
  log(`carga de demonstração concluída: ${d.clientes.length} clientes, ${d.snapshots.length} snapshots`)
  return true
}
