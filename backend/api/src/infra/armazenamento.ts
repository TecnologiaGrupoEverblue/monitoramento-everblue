/**
 * Armazenamento de arquivos (MinIO, via API S3).
 *
 * O MinIO é o repositório central dos arquivos IMPORTADOS (planilhas semanais,
 * anexos, evidências) e PROCESSADOS (atas, relatórios, exportações). Não é
 * destino de backup — backup segue o processo corporativo próprio.
 *
 * Regras de negócio dependem só da interface `ArmazenamentoArquivos`. A
 * implementação S3 é trocável por qualquer provedor compatível sem tocar em
 * caso de uso, e a implementação em memória serve aos testes.
 */
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export interface ObjetoArmazenado {
  conteudo: Buffer
  mime: string
}

export interface FluxoArmazenado {
  fluxo: Readable
  tamanhoBytes: number | null
  mime: string
}

export interface ResultadoGravacao {
  /** Id da versão no MinIO (null quando o bucket não versiona). */
  idVersao: string | null
}

/**
 * Contrato de armazenamento — cobre o ciclo de vida inteiro de um arquivo.
 * Nenhuma regra de negócio conhece S3: só esta interface.
 */
export interface ArmazenamentoArquivos {
  /** Garante que o bucket existe, com versionamento (e Object Lock, se pedido
   * na criação). Devolve se o versionamento ficou confirmado. */
  preparar(): Promise<{ versionamento: boolean }>
  /** Conteúdo pequeno já em memória (planilhas, exportações geradas). */
  gravar(chave: string, conteudo: Buffer, mime: string, metadados?: Record<string, string>): Promise<ResultadoGravacao>
  /** Conteúdo de qualquer tamanho, em fluxo (multipart automático). */
  gravarFluxo(chave: string, fluxo: Readable, mime: string, metadados?: Record<string, string>): Promise<ResultadoGravacao>
  ler(chave: string, idVersao?: string | null): Promise<ObjetoArmazenado>
  lerFluxo(chave: string, idVersao?: string | null): Promise<FluxoArmazenado>
  existe(chave: string): Promise<boolean>
  copiar(origem: string, destino: string): Promise<ResultadoGravacao>
  /** Remove o objeto (com versionamento, o MinIO guarda um marcador e a
   * versão anterior continua recuperável). */
  remover(chave: string): Promise<void>
  /** Remove TODAS as versões e marcadores do objeto — irreversível. */
  removerDefinitivo(chave: string): Promise<number>
  verificarDisponibilidade(): Promise<boolean>
}

export interface OpcoesS3 {
  endpoint: string
  regiao: string
  accessKey: string
  secretKey: string
  bucket: string
  objectLock: boolean
}

export class ArmazenamentoS3 implements ArmazenamentoArquivos {
  private readonly cliente: S3Client

  constructor(private readonly opcoes: OpcoesS3) {
    this.cliente = new S3Client({
      endpoint: opcoes.endpoint,
      region: opcoes.regiao,
      forcePathStyle: true,
      credentials: { accessKeyId: opcoes.accessKey, secretAccessKey: opcoes.secretKey },
      maxAttempts: 3,
      requestHandler: { requestTimeout: 30_000, connectionTimeout: 5_000 },
    })
  }

  async preparar(): Promise<{ versionamento: boolean }> {
    const existe = await this.bucketExiste()
    if (!existe) {
      await this.cliente.send(
        new CreateBucketCommand({ Bucket: this.opcoes.bucket, ObjectLockEnabledForBucket: this.opcoes.objectLock || undefined }),
      )
    }
    // Versionamento sempre ligado: um arquivo sobrescrito por engano continua
    // recuperável, e o Object Lock (quando ativo) depende dele. Falhar aqui não
    // impede a subida, mas é reportado alto por quem chama.
    //
    // Em produção quem cria o bucket e liga o versionamento é o `minio-init`,
    // com a credencial raiz. A credencial da aplicação só tem permissão de
    // LER o estado: por isso a consulta vem antes, e a tentativa de ligar só
    // acontece quando ainda não está ligado (desenvolvimento).
    const consultar = async () => {
      const { Status } = await this.cliente.send(new GetBucketVersioningCommand({ Bucket: this.opcoes.bucket }))
      return Status === 'Enabled'
    }
    try {
      if (await consultar()) return { versionamento: true }
      await this.cliente.send(new PutBucketVersioningCommand({ Bucket: this.opcoes.bucket, VersioningConfiguration: { Status: 'Enabled' } }))
      return { versionamento: await consultar() }
    } catch {
      return { versionamento: false }
    }
  }

