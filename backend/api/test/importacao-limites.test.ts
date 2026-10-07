/**
 * Regressão (base do comitê de 25/09/2026): tranche simbólica de R$ 1 com
 * milhares em andamento gerava consumo de milhões de por cento, estourava a
 * coluna NUMERIC(9,4) e a confirmação inteira caía com erro 500.
 */
import { describe, expect, it } from 'vitest'
import { CAMPOS_IMPORTACAO } from '@monitoramento/dominio'
import { comporDependencias } from '../src/composicao'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { construirSnapshotParcial, PERC_MAXIMO } from '../src/servicos/servicoImportacao'
import { configTeste } from './apoio'
import { bancoLimpo, temBanco } from './banco'

const base: Record<string, string> = {
  nome: 'Cliente Tranche Simbolica Ltda', cnpj: '11.222.333/0001-81', grupoEconomico: 'Grupo X', gerente: 'Gerente', plataforma: 'EVERBLUE',
  setor: 'INDUSTRIA', ramoAtividade: 'PAPEL', produtos: 'Faturizacao', status: 'MONITORAMENTO', riscoCliente: '351251.05', limiteGlobal: '1',
  statusProposta: 'APROVADA', validadeProposta: '31/12/2026', trancheConsolidada: '1', valorEmAndamento: '351251.05', vencidoOficial: '0',
  vencidoDesde: '', agingCarteiraDias: '0', prazoMedioCarteiraDias: '30', il30: '100', il60: '100', il90: '100', il120: '100', il150: '100',
  il180: '100', manifestoPercSemAtuacao: '0', manifestoInacessivel: '0', manifestoNaoConfirma: '0', manifestoTransacaoDesconhecida: '0',
  manifestoLastroInconsistente: '0', manifestoTransacaoNaoConcluida: '0', liquidadoNoPeriodo: '0', recompras: '0', motivoRecompra: '',
  percLiquidadoNoPrazo: '100', atrasoMedioDias: '0', restritivos: '0',
}
const q = (v: string) => `"${v.replace(/"/g, '""')}"`
const csv = [CAMPOS_IMPORTACAO.map((c) => q(c.coluna)).join(','), CAMPOS_IMPORTACAO.map((c) => q(base[c.chave === 'documentos' ? 'cnpj' : c.chave] ?? '')).join(',')].join('\n')

describe('importação com tranche/limite simbólicos', () => {
  it('percentual fica no teto e a tranche continua EXCEDIDA', () => {
    const s = construirSnapshotParcial({ linha: 2, ...base, riscoCliente: 351251.05, limiteGlobal: 1, trancheConsolidada: 1, valorEmAndamento: 351251.05 } as never, '2026-09-24', 'c1')
    expect(s.percConsumoTranche).toBe(PERC_MAXIMO)
    expect(s.percConsumoLimite).toBe(PERC_MAXIMO)
    expect(s.statusTranche).toBe('EXCEDIDA')
  })

  it.skipIf(!temBanco)('confirma no banco sem estouro numérico', async () => {
    const banco = await bancoLimpo()
    const deps = comporDependencias(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '' }), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
    const { rows } = await banco.pool.query(`INSERT INTO usuario (email, nome, perfil, origem) VALUES ('a@grupoeverblue.com.br', 'A', 'admin', 'local') RETURNING id`)
    const u = { id: rows[0].id, nome: 'A', email: 'a@grupoeverblue.com.br' }
    const previa = await deps.servicos.importacao.receber({ nomeOriginal: 'semana.csv', conteudo: Buffer.from(csv) }, '2026-09-24', u)
    expect(previa.colunasFaltando).toEqual([])
    expect(previa.linhasComErro).toEqual([])
    expect(previa.totais.linhasProntas).toBe(1)
    await deps.servicos.importacao.confirmar(previa.importacaoId, '2026-09-24', u)
    const snap = (await banco.pool.query('SELECT perc_consumo_tranche::float AS t, status_tranche FROM snapshot_semanal')).rows[0]
    expect(snap).toEqual({ t: PERC_MAXIMO, status_tranche: 'EXCEDIDA' })
    await banco.encerrar()
  })
})
