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
 * Prioridade e criticidade passam a ser CALCULADAS (classificação semanal,
 * regras da base do comitê) e gravadas na confirmação. Nunca toca em
 * responsável, planos de ação ou pareceres — decisões manuais do comitê.
 */
import { createHash, randomUUID } from 'node:crypto'
import { parse as parseCsv } from 'csv-parse/sync'
import { readSheet } from 'read-excel-file/node'
import {
  ABA_BASE_COMITE,
  agingDoVencido,
  converterBaseComite,
  localizarCabecalhoBase,
  pareceModeloOficial,
  type FormatoImportacao,
  type OpcoesValidacao,
  avaliarAlertasSnapshot,
  CARTEIRA_PADRAO_ID,
  classificarCliente,
  criticidadeDoCadastro,
  formatarMoeda,
  limiaresDe,
  normalizarCnpj,
  prioridadeDoCadastro,
  somarLinhasDoMesmoCliente,
  textoAlertas,
  type ClassificacaoSemanal,
  type EventoHistorico,
  type LimiaresClassificacao,
  validarLinhasPlanilha,
  type Alerta,
  type Cliente,
  type Criticidade,
  type ItemPreviewImportacao,
  type LinhaComErro,
  type LinhaValidada,
  type PreviewImportacao,
  type ResultadoConfirmacaoImportacao,
  type SnapshotSemanal,
  type StatusCliente,
} from '@monitoramento/dominio'
import type { ArmazenamentoArquivos } from '../infra/armazenamento'
import { nomeSeguro } from './tipoArquivo'
import { inspecionarZip } from './inspecaoZip'
import type { Banco, Executor } from '../infra/banco'
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
import type { RestritivoRepositorio } from '../repositorios/restritivoRepositorio'
import type { ClassificacaoRepositorio } from '../repositorios/classificacaoRepositorio'
import { ErroNegocio } from './servicoComite'

