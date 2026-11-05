/**
 * Mapa de Garantias (1.2): calculado sobre a base lida na foto do Bitfin e
 * enviado por e-mail. Todos os dias, após a foto agendada: cada responsável
 * (gerente, assistente e superiores do cadastro do cliente no Bitfin) recebe
 * os SEUS clientes; os e-mails em cópia recebem todos.
 *
 * Fail-closed: sem foto do dia, o mapa NÃO sai com dado velho — as cópias
 * recebem o aviso de que a foto falhou. Envio desligado ou com erro fica
 * registrado como tal, nunca como enviado.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  CONFIG_MAPA_PADRAO,
  calcularMapaCliente,
  digitosDocumento,
  montarDestinatarios,
  type DestinatarioMapa,
  type ExecucaoFoto,
  type LinhaMapaGarantia,
  type MapaCalculado,
} from '@monitoramento/dominio'
import type { ArmazenamentoArquivos } from '../infra/armazenamento'
import type { EnviadorEmail } from '../infra/email'
import type { LeitorBitfin } from '../infra/bitfin'
import type { ArquivoRepositorio } from '../repositorios/arquivoRepositorio'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { MapaRepositorio } from '../repositorios/mapaRepositorio'
import { htmlMapa, pdfMapa, textoMapa } from './documentoMapa'
import { ErroNegocio } from './servicoComite'
import { dataLocal, USUARIO_AGENDADOR, type SolicitanteFoto } from './servicoFotoBitfin'

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
/** Datas do Bitfin são locais sem fuso: exibidas como estão. */
const quandoBitfin = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }) : null)

