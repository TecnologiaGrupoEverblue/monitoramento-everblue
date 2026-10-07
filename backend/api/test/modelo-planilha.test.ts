import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validarLinhasPlanilha } from '@monitoramento/dominio'
import { lerLinhasPlanilha } from '../src/servicos/servicoImportacao'

describe('planilha modelo publicada', () => {
  it('é lida pelo parser sem coluna faltando e a linha de exemplo é válida', async () => {
    const conteudo = readFileSync(new URL('../../../frontend/public/modelos/modelo_importacao_semanal.xlsx', import.meta.url))
    const r = validarLinhasPlanilha(await lerLinhasPlanilha(conteudo, 'xlsx'))
    expect(r.colunasFaltando).toEqual([])
    expect(r.comErro).toEqual([])
    expect(r.validas[0].documentos).toHaveLength(2)
    expect(r.validas[0].restritivosPorTipo?.map((x) => x.tipo)).toEqual(['PEFIN', 'REFIN', 'PROTESTO', 'ACAO_JUDICIAL', 'DIVIDA_VENCIDA'])
  })
})
