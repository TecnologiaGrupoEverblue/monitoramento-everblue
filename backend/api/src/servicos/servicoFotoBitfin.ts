/**
 * Foto do Bitfin (ADR-013/014, versão 1.2).
 *
 * Uma execução = UMA leitura do Bitfin (somente leitura), gravada inteira na
 * base do Monitoramento e comparada com a foto anterior. Telas, comparações e
 * histórico usam a base do Monitoramento, nunca o Bitfin ao vivo.
 *
 * Fail-closed: leitura que falha, situação/documento desconhecido ou linha
 * que não passa na validação da importação → a foto inteira é RECUSADA e
 * nada é gravado na posição. Nunca uma foto parcial.
 *
 * Posição do comitê (snapshot): só quando pedido (botão com a opção marcada
 * ou dia configurado no agendador). Vai pelo MESMO caminho da importação
 * semanal (prévia → confirmação), com a semana de referência = próximo
 * comitê planejado. Uma posição por cliente e semana continua valendo.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  montarFoto,
  normalizarCnpj,
  validarLinhasPlanilha,
  VERSAO_REGRAS_FOTO,
  type ComparacaoClienteFoto,
  type ComparacaoFoto,
  type DadosMapaBitfin,
  type DetalheClienteFoto,
  type LinhaValidada,
} from '@monitoramento/dominio'
import type { LeitorBitfin } from '../infra/bitfin'
import type { ArmazenamentoArquivos } from '../infra/armazenamento'
import type { ArquivoRepositorio } from '../repositorios/arquivoRepositorio'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { ClassificacaoRepositorio } from '../repositorios/classificacaoRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { ComiteRepositorio } from '../repositorios/comiteRepositorio'
import { ErroFotoEmAndamento, type ClienteFoto, type ExecucaoFoto, type FotoRepositorio, type OrigemFoto, type PosicaoSemanalFoto } from '../repositorios/fotoRepositorio'
import type { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'
import { ErroBitfin } from '../infra/gatewayLegado'
import { ErroNegocio } from './servicoComite'
import type { ServicoImportacao } from './servicoImportacao'

/** Autor das fotos agendadas (migração 0008). */
export const USUARIO_AGENDADOR = { id: '00000000-0000-4000-8000-00000000f070', nome: 'Agendador do Monitoramento', email: 'agendador@monitoramento.local' }

export const FUSO = 'America/Sao_Paulo'

export interface SolicitanteFoto {
  id: string
  nome: string
  email: string
}

/** Data local (America/Sao_Paulo) no formato yyyy-MM-dd. */
export function dataLocal(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
  return p
}

/** Hora local (America/Sao_Paulo) em minutos desde a meia-noite e dia da semana (0 = domingo). */
export function horaLocal(agora: Date = new Date()): { minutos: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(agora)
  const valor = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { minutos: Number(valor('hour')) * 60 + Number(valor('minute')), diaSemana: dias.indexOf(valor('weekday')) }
}

export class ServicoFotoBitfin {
  /** Executada ao fim de cada foto agendada CONCLUÍDA (ex.: Mapa de Garantias). */
  private readonly aposAgendada: ((execucao: ExecucaoFoto) => Promise<void>)[] = []
  /** Executada quando a foto agendada FALHA (ex.: avisar que o mapa não saiu). */
  private readonly falhaAgendada: ((execucao: ExecucaoFoto) => Promise<void>)[] = []