const CRITICIDADE_PADRAO_POR_STATUS: Record<StatusCliente, Criticidade> = {
  NORMAL: 'NORMAL',
  MONITORAMENTO: 'ATENCAO',
  SAIDA_DE_RISCO: 'CRITICA',
  RECUPERACAO_DE_CREDITO: 'CRITICA',
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

/** Planilha lida e já no layout do modelo, pronta para a validação. */
export interface LeituraImportacao {
  formato: FormatoImportacao
  linhas: unknown[][]
  opcoes: Pick<OpcoesValidacao, 'linhasOrigem' | 'avisosPorLinha' | 'agingDerivadoDoVencido'>
  /** Colunas essenciais ausentes na base do comitê (carga recusada). */
  colunasFaltando: string[]
  observacoes: string[]
}

/**
 * Dois layouts, uma regra: o modelo oficial segue direto; a base do comitê
 * (aba "Análise da Carteira") é convertida para o modelo e passa pela MESMA
 * validação. Qualquer outra coisa vai como modelo e a validação aponta as
 * colunas que faltam.
 */
export async function lerPlanilhaImportacao(conteudo: Buffer, formato: 'xlsx' | 'csv'): Promise<LeituraImportacao> {
  const primeira = await lerLinhasPlanilha(conteudo, formato)
  const modelo = (linhas: unknown[][]): LeituraImportacao => ({ formato: 'MODELO', linhas, opcoes: {}, colunasFaltando: [], observacoes: [] })
  if (pareceModeloOficial(primeira)) return modelo(primeira)
  let base = primeira
  if (formato === 'xlsx') {
    base = await (readSheet(conteudo, ABA_BASE_COMITE) as Promise<unknown[][]>).catch(() => primeira)
  }
  if (localizarCabecalhoBase(base) < 0) return modelo(primeira)
  const c = converterBaseComite(base)
  return {
    formato: 'BASE_COMITE',
    linhas: c.linhas,
    opcoes: { linhasOrigem: c.linhasOrigem, avisosPorLinha: c.avisosPorLinha, agingDerivadoDoVencido: true },
    colunasFaltando: c.colunasFaltando,
    observacoes: c.observacoes,
  }
}

export async function lerLinhasPlanilha(conteudo: Buffer, formato: 'xlsx' | 'csv'): Promise<unknown[][]> {
  if (formato === 'xlsx') {
    return (await readSheet(conteudo)) as unknown[][]
  }
  const texto = conteudo.toString('utf8').replace(/^﻿/, '')
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? ''
  const delimitador = (primeiraLinha.match(/;/g)?.length ?? 0) > (primeiraLinha.match(/,/g)?.length ?? 0) ? ';' : ','
  return parseCsv(texto, { delimiter: delimitador, relax_column_count: true, skip_empty_lines: false, bom: true }) as unknown[][]
}

/** Duas linhas que compartilham um documento (CNPJ) não têm leitura correta
 * possível (qual das duas é a posição?). A primeira segue; as demais vão para
 * a lista de erros, para o usuário corrigir na origem. */
export function separarCnpjsRepetidos(resultado: ReturnType<typeof validarLinhasPlanilha>): ReturnType<typeof validarLinhasPlanilha> {
  const vistos = new Map<string, number>()
  const validas: LinhaValidada[] = []
  const comErro = [...resultado.comErro]
  for (const linha of resultado.validas) {
    const chaves = documentosDaLinha(linha).map(normalizarCnpj)
    const repetida = chaves.map((c) => vistos.get(c)).find((v) => v !== undefined)
    if (repetida !== undefined) {
      comErro.push({ linha: linha.linha, erros: [`CNPJ repetido na planilha (já informado na linha ${repetida}).`] })
      continue
    }
    for (const c of chaves) vistos.set(c, linha.linha)
    validas.push(linha)
  }
  comErro.sort((a, b) => a.linha - b.linha)
  return { ...resultado, validas, comErro }
}

/** Junta, no lugar da primeira, as linhas que apontam para o mesmo cliente já
 * cadastrado (regra em `somarLinhasDoMesmoCliente`). Clientes novos não se
 * juntam: CNPJ repetido já foi recusado em `separarCnpjsRepetidos`. */
export function agruparLinhasDoMesmoCliente<T extends { linha: LinhaValidada; existente: { id: string } | null; documentosNovos: string[] }>(
  linhas: T[],
  documentoNovo: (documento: string) => boolean,
): void {
  const porCliente = new Map<string, T[]>()
  for (const l of linhas) {
    if (!l.existente) continue
    const grupo = porCliente.get(l.existente.id)
    if (grupo) grupo.push(l)
    else porCliente.set(l.existente.id, [l])
  }
  for (const grupo of porCliente.values()) {
    if (grupo.length < 2) continue
    const somada = somarLinhasDoMesmoCliente(grupo.map((g) => g.linha))
    const primeira = grupo[0]
    primeira.linha = somada
    primeira.documentosNovos = documentosDaLinha(somada).filter(documentoNovo)
    for (const outra of grupo.slice(1)) linhas.splice(linhas.indexOf(outra), 1)
  }
}

/** Prévias gravadas antes da 1.1 não têm a lista de documentos. */
export function documentosDaLinha(linha: LinhaValidada): string[] {
  return linha.documentos && linha.documentos.length > 0 ? linha.documentos : [linha.cnpj]
}

function percVencido(risco: number, vencido: number): number {
  return risco > 0 ? (vencido / risco) * 100 : 0
}

/** Teto dos percentuais gravados: as colunas são NUMERIC(9,4) (até 99.999,9999).
 * Uma base com tranche ou limite simbólico (ex.: R$ 1) gera consumo de milhões
 * de por cento; o status continua EXCEDIDA e o percentual fica no teto, em vez
 * de derrubar a importação inteira com estouro numérico. */
export const PERC_MAXIMO = 99_999
const limitarPerc = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, -PERC_MAXIMO), PERC_MAXIMO) : 0)
/** Janela de liquidez sem base continua ausente (antes da 1.1 virava 0). */
const percOuNulo = (v: number | null | undefined) => (v === null || v === undefined ? null : limitarPerc(v))

