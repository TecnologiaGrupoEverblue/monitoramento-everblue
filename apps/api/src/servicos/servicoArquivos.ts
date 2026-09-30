/**
 * Ciclo de vida completo dos arquivos do Monitoramento.
 *
 * O MinIO guarda TODO arquivo que entra (importados, anexos) ou sai
 * (processados, exportados). Cada arquivo pode ser enviado, versionado,
 * descrito, vinculado, baixado (qualquer versão), arquivado, excluído
 * logicamente, restaurado e, por fim, expurgado — cada passo com trilha própria
 * (`arquivo_evento`) e auditoria.
 *
 * Transições de situação:
 *
 *   ATIVO ⇄ ARQUIVADO
 *   ATIVO | ARQUIVADO → EXCLUIDO → ATIVO        (exclusão lógica, recuperável)
 *   qualquer (exceto EXPURGADO) → EXPURGADO     (conteúdo apagado do MinIO,
 *                                                só admin, com motivo; recusado
 *                                                enquanto houver retenção vigente)
 */
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ArquivoResumo, EventoArquivo, FiltroArquivos, FinalidadeArquivo, PaginaArquivos, SituacaoArquivo, TotaisArquivos, VersaoArquivo } from '@monitoramento/dominio'
import { medirFluxo, type ArmazenamentoArquivos } from '../infra/armazenamento'
import type { Banco } from '../infra/banco'
import { semChave, type ArquivoCompleto, type ArquivoRepositorio } from '../repositorios/arquivoRepositorio'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import { ErroNegocio } from './servicoComite'
import { detectarTipo, extensaoSegura, nomeSeguro } from './tipoArquivo'

export interface Ator {
  id: string
  email: string
}

export interface LimitesArquivos {
  /** null = sem limite de tamanho. */
  maxBytes: number | null
  /** Extensões recusadas (ex.: ".exe"). Vazio = nenhuma. */
  extensoesBloqueadas: string[]
}

export interface DadosEnvio {
  nomeOriginal: string
  finalidade: FinalidadeArquivo
  categoria: string
  descricao?: string | null
  tags?: Record<string, string>
  recursoTipo?: string | null
  recursoId?: string | null
  arquivoOrigemId?: string | null
  retencaoAte?: string | null
}

export interface ConteudoParaDownload {
  fluxo: Readable
  nomeOriginal: string
  mime: string
  tamanhoBytes: number
  sha256: string
  versao: number
}

const PREFIXO: Record<FinalidadeArquivo, string> = {
  importado: 'importados',
  processado: 'processados',
  exportado: 'exportados',
  anexo: 'anexos',
}

const TRANSICOES: Record<SituacaoArquivo, SituacaoArquivo[]> = {
  ATIVO: ['ARQUIVADO', 'EXCLUIDO', 'EXPURGADO'],
  ARQUIVADO: ['ATIVO', 'EXCLUIDO', 'EXPURGADO'],
  EXCLUIDO: ['ATIVO', 'EXPURGADO'],
  EXPURGADO: [],
}

export function slugCategoria(categoria: string): string {
  const s = categoria
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || 'geral'
}

export class ServicoArquivos {
  constructor(
    private readonly banco: Banco,
    private readonly armazenamento: ArmazenamentoArquivos,
    private readonly arquivos: ArquivoRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly limites: LimitesArquivos,
  ) {}

  /** Chave do objeto: gerada pelo sistema, nunca o nome original. */
  chaveObjeto(finalidade: FinalidadeArquivo, categoria: string, arquivoId: string, versao: number, nomeOriginal: string, quando = new Date()): string {
    const mes = String(quando.getUTCMonth() + 1).padStart(2, '0')
    return `${PREFIXO[finalidade]}/${slugCategoria(categoria)}/${quando.getUTCFullYear()}/${mes}/${arquivoId}/v${versao}${extensaoSegura(nomeOriginal)}`
  }