  constructor(
    private readonly leitor: LeitorBitfin,
    private readonly fotos: FotoRepositorio,
    private readonly importacao: ServicoImportacao,
    private readonly clientes: ClienteRepositorio,
    private readonly snapshots: SnapshotRepositorio,
    private readonly comites: ComiteRepositorio,
    private readonly classificacoes: ClassificacaoRepositorio,
    private readonly armazenamento: ArmazenamentoArquivos,
    private readonly arquivos: ArquivoRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void } = { info: () => {}, error: () => {} },
    /** Mapa de Garantias: documentos a ler e onde guardar a base lida. */
    private readonly mapa?: { documentos(): Promise<string[]>; gravar(fotoId: string, documentos: string[], dados: DadosMapaBitfin): Promise<void> },
  ) {}

  /** Após a foto agendada que leu o Bitfin (concluída ou recusada na parte de risco). */
  aoConcluirAgendada(acao: (execucao: ExecucaoFoto) => Promise<void>): void {
    this.aposAgendada.push(acao)
  }

  aoFalharAgendada(acao: (execucao: ExecucaoFoto) => Promise<void>): void {
    this.falhaAgendada.push(acao)
  }

  private async aposExecucao(execucao: ExecucaoFoto): Promise<ExecucaoFoto> {
    if (execucao.origem !== 'AGENDADA') return execucao
    const acoes = execucao.status === 'FALHOU' ? this.falhaAgendada : this.aposAgendada
    for (const acao of acoes) await acao(execucao).catch((e) => this.log.error({ err: e, fotoId: execucao.id }, 'foto_bitfin_pos_agendada_erro'))
    return execucao
  }

  get configurado(): boolean {
    return this.leitor.configurado
  }

  /** Abre a execução e roda em segundo plano; devolve o id para a tela acompanhar. */
  async solicitar(p: { origem: OrigemFoto; solicitante: SolicitanteFoto; gravarPosicao: boolean }): Promise<string> {
    if (!this.leitor.configurado) {
      throw new ErroNegocio('A conexão com o Bitfin não está configurada no servidor. Peça à TI para preencher BITFIN_SERVIDOR, BITFIN_USUARIO e BITFIN_SENHA.', 503, 'bitfin_nao_configurado')
    }
    let id: string
    try {
      id = await this.fotos.iniciar({ origem: p.origem, solicitadoPor: p.solicitante.id, gravarPosicao: p.gravarPosicao, versaoRegras: VERSAO_REGRAS_FOTO })
    } catch (e) {
      if (e instanceof ErroFotoEmAndamento) throw new ErroNegocio('Já existe uma foto do Bitfin em andamento. Aguarde terminar.', 409, 'foto_em_andamento')
      throw e
    }
    await this.auditoria.registrar({
      acao: 'foto.solicitada',
      atorId: p.solicitante.id,
      atorEmail: p.solicitante.email,
      recursoTipo: 'foto_bitfin',
      recursoId: id,
      detalhes: { origem: p.origem, gravarPosicao: p.gravarPosicao },
    })
    void this.executar(id, p).catch((e) => this.log.error({ err: e, fotoId: id }, 'foto_bitfin_erro_inesperado'))
    return id
  }

  /** Execução completa (exposta para os testes e para o agendador aguardar). */
  async executar(id: string, p: { origem: OrigemFoto; solicitante: SolicitanteFoto; gravarPosicao: boolean }): Promise<ExecucaoFoto> {
    const inicio = Date.now()
    let posicaoGravadaPara: string | null = null
    try {
      const documentosMapa = this.mapa ? await this.mapa.documentos() : []
      const leitura = await this.leitor.ler({ documentosMapa }, { atorRef: p.solicitante.id, correlationId: id })
      const dados = leitura.dados

      // JSON bruto da leitura no MinIO, ANTES de qualquer gravação: prova de
      // auditoria do dado que gerou (ou não) a posição.
      const bruto = Buffer.from(JSON.stringify(leitura.mapa ? { ...dados, mapaGarantias: leitura.mapa } : dados))
      const sha256 = createHash('sha256').update(bruto).digest('hex')
      const arquivoId = randomUUID()
      const agora = new Date()
      const chave = `importados/foto-bitfin/${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, '0')}/${arquivoId}.json`
      const { idVersao } = await this.armazenamento.gravar(chave, bruto, 'application/json', { sha256, 'foto-bitfin': id })
      await this.arquivos.registrar({
        id: arquivoId,
        finalidade: 'importado',
        categoria: 'foto-bitfin',
        chaveObjeto: chave,
        idVersaoMinio: idVersao,
        nomeOriginal: `foto-bitfin-${dados.lidoEm.slice(0, 19).replace(/[:T]/g, '-')}.json`,
        mime: 'application/json',
        tamanhoBytes: bruto.length,
        sha256,
        criadoPor: p.solicitante.id,
        descricao: `Foto do Bitfin (${p.origem === 'AGENDADA' ? 'agendada' : 'manual'})`,
        recursoTipo: 'foto_bitfin',
        recursoId: id,
      })

      // Base do Mapa de Garantias: gravada mesmo se a parte de risco for recusada.
      if (this.mapa && leitura.mapa) await this.mapa.gravar(id, documentosMapa, leitura.mapa)

      // Restritivos continuam manuais: a foto repete a última quantidade gravada.
      const porDocumento = await this.clientes.mapaPorDocumento()
      const ids = [...new Set([...porDocumento.values()].map((c) => c.id))]
      const ultimos = await this.snapshots.ultimosPorCliente(ids)
      const restritivosAnteriores = new Map<string, number>()
      for (const [doc, cliente] of porDocumento) {
        const s = ultimos.get(cliente.id)
        if (s) restritivosAnteriores.set(doc, s.restritivos)
      }

      const foto = montarFoto(dados, { restritivosAnteriores, hoje: dataLocal(new Date(dados.lidoEm)) })
      const regras = await this.classificacoes.listarRegras()
      const valorSimbolico = regras.find((r) => r.chave === 'AVISO_VALOR_SIMBOLICO')?.valor
      const validacao = validarLinhasPlanilha(foto.linhas, { agingDerivadoDoVencido: true, ...(valorSimbolico !== undefined ? { valorSimbolico } : {}) })
      const recusas = [...foto.recusas, ...validacao.colunasFaltando.map((c) => `Coluna ausente na montagem: ${c}`)]
      for (const e of validacao.comErro) {
        const nome = (foto.linhas[e.linha - 1]?.[0] as string | undefined) ?? `linha ${e.linha}`
        recusas.push(`${nome}: ${e.erros.join(' ')}`)
      }
      const apurado = dados.clientes.map((c) => c.dataApuracaoLiquidez).filter(Boolean).sort().at(-1) ?? null
      const base = {
        arquivoId,
        bitfinLidoEm: dados.lidoEm,
        bitfinApuradoEm: apurado,
        clientes: foto.detalhes.length,
        divergencias: foto.divergencias,
        temposMs: { ...leitura.tempoMs, total: Date.now() - inicio },
      }

      if (recusas.length > 0) {
        await this.fotos.concluir(id, {
          ...base,
          status: 'RECUSADA',
          recusas,
          totais: foto.totais,
          posicaoSemanal: p.gravarPosicao ? 'NAO_GRAVADA' : 'NAO_SOLICITADA',
          mensagem: 'Foto recusada: o Bitfin devolveu dado incompleto ou fora do esperado. Nada foi gravado na posição.',
        })
        await this.auditar('foto.recusada', id, p.solicitante, { recusas: recusas.slice(0, 50) })
        return this.aposExecucao((await this.fotos.porId(id))!)
      }

      // Posição e detalhe de cada cliente da foto, gravados ANTES da posição do
      // comitê: se algo falhar depois, nada fica pela metade (a posição é uma
      // transação; a foto sem posição fica registrada como falha). Cliente novo
      // é ligado pelo documento na leitura.
      const mapa = await this.clientes.mapaPorDocumento()
      const linhaPorDoc = new Map<string, LinhaValidada>(validacao.validas.map((l) => [normalizarCnpj(l.cnpj), l]))
      const registros: ClienteFoto[] = foto.detalhes.map((d: DetalheClienteFoto) => {
        const doc = normalizarCnpj(d.documento)
        const linha = linhaPorDoc.get(doc)!
        return {
          fotoId: id,
          bitfinClienteId: d.bitfinClienteId,
          clienteId: mapa.get(doc)?.id ?? null,
          documento: d.documento,
          nome: d.nome,
          status: linha.status,
          risco: linha.riscoCliente,
          linha,
          detalhe: d,
        }
      })
      await this.fotos.inserirClientes(registros)

      // Posição do comitê (snapshot), quando pedida — mesmo caminho da importação.
      let posicaoSemanal: PosicaoSemanalFoto = 'NAO_SOLICITADA'
      let semanaRef: string | null = null
      let importacaoId: string | null = null
      let mensagem: string | null = null
      let snapshots = 0
      let alertas = 0
      if (p.gravarPosicao) {
        semanaRef = (await this.comites.proximoPlanejado())?.data ?? dataLocal()
        const preview = await this.importacao.registrarFoto({
          arquivoId,
          semanaRef,
          validas: validacao.validas,
          comErro: [],
          observacoes: [`Foto do Bitfin ${id}`, ...foto.divergencias.map((d) => `${d.nome} — ${d.campo}: ${d.mensagem}`)].slice(0, 200),
          usuarioId: p.solicitante.id,
          // A última foto gravada vale até a ata do comitê (ADR-023).
          substituir: true,
        })
        importacaoId = preview.importacaoId
        if (preview.linhasComErro.length > 0) {
          posicaoSemanal = 'NAO_GRAVADA'
          mensagem = `Posição não gravada: ${preview.linhasComErro.map((l) => l.erros.join(' ')).join(' | ')}`
        } else if (preview.totais.linhasProntas === 0) {
          posicaoSemanal = 'JA_EXISTIA'
          mensagem = `Todos os clientes já têm posição gravada para ${semanaRef.split('-').reverse().join('/')}. A foto ficou no histórico.`
        } else {
          const r = await this.importacao.confirmar(preview.importacaoId, semanaRef, p.solicitante, { substituir: true }).catch((e: unknown) => {
            // Comitê da semana com ata: a posição está travada, a foto fica no histórico.
            if (e instanceof ErroNegocio && e.codigo === 'posicao_com_ata') return null
            throw e
          })
          if (!r) {
            posicaoSemanal = 'JA_EXISTIA'
            mensagem = `O comitê de ${semanaRef.split('-').reverse().join('/')} já tem ata: a posição está travada e a foto ficou no histórico.`
          } else {
            posicaoGravadaPara = semanaRef
            posicaoSemanal = 'GRAVADA'
            snapshots = r.snapshotsGravados
            alertas = r.alertasGerados
            if (r.posicoesSubstituidas) mensagem = `${r.posicoesSubstituidas} cliente(s) já tinham posição em ${semanaRef.split('-').reverse().join('/')}: substituída por esta foto (a anterior fica no histórico).`
          }
        }
      }

      await this.fotos.concluir(id, {
        ...base,
        status: 'CONCLUIDA',
        totais: { ...foto.totais, snapshots, alertas },
        semanaRef,
        posicaoSemanal,
        importacaoId,
        mensagem,
      })
      await this.auditar('foto.concluida', id, p.solicitante, { clientes: registros.length, posicaoSemanal, semanaRef, snapshots, divergencias: foto.divergencias.length })
      this.log.info({ fotoId: id, clientes: registros.length, posicaoSemanal, ms: Date.now() - inicio }, 'foto_bitfin_concluida')
      return this.aposExecucao((await this.fotos.porId(id))!)
    } catch (e) {
      // Ao usuário, só a mensagem do catálogo + código e etapa (para cruzar com o
      // log do servidor); o texto do driver fica apenas no log (ADR-020).
      const base =
        e instanceof ErroNegocio
          ? e.message
          : e instanceof ErroBitfin
            ? `Falha na foto do Bitfin: ${e.message} (${e.codigo}${e.etapa ? `, etapa ${e.etapa}` : ''})`
            : 'Falha na foto do Bitfin: erro interno ao processar a leitura (detalhe no log do servidor).'
      const msg = (posicaoGravadaPara ? `A posição do comitê de ${posicaoGravadaPara.split('-').reverse().join('/')} FOI gravada; a falha ocorreu depois. ${base}` : base).slice(0, 2000)
      await this.fotos.concluir(id, { status: 'FALHOU', mensagem: msg, temposMs: { total: Date.now() - inicio } }).catch(() => {})
      await this.auditar('foto.falhou', id, p.solicitante, { mensagem: msg }).catch(() => {})
      this.log.error({ err: e, fotoId: id }, 'foto_bitfin_falhou')
      return this.aposExecucao((await this.fotos.porId(id))!)
    }
  }

  private auditar(acao: string, id: string, ator: SolicitanteFoto, detalhes: Record<string, unknown>) {
    return this.auditoria.registrar({ acao, atorId: ator.id, atorEmail: ator.email, recursoTipo: 'foto_bitfin', recursoId: id, detalhes })
  }

  /** Comparação de uma foto com a anterior (cliente a cliente). */
  async comparar(fotoId: string): Promise<ComparacaoFoto> {
    const foto = await this.fotos.porId(fotoId)
    if (!foto) throw new ErroNegocio('Foto não encontrada.', 404, 'nao_encontrado')
    const anterior = foto.fotoAnteriorId ? await this.fotos.porId(foto.fotoAnteriorId) : null
    const [atuais, antes] = await Promise.all([this.fotos.clientesDaFoto(foto.id), anterior ? this.fotos.clientesDaFoto(anterior.id) : Promise.resolve([])])
    const antesPorDoc = new Map(antes.map((c) => [normalizarCnpj(c.documento), c]))
    const vistos = new Set<string>()
    const lista: ComparacaoClienteFoto[] = atuais.map((c) => {
      const doc = normalizarCnpj(c.documento)
      vistos.add(doc)
      const a = antesPorDoc.get(doc)
      return {
        clienteId: c.clienteId,
        documento: c.documento,
        nome: c.nome,
        status: c.status,
        statusAnterior: a?.status ?? null,
        risco: c.risco,
        riscoAnterior: a?.risco ?? null,
        vencido: c.linha.vencidoOficial,
        vencidoAnterior: a?.linha.vencidoOficial ?? null,
        il30: c.linha.il30,
        il30Anterior: a ? a.linha.il30 : null,
        limite: c.linha.limiteGlobal,
        emAndamento: c.linha.valorEmAndamento,
        prazoMedio: c.detalhe.prazoMedio.dias,
        eventos: c.detalhe.eventos.length,
        situacao: a ? 'MANTIDO' : 'NOVO',
      }
    })
    for (const [doc, a] of antesPorDoc) {
      if (vistos.has(doc)) continue
      lista.push({
        clienteId: a.clienteId,
        documento: a.documento,
        nome: a.nome,
        status: 'FORA DA FOTO',
        statusAnterior: a.status,
        risco: 0,
        riscoAnterior: a.risco,
        vencido: 0,
        vencidoAnterior: a.linha.vencidoOficial,
        il30: null,
        il30Anterior: a.linha.il30,
        limite: 0,
        emAndamento: 0,
        prazoMedio: null,
        eventos: 0,
        situacao: 'SAIU',
      })
    }
    lista.sort((x, y) => y.risco - x.risco || x.nome.localeCompare(y.nome))
    return { foto, anterior, clientes: lista }
  }
}