export function construirSnapshotParcial(linha: LinhaValidada, semanaRef: string, clienteId: string): Omit<SnapshotSemanal, 'id'> {
  const percConsumoLimite = limitarPerc(linha.limiteGlobal > 0 ? (linha.riscoCliente / linha.limiteGlobal) * 100 : 0)
  const percConsumoTranche = limitarPerc(linha.trancheConsolidada > 0 ? (linha.valorEmAndamento / linha.trancheConsolidada) * 100 : 0)
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
    // Base do comitê: o aging depende da semana escolhida (pode mudar na prévia).
    agingCarteiraDias: linha.agingDerivadoDoVencido ? agingDoVencido(linha.vencidoDesde, semanaRef) : Math.round(linha.agingCarteiraDias),
    // 1.2: duas casas (37,89 dias), coluna NUMERIC(9,2) desde a migração 0008.
    prazoMedioCarteiraDias: linha.prazoMedioCarteiraDias === null ? null : Math.round(linha.prazoMedioCarteiraDias * 100) / 100,
    il30: percOuNulo(linha.il30),
    il60: percOuNulo(linha.il60),
    il90: percOuNulo(linha.il90),
    il120: percOuNulo(linha.il120),
    il150: percOuNulo(linha.il150),
    il180: percOuNulo(linha.il180),
    manifestoPercSemAtuacao: percOuNulo(linha.manifestoPercSemAtuacao),
    manifestoInacessivel: linha.manifestoInacessivel,
    manifestoNaoConfirma: linha.manifestoNaoConfirma,
    manifestoTransacaoDesconhecida: linha.manifestoTransacaoDesconhecida,
    manifestoLastroInconsistente: linha.manifestoLastroInconsistente,
    manifestoTransacaoNaoConcluida: linha.manifestoTransacaoNaoConcluida,
    liquidadoNoPeriodo: linha.liquidadoNoPeriodo,
    recompras: linha.recompras,
    motivoRecompra: linha.motivoRecompra || null,
    percLiquidadoNoPrazo: percOuNulo(linha.percLiquidadoNoPrazo),
    atrasoMedioDias: linha.atrasoMedioDias === null ? null : Math.round(linha.atrasoMedioDias * 100) / 100,
    restritivos: Math.round(linha.restritivos),
    prorrogacoesAcima60d: linha.prorrogacoesAcima60d ?? null,
    operacoesMesAnterior: linha.operacoesMesAnterior ?? null,
    operacoesMes: linha.operacoesMes ?? null,
  }
}

/** Risco consolidado do grupo com centavos (soma de NUMERIC(18,2) em double
 * pode sobrar fração de centavo). */