  // ------------------------------------------------------------ entrada

  /** Envio de arquivo de qualquer tamanho, em fluxo. */
  async enviar(fluxo: Readable, dados: DadosEnvio, ator: Ator): Promise<ArquivoResumo> {
    const nome = nomeSeguro(dados.nomeOriginal)
    this.conferirExtensao(nome)
    const id = randomUUID()
    const chave = this.chaveObjeto(dados.finalidade, dados.categoria, id, 1, nome)
    const gravado = await this.gravarMedindo(chave, fluxo, nome, { arquivo: id, versao: '1' })

    await this.compensarSeFalhar(chave, () =>
      this.banco.transacao(async (tx) => {
        if (dados.arquivoOrigemId && !(await this.arquivos.porId(dados.arquivoOrigemId, tx))) {
          throw new ErroNegocio('Arquivo de origem não encontrado.', 404, 'origem_inexistente')
        }
        await this.arquivos.registrar(
          { id, ...dados, nomeOriginal: nome, chaveObjeto: chave, idVersaoMinio: gravado.idVersao, mime: gravado.mime, tamanhoBytes: gravado.tamanhoBytes, sha256: gravado.sha256, criadoPor: ator.id },
          tx,
        )
        await this.auditoria.registrar(
          { acao: 'arquivo.enviado', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'arquivo', recursoId: id, detalhes: { finalidade: dados.finalidade, categoria: dados.categoria, tamanhoBytes: gravado.tamanhoBytes, sha256: gravado.sha256, tipoDivergente: gravado.divergente } },
          tx,
        )
      }),
    )
    return this.obter(id)
  }

  /** Arquivo gerado pelo próprio sistema (exportação, relatório, ata). */
  async guardarGerado(conteudo: Buffer, dados: DadosEnvio, ator: Ator): Promise<ArquivoResumo> {
    return this.enviar(Readable.from([conteudo]), dados, ator)
  }

  async novaVersao(arquivoId: string, fluxo: Readable, nomeOriginal: string, comentario: string | null, ator: Ator): Promise<ArquivoResumo> {
    const atual = await this.exigir(arquivoId)
    this.exigirEmUso(atual)
    const nome = nomeSeguro(nomeOriginal)
    this.conferirExtensao(nome)
    const numero = atual.versaoAtual + 1
    const chave = this.chaveObjeto(atual.finalidade, atual.categoria, arquivoId, numero, nome)
    const gravado = await this.gravarMedindo(chave, fluxo, nome, { arquivo: arquivoId, versao: String(numero) })

    await this.compensarSeFalhar(chave, () =>
      this.banco.transacao(async (tx) => {
        const travado = await this.arquivos.porId(arquivoId, tx, true)
        if (!travado || travado.versaoAtual !== atual.versaoAtual) {
          throw new ErroNegocio('Outra versão foi enviada ao mesmo tempo. Atualize a tela e tente de novo.', 409, 'versao_concorrente')
        }
        const versao = { numero, chaveObjeto: chave, nomeOriginal: nome, mime: gravado.mime, tamanhoBytes: gravado.tamanhoBytes, sha256: gravado.sha256 }
        await this.arquivos.inserirVersao({ arquivoId, ...versao, idVersaoMinio: gravado.idVersao, comentario, criadoPor: ator.id }, tx)
        await this.arquivos.definirVersaoAtual(arquivoId, versao, ator.id, tx)
        await this.arquivos.registrarEvento(arquivoId, 'nova_versao', numero, ator.id, { tamanhoBytes: gravado.tamanhoBytes, comentario }, tx)
        await this.auditoria.registrar({ acao: 'arquivo.nova_versao', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'arquivo', recursoId: arquivoId, detalhes: { versao: numero, sha256: gravado.sha256 } }, tx)
      }),
    )
    return this.obter(arquivoId)
  }