  async gravar(chave: string, conteudo: Buffer, mime: string, metadados: Record<string, string> = {}): Promise<ResultadoGravacao> {
    const r = await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.opcoes.bucket,
        Key: chave,
        Body: conteudo,
        ContentType: mime,
        ContentLength: conteudo.length,
        Metadata: metadados,
      }),
    )
    return { idVersao: r.VersionId ?? null }
  }

  async gravarFluxo(chave: string, fluxo: Readable, mime: string, metadados: Record<string, string> = {}): Promise<ResultadoGravacao> {
    // Multipart em partes de 16 MB, 4 em paralelo: memória limitada (~64 MB)
    // qualquer que seja o tamanho do arquivo.
    const envio = new Upload({
      client: this.cliente,
      params: { Bucket: this.opcoes.bucket, Key: chave, Body: fluxo, ContentType: mime, Metadata: metadados },
      partSize: 16 * 1024 * 1024,
      queueSize: 4,
      leavePartsOnError: false,
    })
    const r = await envio.done()
    return { idVersao: ('VersionId' in r && r.VersionId) || null }
  }

  async ler(chave: string, idVersao?: string | null): Promise<ObjetoArmazenado> {
    const { fluxo, mime } = await this.lerFluxo(chave, idVersao)
    const partes: Buffer[] = []
    for await (const parte of fluxo) partes.push(Buffer.from(parte as Uint8Array))
    return { conteudo: Buffer.concat(partes), mime }
  }

  async lerFluxo(chave: string, idVersao?: string | null): Promise<FluxoArmazenado> {
    const resposta = await this.cliente.send(new GetObjectCommand({ Bucket: this.opcoes.bucket, Key: chave, VersionId: idVersao ?? undefined }))
    if (!resposta.Body) throw new Error('Objeto sem conteúdo.')
    return { fluxo: resposta.Body as Readable, tamanhoBytes: resposta.ContentLength ?? null, mime: resposta.ContentType ?? 'application/octet-stream' }
  }

  async existe(chave: string): Promise<boolean> {
    try {
      await this.cliente.send(new HeadObjectCommand({ Bucket: this.opcoes.bucket, Key: chave }))
      return true
    } catch (erro) {
      if ((erro as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false
      throw erro
    }
  }

  async copiar(origem: string, destino: string): Promise<ResultadoGravacao> {
    const fonte = `${this.opcoes.bucket}/${origem.split('/').map(encodeURIComponent).join('/')}`
    const r = await this.cliente.send(new CopyObjectCommand({ Bucket: this.opcoes.bucket, Key: destino, CopySource: fonte }))
    return { idVersao: r.VersionId ?? null }
  }

  async remover(chave: string): Promise<void> {
    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.opcoes.bucket, Key: chave }))
  }

  async removerDefinitivo(chave: string): Promise<number> {
    let removidos = 0
    let marcadorChave: string | undefined
    let marcadorVersao: string | undefined
    // Lista paginada de versões e marcadores; a listagem é por PREFIXO, então
    // filtra a chave exata para nunca apagar um objeto vizinho.
    for (;;) {
      let pagina
      try {
        pagina = await this.cliente.send(
          new ListObjectVersionsCommand({ Bucket: this.opcoes.bucket, Prefix: chave, KeyMarker: marcadorChave, VersionIdMarker: marcadorVersao }),
        )
      } catch (erro) {
        // Provedor S3 sem listagem de versões (não é o caso do MinIO).
        const status = (erro as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        if (status === 501 || status === 405 || status === 400) break
        throw erro
      }
      const alvos = [...(pagina.Versions ?? []), ...(pagina.DeleteMarkers ?? [])]
        .filter((v) => v.Key === chave)
        .map((v) => ({ Key: chave, VersionId: v.VersionId ?? undefined }))
      if (alvos.length > 0) {
        await this.cliente.send(new DeleteObjectsCommand({ Bucket: this.opcoes.bucket, Delete: { Objects: alvos, Quiet: true } }))
        removidos += alvos.length
      }
      if (!pagina.IsTruncated) break
      marcadorChave = pagina.NextKeyMarker
      marcadorVersao = pagina.NextVersionIdMarker
    }
    // Bucket sem versionamento: a listagem pode vir vazia — remove direto.
    if (removidos === 0 && (await this.existe(chave))) {
      await this.remover(chave)
      removidos = 1
    }
    return removidos
  }

  async verificarDisponibilidade(): Promise<boolean> {
    try {
      return await this.bucketExiste()
    } catch {
      return false
    }
  }

  private async bucketExiste(): Promise<boolean> {
    try {
      await this.cliente.send(new HeadBucketCommand({ Bucket: this.opcoes.bucket }))
      return true
    } catch (erro) {
      const status = (erro as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404) return false
      throw erro
    }
  }
}