export function arredondarCentavos(v: number): number {
  return Math.round(v * 100) / 100
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
    private readonly restritivos: RestritivoRepositorio,
    private readonly classificacoes: ClassificacaoRepositorio,
  ) {}

  private async limiares(executor?: Executor): Promise<LimiaresClassificacao> {
    return limiaresDe(await this.classificacoes.listarRegras(executor))
  }

  async receber(arquivo: ArquivoRecebido, semanaRef: string, usuario: UsuarioImportacao): Promise<PreviewImportacao> {
    if (arquivo.conteudo.length === 0) throw new ErroNegocio('O arquivo enviado está vazio.', 400, 'arquivo_vazio')
    if (arquivo.conteudo.length > this.limites.maxBytes) throw new ErroNegocio('O arquivo excede o tamanho máximo permitido.', 413, 'arquivo_grande')
    const formato = detectarFormato(arquivo.conteudo)
    if (!formato) throw new ErroNegocio('Formato não reconhecido. Envie um .xlsx ou .csv gerado a partir do modelo.', 415, 'formato_invalido')

    if (formato === 'xlsx') {
      const zip = inspecionarZip(arquivo.conteudo)
      if (!zip.ok) throw new ErroNegocio('O arquivo .xlsx foi recusado pela verificação de segurança. Salve a planilha de novo pelo Excel e envie outra vez.', 422, 'arquivo_recusado')
    }
    let leitura: LeituraImportacao
    try {
      leitura = await lerPlanilhaImportacao(arquivo.conteudo, formato)
    } catch {
      throw new ErroNegocio('Não foi possível ler o arquivo. Confira se é um .xlsx ou .csv válido: o modelo de importação ou a base do comitê (aba "Análise da Carteira").', 422, 'arquivo_ilegivel')
    }
    if (leitura.linhas.length - 1 > this.limites.maxLinhas) {
      throw new ErroNegocio(`A planilha tem mais de ${this.limites.maxLinhas} linhas. Divida o arquivo.`, 413, 'linhas_demais')
    }
    const lim = await this.limiares()
    const resultado =
      leitura.colunasFaltando.length > 0
        ? { colunasFaltando: leitura.colunasFaltando, validas: [], comErro: [] }
        : separarCnpjsRepetidos(validarLinhasPlanilha(leitura.linhas, { valorSimbolico: lim.AVISO_VALOR_SIMBOLICO, ...leitura.opcoes }))

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
        {
          id: importacaoId,
          arquivoId,
          semanaRef,
          linhasValidas: resultado.validas,
          linhasComErro: resultado.comErro,
          colunasFaltando: resultado.colunasFaltando,
          formato: leitura.formato,
          observacoes: leitura.observacoes,
          criadoPor: usuario.id,
        },
        tx,
      )
    })
    await this.auditoria.registrar({
      acao: 'importacao.recebida',
      atorId: usuario.id,
      atorEmail: usuario.email,
      recursoTipo: 'importacao',
      recursoId: importacaoId,
      detalhes: { arquivo: nome, sha256, formato: leitura.formato, linhasValidas: resultado.validas.length, linhasComErro: resultado.comErro.length },
    })
    return this.montarPreview(await this.carregar(importacaoId), semanaRef)
  }

  /** Foto do Bitfin (1.2): as linhas já vêm validadas pela MESMA regra da
   * planilha; daqui em diante o caminho é idêntico (prévia → confirmação). O
   * arquivo é o JSON bruto da leitura, guardado antes de qualquer gravação. */
  /** `substituir` (ADR-023): a posição que o cliente já tem nesta semana é
   * trocada pela desta foto, enquanto o comitê da semana não tiver ata. */
  async registrarFoto(p: { arquivoId: string; semanaRef: string; validas: LinhaValidada[]; comErro: LinhaComErro[]; observacoes: string[]; usuarioId: string; substituir?: boolean }): Promise<PreviewImportacao> {
    const importacaoId = randomUUID()
    await this.importacoes.criar({
      id: importacaoId,
      arquivoId: p.arquivoId,
      semanaRef: p.semanaRef,
      linhasValidas: p.validas,
      linhasComErro: p.comErro,
      colunasFaltando: [],
      formato: 'BITFIN',
      observacoes: p.observacoes,
      criadoPor: p.usuarioId,
    })
    return this.montarPreview(await this.carregar(importacaoId), p.semanaRef, p.substituir === true)
  }

  async previa(importacaoId: string, semanaRef: string): Promise<PreviewImportacao> {
    const registro = await this.carregar(importacaoId)
    if (registro.status !== 'PREVIA') throw new ErroNegocio('Esta importação já foi confirmada.', 409, 'importacao_confirmada')
    await this.importacoes.atualizarSemana(importacaoId, semanaRef)
    return this.montarPreview({ ...registro, semanaRef }, semanaRef)
  }

  private async alertasAbertos(clienteIds: string[]): Promise<Set<string>> {
    if (clienteIds.length === 0) return new Set()
    const { rows } = await this.banco.pool.query(`SELECT DISTINCT cliente_id, tipo FROM alerta WHERE status <> 'RESOLVIDO' AND cliente_id = ANY($1)`, [clienteIds])
    return new Set(rows.map((r) => `${r.cliente_id}\u0000${r.tipo}`))
  }

  private async carregar(importacaoId: string): Promise<RegistroImportacao> {
    const registro = await this.importacoes.porId(importacaoId)
    if (!registro) throw new ErroNegocio('Importação não encontrada.', 404, 'nao_encontrado')
    return registro
  }

  private async montarPreview(registro: RegistroImportacao, semanaRef: string, substituir = false): Promise<PreviewImportacao> {
    const [porDocumento, configs, planosAtrasados, lim] = await Promise.all([
      this.clientes.mapaPorDocumento(),
      this.configuracoes.listarAlertas(),
      this.planos.contarAtrasados(),
      this.limiares(),
    ])

    // Cliente de cada linha: o dono de qualquer um dos documentos. Documentos
    // que pertencem a clientes DIFERENTES não têm leitura certa — a linha sai
    // da importação com o motivo.
    const linhasComErro = [...registro.linhasComErro]
    const linhas: { linha: LinhaValidada; existente: Cliente | null; documentosNovos: string[] }[] = []
    for (const linha of registro.linhasValidas) {
      const documentos = documentosDaLinha(linha)
      const donos = new Map<string, Cliente>()
      for (const d of documentos) {
        const dono = porDocumento.get(normalizarCnpj(d))
        if (dono) donos.set(dono.id, dono)
      }
      if (donos.size > 1) {
        linhasComErro.push({
          linha: linha.linha,
          erros: [`Os documentos desta linha já pertencem a clientes diferentes no sistema (${[...donos.values()].map((c) => c.nome).join(' e ')}). Corrija na origem.`],
        })
        continue
      }
      const existente = donos.values().next().value ?? null
      linhas.push({ linha, existente, documentosNovos: documentos.filter((d) => !porDocumento.has(normalizarCnpj(d))) })
    }
    linhasComErro.sort((a, b) => a.linha - b.linha)
    // Linhas com documentos diferentes que pertencem ao MESMO cliente (ex.:
    // matriz e filial cadastradas como um cliente) viram uma posição só, a
    // soma delas — o banco aceita uma posição por cliente e semana.
    agruparLinhasDoMesmoCliente(linhas, (d) => !porDocumento.has(normalizarCnpj(d)))

    const idsExistentes = linhas.map((l) => l.existente?.id).filter((id): id is string => Boolean(id))
    const [jaNaSemana, ultimos, restritivosPorCliente] = await Promise.all([
      this.snapshots.clientesComSnapshotNaSemana(idsExistentes, semanaRef),
      // Substituindo, a comparação é com a semana ANTERIOR (a desta semana sai).
      substituir ? this.snapshots.ultimosAntesDe(idsExistentes, semanaRef) : this.snapshots.ultimosPorCliente(idsExistentes),
      this.restritivos.atualEAnterior(idsExistentes, semanaRef),
    ])
    // Alertas que já estão abertos não são criados de novo (a posição
    // substituída já os gerou nesta semana).
    const abertos = substituir ? await this.alertasAbertos(idsExistentes) : new Set<string>()

    const itens: ItemPreviewImportacao[] = linhas.map(({ linha, existente, documentosNovos }) => {
      const jaImportadoNestaSemana = existente ? jaNaSemana.has(existente.id) : false
      const clienteId = existente?.id ?? `__novo__${linha.linha}`
      const snapshotAnterior = existente ? (ultimos.get(existente.id) ?? null) : null
      const parcial = construirSnapshotParcial(linha, semanaRef, clienteId)
      const restAnterior = existente ? (restritivosPorCliente.get(existente.id)?.anterior?.linhas ?? null) : null
      const alertasGerados =
        jaImportadoNestaSemana && !substituir
          ? []
          : avaliarAlertasSnapshot(parcial as SnapshotSemanal, snapshotAnterior, configs, { atual: linha.restritivosPorTipo ?? null, anterior: restAnterior }).filter(
              (a) => !abertos.has(`${clienteId}\u0000${a.tipo}`),
            )
      const riscoAnterior = snapshotAnterior?.riscoCliente ?? null
      const percVencidoAnterior = snapshotAnterior ? percVencido(snapshotAnterior.riscoCliente, snapshotAnterior.vencidoOficial) : null
      const percVencidoNovo = percVencido(linha.riscoCliente, linha.vencidoOficial)

      const avisos = [...(linha.avisos ?? [])]
      if (riscoAnterior !== null && riscoAnterior > 0) {
        const salto = ((linha.riscoCliente - riscoAnterior) / riscoAnterior) * 100
        if (Math.abs(salto) > lim.AVISO_SALTO_RISCO_PERC) {
          avisos.push(
            `Risco ${salto >= 0 ? 'subiu' : 'caiu'} ${Math.abs(salto).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% frente à posição anterior (${formatarMoeda(riscoAnterior)} → ${formatarMoeda(linha.riscoCliente)}). Confira se não é erro de digitação ou de unidade.`,
          )
        }
      }
      if (existente && documentosNovos.length > 0) avisos.push(`Documento(s) novo(s) para este cliente: ${documentosNovos.join(', ')}.`)

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
        avisos,
        documentos: documentosDaLinha(linha),
        documentosNovos: existente ? documentosNovos : [],
        carteira: linha.carteira ?? null,
        linhaValidada: linha,
      }
    })

    const prontos = substituir ? itens : itens.filter((i) => !i.jaImportadoNestaSemana)
    return {
      importacaoId: registro.id,
      nomeArquivo: registro.nomeArquivo,
      semanaRef,
      itens,
      colunasFaltando: registro.colunasFaltando,
      linhasComErro,
      formato: registro.formato,
      observacoes: registro.observacoes,
      totais: {
        totalLinhasValidas: itens.length,
        linhasProntas: prontos.length,
        linhasJaImportadas: itens.length - prontos.length,
        ...(substituir ? { posicoesSubstituidas: itens.filter((i) => i.jaImportadoNestaSemana).length } : {}),
        clientesNovos: prontos.filter((i) => i.novo).length,
        clientesAtualizados: prontos.filter((i) => !i.novo).length,
        deltaRiscoTotal: prontos.reduce((soma, i) => soma + (i.deltaRisco ?? 0), 0),
        clientesComAumentoDeVencido: prontos.filter((i) => i.aumentoVencido).length,
        totalNovosAlertas: prontos.reduce((soma, i) => soma + i.alertasGerados.length, 0),
        planosAtrasadosExistentes: planosAtrasados,
        clientesComMudancaDeStatus: prontos.filter((i) => i.mudouStatus).length,
        linhasComAviso: prontos.filter((i) => i.avisos.length > 0).length,
      },
    }
  }

  async confirmar(importacaoId: string, semanaRef: string, usuario: UsuarioImportacao, opcoes: { substituir?: boolean } = {}): Promise<ResultadoConfirmacaoImportacao> {
    const substituir = opcoes.substituir === true
    const registro = await this.carregar(importacaoId)
    if (registro.status !== 'PREVIA') throw new ErroNegocio('Esta importação já foi confirmada.', 409, 'importacao_confirmada')
    if (registro.colunasFaltando.length > 0) throw new ErroNegocio('A planilha não tem todas as colunas do modelo.', 422, 'colunas_faltando')

    // Prévia recalculada no momento da confirmação: a base pode ter mudado
    // desde que a tela foi aberta, e o que se grava é o que vale AGORA.
    const preview = await this.montarPreview(registro, semanaRef, substituir)
    const prontos = substituir ? preview.itens : preview.itens.filter((i) => !i.jaImportadoNestaSemana)
    if (prontos.length === 0) throw new ErroNegocio('Não há linhas novas para importar nesta semana.', 422, 'nada_a_importar')
    const agora = new Date().toISOString()
    const rotuloUsuario = usuario.nome
    const lim = await this.limiares()

    const resultado = await this.banco.transacao(async (tx) => {
      const travado = await this.importacoes.porId(importacaoId, tx, true)
      if (!travado || travado.status !== 'PREVIA') throw new ErroNegocio('Esta importação já foi confirmada.', 409, 'importacao_confirmada')

      // Passo 1: cadastros de apoio, clientes e documentos.
      const grupoPorLinha = new Map<number, string>()
      const clienteIdPorLinha = new Map<number, string>()
      const responsavelPorCliente = new Map<string, string>()
      // Cadastros de apoio: um acesso ao banco por NOME distinto, não por linha.
      const cacheCadastros = new Map<string, Promise<{ id: string; nome: string }>>()
      const cadastro = (tabela: 'grupo_economico' | 'gerente' | 'plataforma' | 'carteira', nome: string) => {
        const chave = `${tabela}\u0000${nome.trim().toLowerCase()}`
        let r = cacheCadastros.get(chave)
        if (!r) {
          r = this.cadastros.encontrarOuCriar(tabela, nome, tx)
          cacheCadastros.set(chave, r)
        }
        return r
      }
      // Estado dos clientes ANTES desta importação, numa consulta só (sem N+1).
      const anteriorPorCliente = new Map((await this.clientes.listar({}, tx)).map((c) => [c.id, c]))
      let clientesCriados = 0
      for (const item of prontos) {
        const linha = item.linhaValidada
        const grupo = await cadastro('grupo_economico', linha.grupoEconomico)
        const gerente = await cadastro('gerente', linha.gerente)
        const plataforma = await cadastro('plataforma', linha.plataforma)
        const carteira = linha.carteira ? await cadastro('carteira', linha.carteira) : null
        grupoPorLinha.set(item.linha, grupo.id)
        const documentos = documentosDaLinha(linha)

        if (item.novo) {
          const cliente: Cliente = {
            id: novoId('cli'),
            nome: linha.nome,
            cnpj: documentos[0],
            grupoEconomicoId: grupo.id,
            gerenteId: gerente.id,
            plataformaId: plataforma.id,
            carteiraId: carteira?.id ?? CARTEIRA_PADRAO_ID,
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
          await this.clientes.adicionarDocumentos(cliente.id, documentos.slice(1), tx)
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
              carteiraId: carteira?.id ?? null,
            },
            tx,
          )
          if (item.documentosNovos.length > 0) await this.clientes.adicionarDocumentos(item.clienteId, item.documentosNovos, tx)
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
      const clientesPorId = new Map(todos.map((c) => [c.id, c]))
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

      // Passo 3: snapshots (append-only), restritivos por tipo e alertas.
      const idsExistentes = prontos.filter((i) => !i.novo).map((i) => i.clienteId)
      // Substituição (ADR-023): a posição desta semana vai para o histórico e
      // sai, antes de gravar a nova. O banco recusa se o comitê tiver ata.
      let posicoesSubstituidas = 0
      const aSubstituir = substituir ? prontos.filter((i) => i.jaImportadoNestaSemana).map((i) => i.clienteId) : []
      if (aSubstituir.length > 0) {
        const comAta = await tx.query(`SELECT 1 FROM comite WHERE data = $1 AND status = 'REALIZADO' LIMIT 1`, [semanaRef])
        if (comAta.rowCount) throw new ErroNegocio('O comitê desta semana já tem ata: a posição não pode mais ser substituída.', 409, 'posicao_com_ata')
        await tx.query(`SET LOCAL monitoramento.substituicao_posicao = 'on'`)
        await tx.query(
          `INSERT INTO snapshot_semanal_substituido SELECT s.*, now(), $3 FROM snapshot_semanal s WHERE s.semana_ref = $1 AND s.cliente_id = ANY($2)`,
          [semanaRef, aSubstituir, importacaoId],
        )
        await tx.query(
          `INSERT INTO classificacao_semanal_substituida SELECT c.*, now(), $3 FROM classificacao_semanal c WHERE c.semana_ref = $1 AND c.cliente_id = ANY($2)`,
          [semanaRef, aSubstituir, importacaoId],
        )
        await tx.query(`DELETE FROM classificacao_semanal WHERE semana_ref = $1 AND cliente_id = ANY($2)`, [semanaRef, aSubstituir])
        const r = await tx.query(`DELETE FROM snapshot_semanal WHERE semana_ref = $1 AND cliente_id = ANY($2)`, [semanaRef, aSubstituir])
        await tx.query(`SET LOCAL monitoramento.substituicao_posicao = 'off'`)
        posicoesSubstituidas = r.rowCount ?? 0
      }
      const [anterioresSnap, restritivosAntes, apartadas, carteiras] = await Promise.all([
        this.snapshots.ultimosPorCliente(idsExistentes, tx),
        this.restritivos.atualEAnterior(idsExistentes, semanaRef, tx),
        this.cadastros.idsCarteirasApartadas(tx),
        this.cadastros.listarCarteiras(tx),
      ])
      const nomeCarteira = new Map(carteiras.map((c) => [c.id, c.nome]))
      const snapshots: (SnapshotSemanal & { importacaoId: string })[] = []
      const alertas: Omit<Alerta, 'id'>[] = []
      const classificacoes: ClassificacaoSemanal[] = []
      const cadastroClassificado: Pick<Cliente, 'id' | 'prioridade' | 'criticidade'>[] = []
      const eventosCriticidade: Omit<EventoHistorico, 'id'>[] = []
      for (const item of prontos) {
        const clienteId = clienteIdPorLinha.get(item.linha)!
        const grupoId = grupoPorLinha.get(item.linha)!
        const parcial = construirSnapshotParcial(item.linhaValidada, semanaRef, clienteId)
        const snapshot = { id: novoId('snp'), ...parcial, riscoGrupo: arredondarCentavos(riscoPorGrupo.get(grupoId) ?? item.riscoNovo), importacaoId }
        snapshots.push(snapshot)
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

        const porTipo = item.linhaValidada.restritivosPorTipo ?? null
        if (porTipo) await this.restritivos.gravarSemana(clienteId, semanaRef, porTipo, 'IMPORTACAO', rotuloUsuario, tx)

        // Classificação semanal pelas regras da base do comitê.
        const cliente = clientesPorId.get(clienteId)!
        const carteiraId = cliente.carteiraId ?? CARTEIRA_PADRAO_ID
        const restAnterior = restritivosAntes.get(clienteId)?.anterior?.linhas ?? null
        const c = classificarCliente(
          {
            status: item.statusNovo,
            carteiraApartada: apartadas.has(carteiraId),
            nomeCarteira: nomeCarteira.get(carteiraId),
            atual: snapshot,
            anterior: anterioresSnap.get(clienteId) ?? null,
            restritivos: porTipo ? { atual: porTipo, anterior: restAnterior } : undefined,
          },
          lim,
        )
        classificacoes.push({ ...c, clienteId, semanaRef, calculadoEm: agora })
        const criticidade = criticidadeDoCadastro(c.criticidade)
        cadastroClassificado.push({ id: clienteId, prioridade: prioridadeDoCadastro(c.prioridadeOrdem), criticidade })
        const antes = item.novo ? null : anteriorPorCliente.get(clienteId)
        if (antes && antes.criticidade !== criticidade) {
          eventosCriticidade.push({
            clienteId,
            data: agora,
            usuario: rotuloUsuario,
            tipo: 'MUDANCA_CRITICIDADE',
            valorAnterior: antes.criticidade,
            valorNovo: criticidade,
            justificativa: `Classificação semanal de ${semanaRef.split('-').reverse().join('/')}: ${textoAlertas(c)}`.slice(0, 2000),
            decisaoComiteId: null,
          })
        }
      }
      await this.clientes.gravarClassificacoes(cadastroClassificado, tx)
      await this.eventos.registrarMuitos(eventosCriticidade, tx)
      await this.snapshots.inserir(snapshots, tx)
      await this.classificacoes.inserir(classificacoes, tx)
      await this.alertas.criarMuitos(alertas, tx)
      await this.importacoes.confirmar(importacaoId, usuario.id, semanaRef, preview.totais, tx)
      await this.auditoria.registrar(
        {
          acao: 'importacao.confirmada',
          atorId: usuario.id,
          atorEmail: usuario.email,
          recursoTipo: 'importacao',
          recursoId: importacaoId,
          detalhes: { semanaRef, snapshots: snapshots.length, clientesCriados, alertas: alertas.length, classificados: classificacoes.length, posicoesSubstituidas },
        },
        tx,
      )
      return { importacaoId, semanaRef, snapshotsGravados: snapshots.length, clientesCriados, alertasGerados: alertas.length, posicoesSubstituidas }
    }).catch((erro: unknown) => {
      // Defesa final: a trava do banco (uma posição por cliente e semana) não
      // pode chegar ao usuário como "erro inesperado". Nada foi gravado.
      const e = erro as { code?: string; constraint?: string; detail?: string }
      if (e?.code === '23505' && e.constraint === 'snapshot_um_por_semana') {
        const id = /\(cliente_id, semana_ref\)=\(([^,]+),/.exec(e.detail ?? '')?.[1]
        const nome = preview.itens.find((i) => i.clienteId === id)?.nome
        throw new ErroNegocio(
          `${nome ? `O cliente ${nome}` : 'Um dos clientes'} já tem posição gravada nesta semana. Nada foi importado; atualize a prévia e confira as linhas desse cliente.`,
          409,
          'posicao_duplicada_na_semana',
        )
      }
      throw erro
    })
    return resultado
  }
}