  /** Torna uma versão antiga a atual — como NOVA versão (o histórico nunca
   * é reescrito). */
  async restaurarVersao(arquivoId: string, numero: number, ator: Ator): Promise<ArquivoResumo> {
    const atual = await this.exigir(arquivoId)
    this.exigirEmUso(atual)
    const origem = (await this.arquivos.versoes(arquivoId)).find((v) => v.numero === numero)
    if (!origem) throw new ErroNegocio('Versão não encontrada.', 404, 'versao_inexistente')
    if (numero === atual.versaoAtual) throw new ErroNegocio('Esta já é a versão atual.', 409, 'versao_atual')
    const nova = atual.versaoAtual + 1
    const chave = this.chaveObjeto(atual.finalidade, atual.categoria, arquivoId, nova, origem.nomeOriginal)
    const copia = await this.armazenamento.copiar(origem.chaveObjeto, chave)
    await this.compensarSeFalhar(chave, () =>
      this.banco.transacao(async (tx) => {
        const travado = await this.arquivos.porId(arquivoId, tx, true)
        if (!travado || travado.versaoAtual !== atual.versaoAtual) throw new ErroNegocio('O arquivo mudou enquanto a versão era restaurada. Tente de novo.', 409, 'versao_concorrente')
        const versao = { numero: nova, chaveObjeto: chave, nomeOriginal: origem.nomeOriginal, mime: origem.mime, tamanhoBytes: origem.tamanhoBytes, sha256: origem.sha256 }
        await this.arquivos.inserirVersao({ arquivoId, ...versao, idVersaoMinio: copia.idVersao, comentario: `Restaurada a partir da versão ${numero}.`, criadoPor: ator.id }, tx)
        await this.arquivos.definirVersaoAtual(arquivoId, versao, ator.id, tx)
        await this.arquivos.registrarEvento(arquivoId, 'versao_restaurada', nova, ator.id, { versaoOrigem: numero }, tx)
        await this.auditoria.registrar({ acao: 'arquivo.versao_restaurada', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'arquivo', recursoId: arquivoId, detalhes: { versaoOrigem: numero, novaVersao: nova } }, tx)
      }),
    )
    return this.obter(arquivoId)
  }

  // ------------------------------------------------------------ consulta

  async obter(arquivoId: string): Promise<ArquivoResumo> {
    return semChave(await this.exigir(arquivoId))
  }

  listar(filtro: FiltroArquivos): Promise<PaginaArquivos> {
    return this.arquivos.listar(filtro)
  }

  async versoes(arquivoId: string): Promise<VersaoArquivo[]> {
    await this.exigir(arquivoId)
    return (await this.arquivos.versoes(arquivoId)).map(({ chaveObjeto: _c, idVersaoMinio: _v, ...v }) => v)
  }

  async eventos(arquivoId: string): Promise<EventoArquivo[]> {
    await this.exigir(arquivoId)
    return this.arquivos.eventos(arquivoId)
  }

  categorias(): Promise<string[]> {
    return this.arquivos.categorias()
  }

  totais(): Promise<TotaisArquivos> {
    return this.arquivos.totais()
  }

  /** Conteúdo da versão atual ou de uma versão específica. */
  async baixar(arquivoId: string, numero: number | null, ator: Ator): Promise<ConteudoParaDownload> {
    const arquivo = await this.exigir(arquivoId)
    if (arquivo.situacao === 'EXPURGADO') throw new ErroNegocio('O conteúdo deste arquivo foi expurgado definitivamente.', 410, 'expurgado')
    const alvo = numero ?? arquivo.versaoAtual
    const versao = (await this.arquivos.versoes(arquivoId)).find((v) => v.numero === alvo)
    if (!versao) throw new ErroNegocio('Versão não encontrada.', 404, 'versao_inexistente')
    const { fluxo } = await this.armazenamento.lerFluxo(versao.chaveObjeto, versao.idVersaoMinio)
    await this.arquivos.registrarEvento(arquivoId, 'baixado', alvo, ator.id)
    return { fluxo, nomeOriginal: versao.nomeOriginal, mime: versao.mime, tamanhoBytes: versao.tamanhoBytes, sha256: versao.sha256, versao: alvo }
  }

