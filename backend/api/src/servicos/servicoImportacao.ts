/**
 * Importação Semanal — o fluxo da SPEC (§14), agora no servidor:
 *
 * 1. Recebe o arquivo, valida tipo real e tamanho, guarda o ORIGINAL no MinIO
 *    (`importados/planilhas/...`) com metadados e hash no PostgreSQL.
 * 2. Lê e valida as linhas (regra pura do pacote de domínio).
 * 3. Monta a prévia: clientes novos/existentes, comparação com a posição
 *    anterior, alertas que seriam gerados. Nada de negócio é gravado.
 * 4. Na confirmação, grava tudo numa transação: cadastros de apoio, clientes,
 *    eventos de mudança de status, snapshots (append-only) e alertas.
 *
 * A confirmação referencia a importação pelo id: o conteúdo nunca volta do
 * navegador para ser gravado, e confirmar duas vezes é recusado.
 * Nunca toca em prioridade, criticidade, responsável, planos de ação ou
 * pareceres — decisões manuais do comitê.
 */
import { createHash, randomUUID } from 'node:crypto'
import { parse as parseCsv } from 'csv-parse/sync'
import { readSheet } from 'read-excel-file/node'
import {
  avaliarAlertasSnapshot,
  normalizarCnpj,
  validarLinhasPlanilha,
  type Alerta,
  type Cliente,
  type Criticidade,
  type ItemPreviewImportacao,
  type LinhaValidada,
  type PreviewImportacao,
  type ResultadoConfirmacaoImportacao,
  type SnapshotSemanal,
  type StatusCliente,
} from '@monitoramento/dominio'
import type { ArmazenamentoArquivos } from '../infra/armazenamento'
import { nomeSeguro } from './tipoArquivo'
import type { Banco } from '../infra/banco'
import type { AlertaRepositorio } from '../repositorios/alertaRepositorio'
import type { ArquivoRepositorio } from '../repositorios/arquivoRepositorio'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import { novoId, type CadastrosRepositorio } from '../repositorios/cadastrosRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { ConfiguracaoRepositorio } from '../repositorios/configuracaoRepositorio'
import type { EventoRepositorio } from '../repositorios/eventoRepositorio'
import type { ImportacaoRepositorio, RegistroImportacao } from '../repositorios/importacaoRepositorio'
import type { PlanoAcaoRepositorio } from '../repositorios/planoAcaoRepositorio'
import type { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'
import { ErroNegocio } from './servicoComite'

const CRITICIDADE_PADRAO_POR_STATUS: Record<StatusCliente, Criticidade> = {
  NORMAL: 'NORMAL',
  MONITORAMENTO: 'ATENCAO',
  SAIDA_DE_RISCO: 'CRITICA',
  JURIDICO: 'CRITICA',
}

export interface UsuarioImportacao {
  id: string
  nome: string
  email: string
}

export interface ArquivoRecebido {
  nomeOriginal: string
  conteudo: Buffer
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Identifica o formato pelo CONTEÚDO, não pela extensão declarada. */
export function detectarFormato(conteudo: Buffer): 'xlsx' | 'csv' | null {
  if (conteudo.length >= 4 && conteudo[0] === 0x50 && conteudo[1] === 0x4b && conteudo[2] === 0x03 && conteudo[3] === 0x04) return 'xlsx'
  // CSV: texto UTF-8 sem bytes de controle binários nas primeiras linhas.
  const amostra = conteudo.subarray(0, Math.min(conteudo.length, 4096))
  if (amostra.length === 0) return null
  for (const byte of amostra) {
    if (byte === 0) return null
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return null
  }
  return 'csv'
}

/** Nome exibível e seguro para os metadados (sem caminho, sem controle). */
export { nomeSeguro } from './tipoArquivo'

export async function lerLinhasPlanilha(conteudo: Buffer, formato: 'xlsx' | 'csv'): Promise<unknown[][]> {
  if (formato === 'xlsx') {
    return (await readSheet(conteudo)) as unknown[][]
  }
  const texto = conteudo.toString('utf8').replace(/^﻿/, '')
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? ''
  const delimitador = (primeiraLinha.match(/;/g)?.length ?? 0) > (primeiraLinha.match(/,/g)?.length ?? 0) ? ';' : ','
  return parseCsv(texto, { delimiter: delimitador, relax_column_count: true, skip_empty_lines: false, bom: true }) as unknown[][]
}

/** Duas linhas com o mesmo CNPJ na mesma planilha não têm leitura correta
 * possível (qual das duas é a posição?). A primeira segue; as demais vão para
 * a lista de erros, para o usuário corrigir na origem. */
export function separarCnpjsRepetidos(resultado: ReturnType<typeof validarLinhasPlanilha>): ReturnType<typeof validarLinhasPlanilha> {
  const vistos = new Map<string, number>()
  const validas: LinhaValidada[] = []
  const comErro = [...resultado.comErro]
  for (const linha of resultado.validas) {
    const chave = normalizarCnpj(linha.cnpj)
    const primeira = vistos.get(chave)
    if (primeira !== undefined) {
      comErro.push({ linha: linha.linha, erros: [`CNPJ repetido na planilha (já informado na linha ${primeira}).`] })
      continue
    }
    vistos.set(chave, linha.linha)
    validas.push(linha)
  }
  comErro.sort((a, b) => a.linha - b.linha)
  return { ...resultado, validas, comErro }
}

function percVencido(risco: number, vencido: number): number {
  return risco > 0 ? (vencido / risco) * 100 : 0
}

export function construirSnapshotParcial(linha: LinhaValidada, semanaRef: string, clienteId: string): Omit<SnapshotSemanal, 'id'> {
  const percConsumoLimite = linha.limiteGlobal > 0 ? (linha.riscoCliente / linha.limiteGlobal) * 100 : 0
  const percConsumoTranche = linha.trancheConsolidada > 0 ? (linha.valorEmAndamento / linha.trancheConsolidada) * 100 : 0
  const statusTranche: SnapshotSemanal['statusTranche'] = percConsumoTranche >= 100 ? 'EXCEDIDA' : percConsumoTranche >= 85 ? 'PROXIMA_DO_LIMITE' : 'DENTRO_DO_LIMITE'
  return {
    clienteId,
    semanaRef,
    criadoEm: new Date().toISOString(),
    riscoCliente: linha.riscoCliente,
    riscoGrupo: 0,
    limiteGlobal: linha.limiteGlobal,
    percConsumoLimite: Number(percConsumoLimite.toFixed(1)),
    statusProposta: linha.statusProposta,
    validadeProposta: linha.validadeProposta,
    trancheConsolidada: linha.trancheConsolidada,
    valorEmAndamento: linha.valorEmAndamento,
    percConsumoTranche: Number(percConsumoTranche.toFixed(1)),
    statusTranche,
    vencidoOficial: linha.vencidoOficial,
    vencidoDesde: linha.vencidoDesde,
    agingCarteiraDias: Math.round(linha.agingCarteiraDias),
    prazoMedioCarteiraDias: Math.round(linha.prazoMedioCarteiraDias),
    il30: linha.il30,
    il60: linha.il60,
    il90: linha.il90,
    il120: linha.il120,
    il150: linha.il150,
    il180: linha.il180,
    manifestoPercSemAtuacao: linha.manifestoPercSemAtuacao,
    manifestoInacessivel: linha.manifestoInacessivel,
    manifestoNaoConfirma: linha.manifestoNaoConfirma,
    manifestoTransacaoDesconhecida: linha.manifestoTransacaoDesconhecida,
    manifestoLastroInconsistente: linha.manifestoLastroInconsistente,
    manifestoTransacaoNaoConcluida: linha.manifestoTransacaoNaoConcluida,
    liquidadoNoPeriodo: linha.liquidadoNoPeriodo,
    recompras: linha.recompras,
    motivoRecompra: linha.motivoRecompra || null,
    percLiquidadoNoPrazo: linha.percLiquidadoNoPrazo,
    atrasoMedioDias: Math.round(linha.atrasoMedioDias),
    restritivos: Math.round(linha.restritivos),
  }
}

export class ServicoImportacao {
  constructor(
    private readonly banco: Banco,
    private readonly armazenamento: ArmazenamentoArquivos,
    private readonly arquivos: ArquivoRepositorio,
    private readonly importacoes: ImportacaoRepositorio,
    private readonly clientes: ClienteRepositorio,
    private readonly snapshots: SnapshotRepositorio,
    private readonly cadastros: CadastrosRepositorio,
    private readonly configuracoes: ConfiguracaoRepositorio,
    private readonly planos: PlanoAcaoRepositorio,
    private readonly eventos: EventoRepositorio,
    private readonly alertas: AlertaRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly limites: { maxBytes: number; maxLinhas: number },
  ) {}

  async receber(arquivo: ArquivoRecebido, semanaRef: string, usuario: UsuarioImportacao): Promise<PreviewImportacao> {
    if (arquivo.conteudo.length === 0) throw new ErroNegocio('O arquivo enviado está vazio.', 400, 'arquivo_vazio')
    if (arquivo.conteudo.length > this.limites.maxBytes) throw new ErroNegocio('O arquivo excede o tamanho máximo permitido.', 413, 'arquivo_grande')
    const formato = detectarFormato(arquivo.conteudo)
    if (!formato) throw new ErroNegocio('Formato não reconhecido. Envie um .xlsx ou .csv gerado a partir do modelo.', 415, 'formato_invalido')

    let linhas: unknown[][]
    try {
      linhas = await lerLinhasPlanilha(arquivo.conteudo, formato)
    } catch {
      throw new ErroNegocio('Não foi possível ler o arquivo. Confira se é um .xlsx ou .csv válido, gerado a partir do modelo.', 422, 'arquivo_ilegivel')
    }
    if (linhas.length - 1 > this.limites.maxLinhas) {
      throw new ErroNegocio(`A planilha tem mais de ${this.limites.maxLinhas} linhas. Divida o arquivo.`, 413, 'linhas_demais')
    }
    const resultado = separarCnpjsRepetidos(validarLinhasPlanilha(linhas))

    // Original guardado ANTES de qualquer processamento de negócio: é a prova
    // de auditoria do dado que gerou (ou não) cada snapshot.
    const agora = new Date()
    const arquivoId = randomUUID()
    const nome = nomeSeguro(arquivo.nomeOriginal)
    const mime = formato === 'xlsx' ? MIME_XLSX : 'text/csv'
    const sha256 = createHash('sha256').update(arquivo.conteudo).digest('hex')
    const chave = `importados/planilhas/${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, '0')}/${arquivoId}.${formato}`
    const importacaoId = randomUUID()
    const { idVersao } = await this.armazenamento.gravar(chave, arquivo.conteudo, mime, { sha256, 'importacao-semana': semanaRef })

    await this.banco.transacao(async (tx) => {
      // Entra no ciclo de vida como qualquer arquivo (Central de Arquivos),
      // vinculado à importação que o originou.
      await this.arquivos.registrar(
        {
          id: arquivoId,
          finalidade: 'importado',
          categoria: 'planilha-semanal',
          chaveObjeto: chave,
          idVersaoMinio: idVersao,
          nomeOriginal: nome,
          mime,
          tamanhoBytes: arquivo.conteudo.length,
          sha256,
          criadoPor: usuario.id,
          descricao: `Posição semanal de ${semanaRef.split('-').reverse().join('/')}`,
          recursoTipo: 'importacao',
          recursoId: importacaoId,
        },
        tx,
      )
      await this.importacoes.criar(
        { id: importacaoId, arquivoId, semanaRef, linhasValidas: resultado.validas, linhasComErro: resultado.comErro, colunasFaltando: resultado.colunasFaltando, criadoPor: usuario.id },
        tx,
      )
    })
    await this.auditoria.registrar({
      acao: 'importacao.recebida',
      atorId: usuario.id,
      atorEmail: usuario.email,
      recursoTipo: 'importacao',
      recursoId: importacaoId,
      detalhes: { arquivo: nome, sha256, linhasValidas: resultado.validas.length, linhasComErro: resultado.comErro.length },
    })
    return this.montarPreview(await this.carregar(importacaoId), semanaRef)
  }

  async previa(importacaoId: string, semanaRef: string): Promise<PreviewImportacao> {
    const registro = await this.carregar(importacaoId)
    if (registro.status !== 'PREVIA') throw new ErroNegocio('Esta importação já foi confirmada.', 409, 'importacao_confirmada')
    await this.importacoes.atualizarSemana(importacaoId, semanaRef)
    return this.montarPreview({ ...registro, semanaRef }, semanaRef)
  }

  private async carregar(importacaoId: string): Promise<RegistroImportacao> {
    const registro = await this.importacoes.porId(importacaoId)
    if (!registro) throw new ErroNegocio('Importação não encontrada.', 404, 'nao_encontrado')
    return registro
  }

  private async montarPreview(registro: RegistroImportacao, semanaRef: string): Promise<PreviewImportacao> {
    const [porCnpj, configs, planosAtrasados] = await Promise.all([
      this.clientes.mapaPorCnpjNormalizado(),
      this.configuracoes.listarAlertas(),
      this.planos.contarAtrasados(),
    ])
    const existentes = registro.linhasValidas.map((l) => porCnpj.get(normalizarCnpj(l.cnpj)) ?? null)
    const idsExistentes = existentes.filter((c): c is Cliente => Boolean(c)).map((c) => c.id)
    const [jaNaSemana, ultimos] = await Promise.all([
      this.snapshots.clientesComSnapshotNaSemana(idsExistentes, semanaRef),
      this.snapshots.ultimosPorCliente(idsExistentes),
    ])

    const itens: ItemPreviewImportacao[] = registro.linhasValidas.map((linha, i) => {
      const existente = existentes[i]
      const jaImportadoNestaSemana = existente ? jaNaSemana.has(existente.id) : false
      const clienteId = existente?.id ?? `__novo__${linha.linha}`
      const snapshotAnterior = existente ? (ultimos.get(existente.id) ?? null) : null
      const parcial = construirSnapshotParcial(linha, semanaRef, clienteId)
      const alertasGerados = jaImportadoNestaSemana ? [] : avaliarAlertasSnapshot(parcial as SnapshotSemanal, snapshotAnterior, configs)
      const riscoAnterior = snapshotAnterior?.riscoCliente ?? null
      const percVencidoAnterior = snapshotAnterior ? percVencido(snapshotAnterior.riscoCliente, snapshotAnterior.vencidoOficial) : null
      const percVencidoNovo = percVencido(linha.riscoCliente, linha.vencidoOficial)
      return {
        linha: linha.linha,
        novo: !existente,
        jaImportadoNestaSemana,
        clienteId,
        nome: linha.nome,
        cnpj: linha.cnpj,
        statusAnterior: existente?.status ?? null,
        statusNovo: linha.status,
        mudouStatus: Boolean(existente) && existente!.status !== linha.status,
        riscoAnterior,
        riscoNovo: linha.riscoCliente,
        deltaRisco: riscoAnterior !== null ? linha.riscoCliente - riscoAnterior : null,
        percVencidoAnterior,
        percVencidoNovo,
        aumentoVencido: percVencidoAnterior !== null && percVencidoNovo - percVencidoAnterior >= 1,
        alertasGerados,
        linhaValidada: linha,
      }
    })

    const prontos = itens.filter((i) => !i.jaImportadoNestaSemana)
    return {
      importacaoId: registro.id,
      nomeArquivo: registro.nomeArquivo,
      semanaRef,
      itens,
      colunasFaltando: registro.colunasFaltando,
      linhasComErro: registro.linhasComErro,
      totais: {
        totalLinhasValidas: registro.linhasValidas.length,
        linhasProntas: prontos.length,
        linhasJaImportadas: itens.length - prontos.length,
        clientesNovos: prontos.filter((i) => i.novo).length,
        clientesAtualizados: prontos.filter((i) => !i.novo).length,
        deltaRiscoTotal: prontos.reduce((soma, i) => soma + (i.deltaRisco ?? 0), 0),
        clientesComAumentoDeVencido: prontos.filter((i) => i.aumentoVencido).length,
        totalNovosAlertas: prontos.reduce((soma, i) => soma + i.alertasGerados.length, 0),
        planosAtrasadosExistentes: planosAtrasados,
        clientesComMudancaDeStatus: prontos.filter((i) => i.mudouStatus).length,
      },
    }
  }

  async confirmar(importacaoId: string, semanaRef: string, usuario: UsuarioImportacao): Promise<ResultadoConfirmacaoImportacao> {
    const registro = await this.carregar(importacaoId)
    if (registro.status !== 'PREVIA') throw new ErroNegocio('Esta importação já foi confirmada.', 409, 'importacao_confirmada')
    if (registro.colunasFaltando.length > 0) throw new ErroNegocio('A planilha não tem todas as colunas do modelo.', 422, 'colunas_faltando')

    // Prévia recalculada no momento da confirmação: a base pode ter mudado
    // desde que a tela foi aberta, e o que se grava é o que vale AGORA.
    const preview = await this.montarPreview(registro, semanaRef)
    const prontos = preview.itens.filter((i) => !i.jaImportadoNestaSemana)
    if (prontos.length === 0) throw new ErroNegocio('Não há linhas novas para importar nesta semana.', 422, 'nada_a_importar')
    const agora = new Date().toISOString()
    const rotuloUsuario = usuario.nome

    const resultado = await this.banco.transacao(async (tx) => {
      const travado = await this.importacoes.porId(importacaoId, tx, true)
      if (!travado || travado.status !== 'PREVIA') throw new ErroNegocio('Esta importação já foi confirmada.', 409, 'importacao_confirmada')

      // Passo 1: cadastros de apoio e clientes.
      const grupoPorLinha = new Map<number, string>()
      const clienteIdPorLinha = new Map<number, string>()
      const responsavelPorCliente = new Map<string, string>()
      let clientesCriados = 0
      for (const item of prontos) {
        const linha = item.linhaValidada
        const grupo = await this.cadastros.encontrarOuCriar('grupo_economico', linha.grupoEconomico, tx)
        const gerente = await this.cadastros.encontrarOuCriar('gerente', linha.gerente, tx)
        const plataforma = await this.cadastros.encontrarOuCriar('plataforma', linha.plataforma, tx)
        grupoPorLinha.set(item.linha, grupo.id)

        if (item.novo) {
          const cliente: Cliente = {
            id: novoId('cli'),
            nome: linha.nome,
            cnpj: linha.cnpj,
            grupoEconomicoId: grupo.id,
            gerenteId: gerente.id,
            plataformaId: plataforma.id,
            setor: linha.setor,
            ramoAtividade: linha.ramoAtividade,
            produtos: linha.produtos,
            status: linha.status,
            prioridade: 'MEDIA',
            criticidade: CRITICIDADE_PADRAO_POR_STATUS[linha.status],
            responsavel: linha.gerente,
            criadoEm: agora,
          }
          await this.clientes.criar(cliente, tx)
          clienteIdPorLinha.set(item.linha, cliente.id)
          responsavelPorCliente.set(cliente.id, cliente.responsavel)
          clientesCriados += 1
        } else {
          await this.clientes.atualizarPelaImportacao(
            item.clienteId,
            {
              nome: linha.nome,
              grupoEconomicoId: grupo.id,
              gerenteId: gerente.id,
              plataformaId: plataforma.id,
              setor: linha.setor,
              ramoAtividade: linha.ramoAtividade,
              produtos: linha.produtos,
              status: linha.status,
            },
            tx,
          )
          clienteIdPorLinha.set(item.linha, item.clienteId)
          if (item.mudouStatus) {
            await this.eventos.registrar(
              {
                clienteId: item.clienteId,
                data: agora,
                usuario: rotuloUsuario,
                tipo: 'MUDANCA_STATUS',
                valorAnterior: item.statusAnterior,
                valorNovo: item.statusNovo,
                justificativa: 'Atualização via Importação Semanal',
                decisaoComiteId: null,
              },
              tx,
            )
          }
        }
      }

      // Passo 2: risco consolidado por grupo econômico, olhando todo mundo do
      // grupo (inclusive quem não veio nesta planilha).
      const todos = await this.clientes.listar({}, tx)
      const riscoNovoPorCliente = new Map(prontos.map((i) => [clienteIdPorLinha.get(i.linha)!, i.riscoNovo]))
      const gruposTocados = new Set(grupoPorLinha.values())
      const membrosSemRisco = todos.filter((c) => gruposTocados.has(c.grupoEconomicoId) && !riscoNovoPorCliente.has(c.id)).map((c) => c.id)
      const ultimos = await this.snapshots.ultimosPorCliente(membrosSemRisco, tx)
      const riscoPorGrupo = new Map<string, number>()
      for (const c of todos) {
        if (!gruposTocados.has(c.grupoEconomicoId)) continue
        const risco = riscoNovoPorCliente.get(c.id) ?? ultimos.get(c.id)?.riscoCliente ?? 0
        riscoPorGrupo.set(c.grupoEconomicoId, (riscoPorGrupo.get(c.grupoEconomicoId) ?? 0) + risco)
        if (!responsavelPorCliente.has(c.id)) responsavelPorCliente.set(c.id, c.responsavel)
      }

      // Passo 3: snapshots (append-only) e alertas.
      const snapshots: (SnapshotSemanal & { importacaoId: string })[] = []
      const alertas: Omit<Alerta, 'id'>[] = []
      for (const item of prontos) {
        const clienteId = clienteIdPorLinha.get(item.linha)!
        const grupoId = grupoPorLinha.get(item.linha)!
        const parcial = construirSnapshotParcial(item.linhaValidada, semanaRef, clienteId)
        snapshots.push({ id: novoId('snp'), ...parcial, riscoGrupo: Math.round(riscoPorGrupo.get(grupoId) ?? item.riscoNovo), importacaoId })
        for (const a of item.alertasGerados) {
          alertas.push({
            clienteId,
            tipo: a.tipo,
            gravidade: a.gravidade,
            data: agora,
            descricao: a.descricao,
            status: 'ABERTO',
            responsavel: responsavelPorCliente.get(clienteId) ?? rotuloUsuario,
          })
        }
      }
      await this.snapshots.inserir(snapshots, tx)
      await this.alertas.criarMuitos(alertas, tx)
      await this.importacoes.confirmar(importacaoId, usuario.id, semanaRef, preview.totais, tx)
      await this.auditoria.registrar(
        {
          acao: 'importacao.confirmada',
          atorId: usuario.id,
          atorEmail: usuario.email,
          recursoTipo: 'importacao',
          recursoId: importacaoId,
          detalhes: { semanaRef, snapshots: snapshots.length, clientesCriados, alertas: alertas.length },
        },
        tx,
      )
      return { importacaoId, semanaRef, snapshotsGravados: snapshots.length, clientesCriados, alertasGerados: alertas.length }
    })
    return resultado
  }
}
