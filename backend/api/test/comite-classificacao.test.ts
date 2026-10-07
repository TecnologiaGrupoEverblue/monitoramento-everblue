/**
 * Versão 1.1: vários CNPJs por cliente, carteira apartada, qualidade do dado,
 * restritivos por tipo, classificação semanal, andamento dos planos, pauta
 * automática, ata com os campos do comitê e painel da diretoria — tudo contra
 * PostgreSQL real.
 */
import { describe, expect, it } from 'vitest'
import { CAMPOS_IMPORTACAO } from '@monitoramento/dominio'
import { comporDependencias, type Dependencias } from '../src/composicao'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import type { Banco } from '../src/infra/banco'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { configTeste } from './apoio'
import { carregarDemonstracao } from '../src/infra/cargaDemonstracao'
import { classificarUltimaSemanaPendente } from '../src/infra/classificacaoRetroativa'
import { bancoLimpo, temBanco } from './banco'

const COLUNAS = CAMPOS_IMPORTACAO.map((c) => c.coluna)
const PADRAO: Record<string, string> = {
  'Grupo Econômico': 'Grupo A', Gerente: 'Gerente', 'Plataforma Comercial': 'EVERBLUE', Setor: 'INDUSTRIA', 'Ramo de Atividade': 'PAPEL',
  'Produtos (separados por ;)': 'Faturizacao', 'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'NORMAL', 'Risco do Cliente (R$)': '1000000',
  'Limite Global (R$)': '5000000', 'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'APROVADA', 'Tranche Consolidada (R$)': '0',
  'Valor em Andamento (R$)': '0', 'Vencido Oficial (R$)': '0', 'Aging da Carteira (dias)': '0', 'Prazo Médio da Carteira (dias)': '30',
  'IL 30 dias (%)': '95', 'IL 60 dias (%)': '95', 'IL 90 dias (%)': '95', 'IL 120 dias (%)': '95', 'IL 150 dias (%)': '95', 'IL 180 dias (%)': '95',
  '% Sem Atuação de Manifesto': '0', 'Liquidado no Período (R$)': '0', '% Liquidado no Prazo': '100', 'Atraso Médio (dias)': '0',
}
const q = (v: string) => `"${v.replace(/"/g, '""')}"`
function planilha(linhas: Record<string, string>[]): Buffer {
  return Buffer.from([COLUNAS.map(q).join(','), ...linhas.map((l) => COLUNAS.map((c) => q(l[c] ?? PADRAO[c] ?? '')).join(','))].join('\n'))
}

async function preparar(): Promise<{ banco: Banco; deps: Dependencias; u: { id: string; nome: string; email: string } }> {
  const banco = await bancoLimpo()
  const deps = comporDependencias(configTeste({ DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '' }), { banco, armazenamento: new ArmazenamentoMemoria(), fonteFoto: new FonteFotoNenhuma() })
  const { rows } = await banco.pool.query(`INSERT INTO usuario (email, nome, perfil, origem) VALUES ('a@grupoeverblue.com.br', 'Analista', 'admin', 'local') RETURNING id`)
  return { banco, deps, u: { id: rows[0].id, nome: 'Analista', email: 'a@grupoeverblue.com.br' } }
}

async function importar(deps: Dependencias, u: { id: string; nome: string; email: string }, semana: string, linhas: Record<string, string>[]) {
  const previa = await deps.servicos.importacao.receber({ nomeOriginal: `semana-${semana}.csv`, conteudo: planilha(linhas) }, semana, u)
  const confirmacao = await deps.servicos.importacao.confirmar(previa.importacaoId, semana, u)
  return { previa, confirmacao }
}