/**
 * Agendador da foto: verifica a cada minuto se é hora (horário e dias
 * configurados, fuso America/Sao_Paulo). A reserva do dia é atômica no banco
 * — com mais de uma réplica, só uma executa. Se o serviço estava parado no
 * horário, a foto do dia roda assim que ele voltar (no mesmo dia).
 */
export class AgendadorFoto {
  private timer: NodeJS.Timeout | null = null
  private rodando = false

  constructor(
    private readonly servico: ServicoFotoBitfin,
    private readonly fotos: FotoRepositorio,
    private readonly log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
    private readonly intervaloMs = 60_000,
    /** Expurgo diário das fotos de teste (ADR-021); independe do Bitfin. */
    private readonly expurgo: { talvezExecutar: (agora: Date) => Promise<unknown> } | null = null,
  ) {}

  iniciar(): void {
    if (this.timer) return
    // Execução que ficou pendurada por reinício libera a próxima.
    void this.fotos.encerrarInterrompidas(30).catch((e) => this.log.error({ err: e }, 'foto_bitfin_encerrar_interrompidas'))
    this.timer = setInterval(() => void this.verificar(), this.intervaloMs)
    this.timer.unref()
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Uma verificação (exposta para teste). Devolve o id da foto disparada, se houver. */
  async verificar(agora: Date = new Date()): Promise<string | null> {
    if (this.expurgo) await this.expurgo.talvezExecutar(agora).catch((e) => this.log.error({ err: e }, 'foto_expurgo_erro'))
    if (this.rodando || !this.servico.configurado) return null
    this.rodando = true
    try {
      // Execução pendurada por queda do serviço não pode bloquear as próximas.
      await this.fotos.encerrarInterrompidas(30)
      const ag = await this.fotos.agendamento()
      if (!ag.ativo) return null
      const { minutos, diaSemana } = horaLocal(agora)
      const [h, m] = ag.horario.split(':').map(Number)
      if (!ag.diasSemana.includes(diaSemana) || minutos < h * 60 + m) return null
      if (!(await this.fotos.reservarExecucaoDoDia(dataLocal(agora)))) return null
      let id: string
      try {
        id = await this.servico.solicitar({
          origem: 'AGENDADA',
          solicitante: { ...USUARIO_AGENDADOR },
          gravarPosicao: ag.diaPosicaoSemanal === diaSemana,
        })
      } catch (e) {
        // Não abriu (ex.: foto manual em andamento): devolve o dia e tenta no próximo minuto.
        await this.fotos.liberarExecucaoDoDia(ag.ultimaExecucaoEm)
        throw e
      }
      this.log.info({ fotoId: id }, 'foto_bitfin_agendada_disparada')
      return id
    } catch (e) {
      this.log.error({ err: e }, 'foto_bitfin_agendador_erro')
      return null
    } finally {
      this.rodando = false
    }
  }
}