/** Implementação em memória — testes e desenvolvimento sem MinIO. Mesmo
 * contrato da S3, inclusive versões e remoção definitiva. */
export class ArmazenamentoMemoria implements ArmazenamentoArquivos {
  /** Versões por chave; `null` representa um marcador de exclusão. */
  private readonly versoes = new Map<string, ({ id: string } & ObjetoArmazenado | { id: string; marcador: true })[]>()
  private sequencia = 0

  get objetos(): Map<string, ObjetoArmazenado> {
    const atuais = new Map<string, ObjetoArmazenado>()
    for (const [chave, lista] of this.versoes) {
      const ultima = lista[lista.length - 1]
      if (ultima && !('marcador' in ultima)) atuais.set(chave, { conteudo: ultima.conteudo, mime: ultima.mime })
    }
    return atuais
  }

  totalVersoes(chave: string): number {
    return this.versoes.get(chave)?.length ?? 0
  }

  async preparar(): Promise<{ versionamento: boolean }> {
    return { versionamento: true }
  }
  async gravar(chave: string, conteudo: Buffer, mime: string): Promise<ResultadoGravacao> {
    const id = `v${++this.sequencia}`
    this.versoes.set(chave, [...(this.versoes.get(chave) ?? []), { id, conteudo, mime }])
    return { idVersao: id }
  }
  async gravarFluxo(chave: string, fluxo: Readable, mime: string): Promise<ResultadoGravacao> {
    const partes: Buffer[] = []
    for await (const parte of fluxo) partes.push(Buffer.from(parte as Uint8Array))
    return this.gravar(chave, Buffer.concat(partes), mime)
  }
  async ler(chave: string, idVersao?: string | null): Promise<ObjetoArmazenado> {
    const lista = this.versoes.get(chave) ?? []
    const alvo = idVersao ? lista.find((v) => v.id === idVersao) : lista[lista.length - 1]
    if (!alvo || 'marcador' in alvo) throw new Error('Objeto inexistente.')
    return { conteudo: alvo.conteudo, mime: alvo.mime }
  }
  async lerFluxo(chave: string, idVersao?: string | null): Promise<FluxoArmazenado> {
    const o = await this.ler(chave, idVersao)
    return { fluxo: Readable.from([o.conteudo]), tamanhoBytes: o.conteudo.length, mime: o.mime }
  }
  async existe(chave: string): Promise<boolean> {
    return this.objetos.has(chave)
  }
  async copiar(origem: string, destino: string): Promise<ResultadoGravacao> {
    const o = await this.ler(origem)
    return this.gravar(destino, o.conteudo, o.mime)
  }
  async remover(chave: string): Promise<void> {
    const lista = this.versoes.get(chave)
    if (lista) lista.push({ id: `v${++this.sequencia}`, marcador: true })
  }
  async removerDefinitivo(chave: string): Promise<number> {
    const n = this.versoes.get(chave)?.length ?? 0
    this.versoes.delete(chave)
    return n
  }
  async verificarDisponibilidade(): Promise<boolean> {
    return true
  }
}

/** Fluxo que conta bytes e calcula SHA-256 enquanto o conteúdo passa, e
 * guarda os primeiros bytes para detectar o tipo real — sem carregar o
 * arquivo em memória. `limiteBytes` null = sem limite. */
export function medirFluxo(origem: Readable, limiteBytes: number | null) {
  const hash = createHash('sha256')
  let tamanho = 0
  let cabecalho = Buffer.alloc(0)
  let digest: string | null = null
  const medidor = new Transform({
    transform(parte: Buffer, _codificacao, pronto) {
      tamanho += parte.length
      if (limiteBytes !== null && tamanho > limiteBytes) {
        pronto(Object.assign(new Error('O arquivo excede o tamanho máximo permitido.'), { code: 'ARQUIVO_GRANDE' }))
        return
      }
      if (cabecalho.length < 4100) cabecalho = Buffer.concat([cabecalho, parte.subarray(0, 4100 - cabecalho.length)])
      hash.update(parte)
      pronto(null, parte)
    },
  })
  origem.on('error', (e) => medidor.destroy(e))
  origem.pipe(medidor)
  return {
    fluxo: medidor as Readable,
    resultado: () => {
      digest ??= hash.digest('hex')
      return { tamanhoBytes: tamanho, sha256: digest, cabecalho }
    },
  }
}