describe.skipIf(!temBanco)('fluxo do comitê e classificação (1.1)', () => {
  it('cobre importação, classificação, planos, pauta, ata e painel', async () => {
    const { banco, deps, u } = await preparar()
    try {
      // ---------------------------------------------------------- semana 1
      const s1 = await importar(deps, u, '2026-09-17', [
        { Cliente: 'Anin Papel', CNPJ: '039285002000100, 39.285.002/0008-86', 'Risco do Cliente (R$)': '1000000.10', 'Pefin (qtd)': '13', 'Pefin (R$)': '35000' },
        { Cliente: 'Irmã Papel', CNPJ: '44.186.055/0001-03', 'Risco do Cliente (R$)': '250000.25' },
        { Cliente: 'Sucata Q', CNPJ: '22.333.444/0001-55', Carteira: 'QUATTUOR', 'Grupo Econômico': 'Grupo Q', 'Risco do Cliente (R$)': '777000', 'Vencido Oficial (R$)': '5000' },
        { Cliente: 'Sem Base', CNPJ: '33.444.555/0001-66', 'Grupo Econômico': 'Grupo S', 'IL 30 dias (%)': 'SEM BASE', 'IL 60 dias (%)': '', 'Status da Proposta (EM_ANALISE, APROVADA, VENCIDA, REPROVADA)': 'SEM PROPOSTA', 'Tranche Consolidada (R$)': '1' },
      ])
      expect(s1.previa.linhasComErro).toEqual([])
      expect(s1.confirmacao.snapshotsGravados).toBe(4)
      const semBase = s1.previa.itens.find((i) => i.nome === 'Sem Base')!
      expect(semBase.avisos.some((a) => a.includes('Tranche simbólica'))).toBe(true)

      const clientes = await deps.repos.clientes.listar()
      const anin = clientes.find((c) => c.nome === 'Anin Papel')!
      expect(anin.cnpj).toBe('39.285.002/0001-00')
      expect((await deps.repos.clientes.documentos(anin.id)).map((d) => d.documento)).toEqual(['39.285.002/0001-00', '39.285.002/0008-86'])
      expect(clientes.find((c) => c.nome === 'Sucata Q')!.carteiraId).toBe('car_quattuor')

      // risco do grupo com centavos (antes: Math.round)
      const snapAnin = (await deps.repos.snapshots.porCliente(anin.id))[0]
      expect(snapAnin.riscoGrupo).toBe(1250000.35)
      const snapSemBase = (await deps.repos.snapshots.porCliente(clientes.find((c) => c.nome === 'Sem Base')!.id))[0]
      expect(snapSemBase.il30).toBeNull()
      expect(snapSemBase.statusProposta).toBe('SEM_PROPOSTA')

      // classificação gravada; apartada fora dos KPIs
      const cls1 = await deps.repos.classificacoes.porSemana('2026-09-17')
      expect(cls1.get(clientes.find((c) => c.nome === 'Sucata Q')!.id)!.criticidade).toBe('APARTADO')
      const kpis = await deps.servicos.carteira.obterKPIs({ semanaRef: '2026-09-17' })
      expect(kpis.atual.riscoApartado).toBe(777000) // informado à parte, fora dos totais
      expect(kpis.atual.qtdClientes).toBe(0) // ninguém da Everblue em monitoramento na semana 1
      const painel1 = await deps.servicos.carteira.painelSemanal({})
      expect(painel1.atual!.risco).toBeCloseTo(1000000.1 + 250000.25 + 1000000, 2) // QUATTUOR fora

      // ---------------------------------------------------------- semana 2
      const s2 = await importar(deps, u, '2026-09-24', [
        // reconhecido pelo CNPJ SECUNDÁRIO, com um terceiro documento novo
        { Cliente: 'Anin Papel', CNPJ: '39.285.002/0008-86; 39.285.002/0007-03', 'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'MONITORAMENTO', 'Risco do Cliente (R$)': '2500000', 'Pefin (qtd)': '15', 'Pefin (R$)': '229000', 'Vencido Oficial (R$)': '800000' },
        { Cliente: 'Irmã Papel', CNPJ: '44.186.055/0001-03', 'Risco do Cliente (R$)': '250000.25' },
        { Cliente: 'Sucata Q', CNPJ: '22.333.444/0001-55', Carteira: 'QUATTUOR', 'Grupo Econômico': 'Grupo Q', 'Risco do Cliente (R$)': '777000', 'Status (NORMAL, MONITORAMENTO, SAIDA_DE_RISCO, JURIDICO)': 'MONITORAMENTO' },
      ])
      const itemAnin = s2.previa.itens.find((i) => i.nome === 'Anin Papel')!
      expect(itemAnin.novo).toBe(false)
      expect(itemAnin.documentosNovos).toEqual(['39.285.002/0007-03'])
      expect(itemAnin.avisos.some((a) => a.startsWith('Risco subiu 150%'))).toBe(true)
      expect(itemAnin.alertasGerados.some((a) => a.descricao.startsWith('Piora de restritivos: Pefin 13'))).toBe(true)
      expect(s2.previa.totais.linhasComAviso).toBeGreaterThan(0)

      const cls2 = (await deps.repos.classificacoes.porSemana('2026-09-24')).get(anin.id)!
      expect(cls2).toMatchObject({ prioridadeOrdem: 3, criticidade: 'CRITICO' })
      expect(cls2.alertas.map((a) => a.regra)).toEqual(expect.arrayContaining(['SITUACAO', 'VENCIDO', 'AUMENTO_RISCO', 'RESTRITIVOS']))
      const aninDepois = (await deps.repos.clientes.porId(anin.id))!
      expect(aninDepois).toMatchObject({ criticidade: 'CRITICA', prioridade: 'MEDIA' })
      expect((await deps.repos.eventos.porCliente(anin.id)).some((e) => e.tipo === 'MUDANCA_CRITICIDADE')).toBe(true)

      // apartada em monitoramento aparece só como "apartado" no dashboard
      const kpis2 = await deps.servicos.carteira.obterKPIs({ semanaRef: '2026-09-24' })
      expect(kpis2.atual.riscoApartado).toBe(777000)
      expect(kpis2.atual.risco).toBe(2500000)
      const soQuattuor = await deps.servicos.carteira.obterKPIs({ semanaRef: '2026-09-24', carteiraId: 'car_quattuor' })
      expect(soQuattuor.atual.risco).toBe(777000)

      // ---------------------------------------------------------- restritivos manuais
      const manual = await deps.servicos.restritivos.gravar(anin.id, '2026-09-24', [{ tipo: 'PEFIN', quantidade: 16, valor: 240000 }, { tipo: 'PROTESTO', quantidade: 1, valor: 10000 }], u)
      expect(manual.pioras.length).toBeGreaterThan(0)
      expect(manual.alertaGerado).toBe(true)
      expect((await deps.repos.eventos.porCliente(anin.id)).some((e) => e.tipo === 'RESTRITIVOS')).toBe(true)

      // ---------------------------------------------------------- planos, pauta e ata
      const comite = await deps.servicos.comite.garantirProximoPlanejado()
      const plano = await deps.servicos.decisao.registrar({ clienteId: anin.id, decisao: 'Reduzir exposição', plano: 'Recompra dos títulos não confirmados', prazo: '2026-01-10', responsavel: 'Priscila' }, u)
      const planosAnin = await deps.repos.planos.porCliente(anin.id)
      expect(planosAnin.find((p) => p.id === plano.id)!.status).toBe('ATRASADO') // prazo no passado → atrasado sozinho

      const pauta = await deps.servicos.comite.pauta()
      const naPauta = pauta.itens.find((i) => i.clienteId === anin.id)!
      expect(naPauta.motivos.map((m) => m.motivo)).toEqual(expect.arrayContaining(['PLANO_ATRASADO', 'CRITICO']))
      expect(pauta.itens.some((i) => i.nome === 'Sucata Q')).toBe(false) // apartada fora da pauta

      const andamento = await deps.servicos.planos.registrarAndamento(plano.id, { oQueFoiFeito: 'Notificado o sacado', oQueNaoFoiFeito: 'Recompra não enviada', dataLimite: '2099-12-31' }, u)
      expect(andamento).toMatchObject({ status: 'EM_DIA', oQueFoiFeito: 'Notificado o sacado', atualizadoPor: 'Analista' })
      const concluido = await deps.servicos.planos.registrarAndamento(plano.id, { concluir: true }, u)
      expect(concluido.status).toBe('CONCLUIDO')
      expect(concluido.concluidoEm).toBeTruthy()
      const eventosPlano = (await deps.repos.eventos.porCliente(anin.id)).filter((e) => e.tipo === 'PLANO_ACAO')
      // 1 automático (prazo vencido → atrasado, feito pelo sistema) + 2 andamentos
      expect(eventosPlano.length).toBe(3)
      expect(eventosPlano.filter((e) => e.usuario === 'Sistema')).toHaveLength(1)

      await deps.servicos.checklist.salvarItem(anin.id, '2026-09-24', 'SITUACAO_ATUAL', { parecer: 'Não pagou a confissão; alega pagamento dia 25/09.' }, 'Analista')
      await deps.servicos.checklist.salvarItem(anin.id, '2026-09-24', 'PRACA_PAGAMENTO', { parecer: 'Praça verificada: 30 dias não constatado.' }, 'Analista')
      await banco.pool.query(`UPDATE comite SET data = '2026-09-25' WHERE id = $1`, [comite.id])
      const ata = await deps.servicos.comite.gerarAta(comite.id)
      const discutido = ata.clientesDiscutidos.find((c) => c.clienteId === anin.id)!
      expect(discutido).toMatchObject({
        situacaoAtual: 'Não pagou a confissão; alega pagamento dia 25/09.',
        pracaPagamento: 'Praça verificada: 30 dias não constatado.',
        criticidadeCalculada: 'Crítico',
        oQueFoiRealizado: 'Notificado o sacado',
        oQueNaoFoiRealizado: 'Recompra não enviada',
      })
      expect(discutido.evolucaoRestritivos).toContain('Pefin')
      expect(ata.resumoExecutivo.riscoTotal).toBe(2500000)

      // ---------------------------------------------------------- painel da diretoria
      const painel = await deps.servicos.carteira.painelSemanal({})
      expect(painel.serie.map((p) => p.semana)).toEqual(['2026-09-17', '2026-09-24'])
      // 2 críticos: Anin e a Irmã — a unidade de análise é o grupo, e o risco
      // consolidado do Grupo A subiu R$ 1,5 mi (regra da base do comitê).
      expect(painel.atual).toMatchObject({ qtdCriticos: 2, vencido: 800000, classificada: true })
      expect(painel.anterior!.qtdCriticos).toBe(0)
    } finally {
      await banco.encerrar()
    }
  })

  it('documentos de clientes diferentes na mesma linha saem com erro', async () => {
    const { banco, deps, u } = await preparar()
    try {
      await importar(deps, u, '2026-09-17', [
        { Cliente: 'A', CNPJ: '11.111.111/0001-11', 'Grupo Econômico': 'G1' },
        { Cliente: 'B', CNPJ: '22.222.222/0001-22', 'Grupo Econômico': 'G2' },
      ])
      const previa = await deps.servicos.importacao.receber(
        { nomeOriginal: 's2.csv', conteudo: planilha([{ Cliente: 'A+B', CNPJ: '11.111.111/0001-11, 22.222.222/0001-22' }]) },
        '2026-09-24',
        u,
      )
      expect(previa.itens).toHaveLength(0)
      expect(previa.linhasComErro[0].erros[0]).toMatch(/clientes diferentes/)
    } finally {
      await banco.encerrar()
    }
  })

  it('classifica a última posição anterior à 1.1 uma vez só (job de migração)', async () => {
    const { banco, deps } = await preparar()
    try {
      await carregarDemonstracao(banco, () => {})
      const semanas = await deps.repos.snapshots.semanasDisponiveis()
      const n = await classificarUltimaSemanaPendente(banco, () => {})
      expect(n).toBeGreaterThan(0)
      expect((await deps.repos.classificacoes.porSemana(semanas[semanas.length - 1])).size).toBe(n)
      expect(await classificarUltimaSemanaPendente(banco, () => {})).toBe(0)
      const painel = await deps.servicos.carteira.painelSemanal({})
      expect(painel.atual!.classificada).toBe(true)
      expect(painel.anterior!.classificada).toBe(false) // calculada na hora, não gravada
      const pauta = await deps.servicos.comite.pauta()
      expect(pauta.itens.length).toBeGreaterThan(0)
    } finally {
      await banco.encerrar()
    }
  })
})