  // ------------------------------------------------------------ metadados

  async atualizarMetadados(
    arquivoId: string,
    dados: { descricao?: string | null; categoria?: string; tags?: Record<string, string>; retencaoAte?: string | null; recursoTipo?: string | null; recursoId?: string | null },
    ator: Ator,
  ): Promise<ArquivoResumo> {
    const atual = await this.exigir(arquivoId)
    if (atual.situacao === 'EXPURGADO') throw new ErroNegocio('Arquivo expurgado não pode ser alterado.', 409, 'expurgado')
    await this.banco.transacao(async (tx) => {
      await this.arquivos.atualizarMetadados(arquivoId, dados, ator.id, tx)
      await this.arquivos.registrarEvento(arquivoId, 'metadados_alterados', null, ator.id, { campos: Object.keys(dados) }, tx)
      await this.auditoria.registrar({ acao: 'arquivo.metadados', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'arquivo', recursoId: arquivoId, detalhes: { campos: Object.keys(dados) } }, tx)
    })
    return this.obter(arquivoId)
  }

  // ------------------------------------------------------------ situação

  arquivar(arquivoId: string, ator: Ator) {
    return this.mudarSituacao(arquivoId, 'ARQUIVADO', 'arquivado', null, ator)
  }

  /** Volta a ATIVO a partir de ARQUIVADO ou EXCLUIDO. */
  reativar(arquivoId: string, ator: Ator) {
    return this.mudarSituacao(arquivoId, 'ATIVO', 'reativado', null, ator)
  }

  /** Exclusão lógica: some das listas, o conteúdo continua no MinIO e pode
   * voltar com `reativar`. */
  excluir(arquivoId: string, motivo: string, ator: Ator) {
    return this.mudarSituacao(arquivoId, 'EXCLUIDO', 'excluido', motivo, ator)
  }

  /** Expurgo definitivo: apaga do MinIO TODAS as versões (e as versões
   * internas do versionamento). Os metadados e a trilha permanecem. */
  async expurgar(arquivoId: string, motivo: string, ator: Ator): Promise<ArquivoResumo> {
    const atual = await this.exigir(arquivoId)
    this.conferirTransicao(atual.situacao, 'EXPURGADO')
    const hoje = new Date().toISOString().slice(0, 10)
    if (atual.retencaoAte && atual.retencaoAte >= hoje) {
      throw new ErroNegocio(`Arquivo em retenção obrigatória até ${atual.retencaoAte.split('-').reverse().join('/')}. Ajuste a retenção antes de expurgar.`, 409, 'em_retencao')
    }
    const versoes = await this.arquivos.versoes(arquivoId)
    let objetos = 0
    for (const v of versoes) objetos += await this.armazenamento.removerDefinitivo(v.chaveObjeto)
    await this.banco.transacao(async (tx) => {
      await this.arquivos.alterarSituacao(arquivoId, 'EXPURGADO', ator.id, motivo, tx)
      await this.arquivos.registrarEvento(arquivoId, 'expurgado', null, ator.id, { motivo, versoes: versoes.length, objetosRemovidos: objetos }, tx)
      await this.auditoria.registrar(
        { acao: 'arquivo.expurgado', resultado: 'sucesso', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'arquivo', recursoId: arquivoId, motivo, detalhes: { versoes: versoes.length, objetosRemovidos: objetos, sha256: atual.sha256 } },
        tx,
      )
    })
    return this.obter(arquivoId)
  }

  // ------------------------------------------------------------ internos