export class ServicoMapaGarantias {
  constructor(
    private readonly mapa: MapaRepositorio,
    private readonly email: EnviadorEmail,
    private readonly armazenamento: ArmazenamentoArquivos,
    private readonly arquivos: ArquivoRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void } = { info: () => {}, error: () => {} },
    private readonly leitor: Pick<LeitorBitfin, 'configurado' | 'buscarNomes'> | null = null,
  ) {}

  /**
   * Inclui um cliente pelo CPF/CNPJ buscando o nome (razão social) no Bitfin
   * — uma consulta pontual, só leitura. Aproveita para preencher o nome de
   * quem ainda estiver sem. Bitfin respondeu e o documento não existe →
   * recusa (evita CNPJ digitado errado). Bitfin fora do ar ou não configurado
   * → inclui com o nome pendente (vem na próxima foto) e avisa.
   */
  async incluirCliente(documento: string, usuarioId: string): Promise<{ situacao: 'INCLUIDO' | 'JA_EXISTIA' | 'NAO_ENCONTRADO'; nome: string | null; aviso: string | null }> {
    const ativos = await this.mapa.clientes()
    if (ativos.some((c) => c.documento === documento)) return { situacao: 'JA_EXISTIA', nome: null, aviso: null }
    const semNome = ativos.filter((c) => !c.nome).map((c) => c.documento)
    let nomes: Map<string, string> | null = null
    let aviso: string | null = null
    if (!this.leitor?.configurado) {
      aviso = 'A conexão com o Bitfin ainda não está configurada: o nome aparece na primeira foto.'
    } else {
      try {
        // Prazos, fila e cancelamento real são do gateway do Bitfin (ADR-020).
        nomes = await this.leitor.buscarNomes([documento, ...semNome], { atorRef: usuarioId })
      } catch (erro) {
        this.log.error({ err: erro }, 'mapa: falha ao buscar o nome no Bitfin')
        aviso = 'Não foi possível consultar o Bitfin agora: o nome aparece na próxima foto.'
      }
    }
    if (nomes && !nomes.has(documento)) return { situacao: 'NAO_ENCONTRADO', nome: null, aviso: null }
    const nome = nomes?.get(documento) ?? null
    const r = await this.mapa.incluirCliente(documento, nome, usuarioId)
    for (const d of semNome) {
      const n = nomes?.get(d)
      if (n) await this.mapa.atualizarNome(d, n)
    }
    return { situacao: r, nome, aviso }
  }

  get envioLigado(): boolean {
    return this.email.ligado
  }

  /** Documentos que a foto deve ler para o mapa. */
  async documentos(): Promise<string[]> {
    return (await this.mapa.clientes()).map((c) => c.documento)
  }

  async calcular(fotoId?: string): Promise<MapaCalculado | null> {
    const [base, clientes, configs] = await Promise.all([this.mapa.fotoMapa(fotoId), this.mapa.clientes(), this.mapa.configs()])
    if (!base) return null
    const hoje = dataLocal(new Date(base.tiradaEm))
    const lidos = new Set(base.documentos.map(digitosDocumento))
    const porDoc = new Map(base.dados.clientes.map((c) => [digitosDocumento(c.documento), c]))
    const linhas: LinhaMapaGarantia[] = []
    const naoEncontrados: string[] = []
    const aguardandoFoto: string[] = []
    for (const c of clientes) {
      if (!lidos.has(c.documento)) {
        aguardandoFoto.push(c.documento)
        continue
      }
      const bitfin = porDoc.get(c.documento)
      if (!bitfin) {
        naoEncontrados.push(c.nome ? `${c.nome} (${c.documento})` : c.documento)
        continue
      }
      const l = calcularMapaCliente(base.dados, bitfin.clienteId, configs.get(c.documento) ?? CONFIG_MAPA_PADRAO, hoje)
      if (l) {
        linhas.push(l)
        if (c.nome !== l.nome) await this.mapa.atualizarNome(c.documento, l.nome)
      }
    }
    linhas.sort((a, b) => a.nome.localeCompare(b.nome))
    return { fotoId: base.fotoId, tiradaEm: base.tiradaEm, apuradoEm: base.apuradoEm, linhas, naoEncontrados, aguardandoFoto }
  }

  /** Envio diário, após a foto agendada (uma vez por dia). */
  async enviarDiario(execucao: ExecucaoFoto): Promise<void> {
    if (!(await this.mapa.envioDiarioAtivo())) return
    // Sem cliente no mapa (ou foto sem a base do mapa): nada a enviar, e o dia não é consumido.
    if (!(await this.mapa.fotoMapa(execucao.id))) return
    if (!(await this.mapa.reservarEnvioDoDia(dataLocal()))) return
    try {
      await this.enviar({ origem: 'AGENDADO', solicitante: USUARIO_AGENDADOR, fotoId: execucao.id })
    } catch (e) {
      // O mapa do dia não saiu (ex.: nenhum cliente encontrado, falha no PDF): as cópias são avisadas.
      this.log.error({ err: e, fotoId: execucao.id }, 'mapa_garantias_envio_diario_falhou')
      await this.avisarFalha(execucao, `O Mapa de Garantias não pôde ser montado: ${(e as Error).message}`, true)
    }
  }

  /** Foto agendada falhou: o mapa do dia não sai; as cópias são avisadas. */
  async avisarFalhaDaFoto(execucao: ExecucaoFoto): Promise<void> {
    if (!(await this.mapa.envioDiarioAtivo())) return
    await this.avisarFalha(execucao, `Foto do Bitfin falhou: ${execucao.mensagem ?? 'sem detalhe'}`, false)
  }

  private async avisarFalha(execucao: ExecucaoFoto, motivo: string, fotoConcluida: boolean): Promise<void> {
    const copias = (await this.mapa.copias()).map((c) => c.email)
    const loteId = randomUUID()
    for (const para of copias) {
      let status: 'ENVIADO' | 'FALHOU' | 'NAO_ENVIADO' = 'NAO_ENVIADO'
      let mensagem = motivo
      if (this.email.ligado) {
        try {
          await this.email.enviar({
            para: [para],
            assunto: fotoConcluida ? 'Mapa de Garantias NÃO enviado hoje' : 'Mapa de Garantias NÃO enviado hoje — foto do Bitfin falhou',
            html: `<p>${fotoConcluida ? `O Mapa de Garantias de hoje (foto de ${quando(execucao.iniciadoEm)}) <strong>não foi enviado</strong>.` : `A foto agendada do Bitfin de ${quando(execucao.iniciadoEm)} não foi concluída, por isso o Mapa de Garantias de hoje <strong>não foi enviado</strong> (o sistema não envia mapa com dado antigo).`}</p><p>Motivo: ${motivo.replace(/[<>&]/g, '')}</p><p>Confira em Monitoramento → Foto do Bitfin e envie o mapa pelo painel do Mapa de Garantias.</p>`,
            texto: `O Mapa de Garantias de hoje não foi enviado. Motivo: ${motivo}`,
            anexos: [],
          })
          status = 'ENVIADO'
          mensagem = 'Aviso de mapa não enviado entregue às cópias.'
        } catch (e) {
          status = 'FALHOU'
          mensagem = `Aviso de falha não enviado: ${(e as Error).message}`.slice(0, 1000)
        }
      }
      await this.mapa.registrarEnvio({ loteId, fotoId: execucao.id, origem: 'AGENDADO', solicitadoPor: USUARIO_AGENDADOR.id, destinatario: para, papeis: ['COPIA'], clientes: [], status, mensagem, arquivoId: null })
    }
  }

  async enviar(p: { origem: 'AGENDADO' | 'MANUAL'; solicitante: SolicitanteFoto; fotoId?: string }): Promise<{ loteId: string; enviados: number; falhas: number; naoEnviados: number }> {
    const mapa = await this.calcular(p.fotoId)
    if (!mapa) throw new ErroNegocio('Nenhuma foto do Bitfin leu o Mapa de Garantias ainda. Inclua os clientes e tire uma foto.', 422, 'mapa_sem_foto')
    if (mapa.linhas.length === 0) throw new ErroNegocio('Nenhum cliente do mapa foi encontrado na foto do Bitfin.', 422, 'mapa_vazio')
    const copias = (await this.mapa.copias()).map((c) => c.email)
    const destinatarios = montarDestinatarios(mapa.linhas, copias)
    const fotoEm = quando(mapa.tiradaEm)
    const apuradoEm = quandoBitfin(mapa.apuradoEm)
    const loteId = randomUUID()

    // PDF consolidado guardado na Central de Arquivos (prova do que foi enviado).
    const pdfTodos = await pdfMapa({ linhas: mapa.linhas, naoEncontrados: mapa.naoEncontrados, fotoEm, apuradoEm })
    const arquivoId = await this.guardarPdf(pdfTodos, p.solicitante.id, loteId, mapa.fotoId)

    let enviados = 0
    let falhas = 0
    let naoEnviados = 0
    for (const d of destinatarios) {
      const linhas = mapa.linhas.filter((l) => d.clientes.includes(digitosDocumento(l.documento)))
      const resultado = await this.enviarPara(d, linhas, d.papeis.includes('COPIA') ? mapa.naoEncontrados : [], fotoEm, apuradoEm)
      if (resultado.status === 'ENVIADO') enviados += 1
      else if (resultado.status === 'FALHOU') falhas += 1
      else naoEnviados += 1
      await this.mapa.registrarEnvio({
        loteId,
        fotoId: mapa.fotoId,
        origem: p.origem,
        solicitadoPor: p.solicitante.id,
        destinatario: d.email,
        papeis: d.papeis,
        clientes: d.clientes,
        status: resultado.status,
        mensagem: resultado.mensagem,
        arquivoId,
      })
    }
    await this.auditoria.registrar({
      acao: 'mapa.enviado',
      atorId: p.solicitante.id,
      atorEmail: p.solicitante.email,
      recursoTipo: 'mapa_garantias',
      recursoId: loteId,
      detalhes: { origem: p.origem, fotoId: mapa.fotoId, destinatarios: destinatarios.length, enviados, falhas, naoEnviados, transporte: this.email.descricao },
    })
    this.log.info({ loteId, enviados, falhas, naoEnviados }, 'mapa_garantias_enviado')
    return { loteId, enviados, falhas, naoEnviados }
  }

  private async enviarPara(d: DestinatarioMapa, linhas: LinhaMapaGarantia[], naoEncontrados: string[], fotoEm: string, apuradoEm: string | null) {
    if (!this.email.ligado) return { status: 'NAO_ENVIADO' as const, mensagem: 'Envio de e-mail não configurado no servidor.' }
    try {
      const pdf = await pdfMapa({ linhas, naoEncontrados, fotoEm, apuradoEm })
      await this.email.enviar({
        para: [d.email],
        assunto: `Mapa de Garantias — ${fotoEm.slice(0, 10)}${linhas.length === 1 ? ` — ${linhas[0].nome}` : ` — ${linhas.length} clientes`}`,
        html: htmlMapa({ linhas, naoEncontrados, fotoEm, apuradoEm, destinatario: d.email }),
        texto: textoMapa({ linhas, fotoEm }),
        anexos: [{ nome: `mapa-de-garantias-${fotoEm.slice(0, 10).split('/').reverse().join('-')}.pdf`, conteudo: pdf, tipo: 'application/pdf' }],
      })
      return { status: 'ENVIADO' as const, mensagem: null }
    } catch (e) {
      // Sem o e-mail do destinatário no log (dado pessoal): ele fica no registro do envio.
      this.log.error({ err: e }, 'mapa_garantias_envio_falhou')
      return { status: 'FALHOU' as const, mensagem: (e as Error).message.slice(0, 1000) }
    }
  }

  private async guardarPdf(pdf: Buffer, usuarioId: string, loteId: string, fotoId: string): Promise<string> {
    const id = randomUUID()
    const agora = new Date()
    const chave = `processados/mapa-garantias/${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, '0')}/${id}.pdf`
    const sha256 = createHash('sha256').update(pdf).digest('hex')
    const { idVersao } = await this.armazenamento.gravar(chave, pdf, 'application/pdf', { sha256, 'mapa-lote': loteId })
    await this.arquivos.registrar({
      id,
      finalidade: 'processado',
      categoria: 'mapa-garantias',
      chaveObjeto: chave,
      idVersaoMinio: idVersao,
      nomeOriginal: `mapa-de-garantias-${dataLocal(agora)}.pdf`,
      mime: 'application/pdf',
      tamanhoBytes: pdf.length,
      sha256,
      criadoPor: usuarioId,
      descricao: `Mapa de Garantias enviado (foto ${fotoId})`,
      recursoTipo: 'mapa_garantias',
      recursoId: loteId,
    })
    return id
  }

  /** PDF do mapa completo para baixar pela tela (sem enviar). */
  async pdf(fotoId?: string): Promise<{ nome: string; conteudo: Buffer }> {
    const mapa = await this.calcular(fotoId)
    if (!mapa) throw new ErroNegocio('Nenhuma foto do Bitfin leu o Mapa de Garantias ainda.', 422, 'mapa_sem_foto')
    const fotoEm = quando(mapa.tiradaEm)
    return { nome: `mapa-de-garantias-${dataLocal(new Date(mapa.tiradaEm))}.pdf`, conteudo: await pdfMapa({ linhas: mapa.linhas, naoEncontrados: mapa.naoEncontrados, fotoEm, apuradoEm: quandoBitfin(mapa.apuradoEm) }) }
  }
}