  private async mudarSituacao(arquivoId: string, destino: SituacaoArquivo, acao: string, motivo: string | null, ator: Ator): Promise<ArquivoResumo> {
    await this.banco.transacao(async (tx) => {
      const atual = await this.arquivos.porId(arquivoId, tx, true)
      if (!atual) throw new ErroNegocio('Arquivo não encontrado.', 404, 'nao_encontrado')
      this.conferirTransicao(atual.situacao, destino)
      await this.arquivos.alterarSituacao(arquivoId, destino, ator.id, motivo, tx)
      await this.arquivos.registrarEvento(arquivoId, acao, null, ator.id, motivo ? { motivo, anterior: atual.situacao } : { anterior: atual.situacao }, tx)
      await this.auditoria.registrar({ acao: `arquivo.${acao}`, atorId: ator.id, atorEmail: ator.email, recursoTipo: 'arquivo', recursoId: arquivoId, motivo, detalhes: { anterior: atual.situacao } }, tx)
    })
    return this.obter(arquivoId)
  }

  private conferirTransicao(de: SituacaoArquivo, para: SituacaoArquivo) {
    if (de === para) throw new ErroNegocio('O arquivo já está nessa situação.', 409, 'mesma_situacao')
    if (!TRANSICOES[de].includes(para)) throw new ErroNegocio(`Não é possível passar de ${de.toLowerCase()} para ${para.toLowerCase()}.`, 409, 'transicao_invalida')
  }

  private exigirEmUso(a: ArquivoCompleto) {
    if (a.situacao !== 'ATIVO' && a.situacao !== 'ARQUIVADO') {
      throw new ErroNegocio('Reative o arquivo antes de alterar o conteúdo.', 409, 'arquivo_fora_de_uso')
    }
  }

  private async exigir(arquivoId: string): Promise<ArquivoCompleto> {
    const a = await this.arquivos.porId(arquivoId)
    if (!a) throw new ErroNegocio('Arquivo não encontrado.', 404, 'nao_encontrado')
    return a
  }

  private conferirExtensao(nome: string) {
    const ext = extensaoSegura(nome)
    if (ext && this.limites.extensoesBloqueadas.includes(ext)) {
      throw new ErroNegocio(`Arquivos ${ext} não são aceitos por política da companhia.`, 415, 'extensao_bloqueada')
    }
  }

  /** Grava em fluxo medindo tamanho e SHA-256 e detectando o tipo real. */
  private async gravarMedindo(chave: string, fluxo: Readable, nome: string, metadados: Record<string, string>) {
    const medido = medirFluxo(fluxo, this.limites.maxBytes)
    let idVersao: string | null
    try {
      ;({ idVersao } = await this.armazenamento.gravarFluxo(chave, medido.fluxo, 'application/octet-stream', metadados))
    } catch (erro) {
      await this.armazenamento.removerDefinitivo(chave).catch(() => 0)
      if ((erro as { code?: string }).code === 'ARQUIVO_GRANDE' || (erro as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new ErroNegocio('O arquivo excede o tamanho máximo permitido.', 413, 'arquivo_grande')
      }
      throw erro
    }
    // O multipart corta o fluxo no limite sem erro: `truncated` denuncia.
    if ((fluxo as Readable & { truncated?: boolean }).truncated) {
      await this.armazenamento.removerDefinitivo(chave).catch(() => 0)
      throw new ErroNegocio('O arquivo excede o tamanho máximo permitido.', 413, 'arquivo_grande')
    }
    const r = medido.resultado()
    const tipo = detectarTipo(r.cabecalho, nome)
    return { idVersao, tamanhoBytes: r.tamanhoBytes, sha256: r.sha256, mime: tipo.mime, divergente: tipo.divergente }
  }

  /** Se o registro no banco falhar, o objeto recém-gravado não pode ficar
   * órfão no bucket. */
  private async compensarSeFalhar<T>(chave: string, acao: () => Promise<T>): Promise<T> {
    try {
      return await acao()
    } catch (erro) {
      await this.armazenamento.removerDefinitivo(chave).catch(() => 0)
      throw erro
    }
  }
}
