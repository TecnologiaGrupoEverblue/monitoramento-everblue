/** Comitês e atas. A ata é compilada a partir das decisões registradas (planos
 * de ação com este comitê como origem) e fica imutável depois de gerada. */
import { addDays, addWeeks, format } from 'date-fns'
import {
  CARTEIRA_PADRAO_ID,
  compararRestritivos,
  formatarMoeda,
  descreverVariacao,
  semanaAnteriorRef,
  TIPOS_ALERTA,
  textoAlertas,
  ROTULO_CRITICIDADE_CLASSIFICADA,
  ROTULO_ENQUADRAMENTO,
  type Ata,
  type Comite,
  type ItemPauta,
  type MotivoPauta,
  type PautaComite,
} from '@monitoramento/dominio'
import type { Banco } from '../infra/banco'
import type { AlertaRepositorio } from '../repositorios/alertaRepositorio'
import type { CadastrosRepositorio } from '../repositorios/cadastrosRepositorio'
import { novoId } from '../repositorios/cadastrosRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { ComiteRepositorio } from '../repositorios/comiteRepositorio'
import type { PlanoAcaoRepositorio } from '../repositorios/planoAcaoRepositorio'
import type { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'
import type { ServicoCarteira } from './servicoCarteira'
import type { ClassificacaoRepositorio } from '../repositorios/classificacaoRepositorio'
import type { ChecklistRepositorio } from '../repositorios/checklistRepositorio'
import type { EventoRepositorio } from '../repositorios/eventoRepositorio'
import type { PosicaoRestritivos, RestritivoRepositorio } from '../repositorios/restritivoRepositorio'
import { hojeSaoPaulo } from './servicoPlanos'

export class ErroNegocio extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly codigo = 'regra_de_negocio',
  ) {
    super(message)
    this.name = 'ErroNegocio'
  }
}

export class ServicoComite {
  constructor(
    private readonly banco: Banco,
    private readonly comites: ComiteRepositorio,
    private readonly planos: PlanoAcaoRepositorio,
    private readonly clientes: ClienteRepositorio,
    private readonly alertas: AlertaRepositorio,
    private readonly snapshots: SnapshotRepositorio,
    private readonly cadastros: CadastrosRepositorio,
    private readonly carteira: ServicoCarteira,
    private readonly classificacoes: ClassificacaoRepositorio,
    private readonly checklist: ChecklistRepositorio,
    private readonly eventos: EventoRepositorio,
    private readonly restritivos: RestritivoRepositorio,
  ) {}

  /** Posição da carteira que o comitê analisa: a última semana importada até
   * a data do comitê (ou a última disponível). */
  private posicaoDoComite(semanas: string[], dataComite: string): string | null {
    const ate = semanas.filter((s) => s <= dataComite)
    return ate[ate.length - 1] ?? semanas[semanas.length - 1] ?? null
  }

  /**
   * Pauta automática do próximo comitê. Entra sozinho, sem ninguém lembrar:
   * plano atrasado ou vencendo até a data do comitê, cliente crítico na
   * classificação, alerta vermelho novo, piora de restritivos e mudança de
   * status desde o último comitê. Carteiras apartadas ficam fora.
   */
  async pauta(): Promise<PautaComite> {
    const comite = await this.garantirProximoPlanejado()
    const [todosComites, planos, clientes, apartadas, alertas, semanas, classificacoes] = await Promise.all([
      this.comites.listar(),
      this.planos.listarTodos(),
      this.clientes.listar(),
      this.cadastros.idsCarteirasApartadas(),
      this.alertas.abertos(),
      this.snapshots.semanasDisponiveis(),
      this.classificacoes.ultimas(),
    ])
    const realizados = todosComites.filter((c) => c.status === 'REALIZADO').map((c) => c.data).sort()
    const desde = realizados[realizados.length - 1] ?? null
    const inicio = desde ?? hojeSaoPaulo(new Date(Date.now() - 7 * 86_400_000))
    const elegiveis = new Map(clientes.filter((c) => !apartadas.has(c.carteiraId ?? CARTEIRA_PADRAO_ID)).map((c) => [c.id, c]))
    const posicao = this.posicaoDoComite(semanas, comite.data)
    const [snaps, mudancas] = await Promise.all([
      posicao ? this.snapshots.porSemanas([posicao], [...elegiveis.keys()]) : Promise.resolve([]),
      this.eventos.mudancasDeStatusDesde([...elegiveis.keys()], inicio),
    ])
    const riscoPorCliente = new Map(snaps.map((s) => [s.clienteId, s.riscoCliente]))

    const motivos = new Map<string, ItemPauta['motivos']>()
    const add = (clienteId: string, motivo: MotivoPauta, descricao: string) => {
      if (!elegiveis.has(clienteId)) return
      const lista = motivos.get(clienteId) ?? []
      lista.push({ motivo, descricao })
      motivos.set(clienteId, lista)
    }
    const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/')

    for (const p of planos) {
      if (p.status === 'ATRASADO') add(p.clienteId, 'PLANO_ATRASADO', `Plano atrasado desde ${br(p.dataLimite)}: ${p.decisaoAtual}`)
      else if (p.status === 'EM_DIA' && p.dataLimite <= comite.data) add(p.clienteId, 'PLANO_VENCE_ATE_COMITE', `Plano vence em ${br(p.dataLimite)}: ${p.decisaoAtual}`)
    }
    for (const [clienteId, c] of classificacoes) {
      if (c.criticidade === 'CRITICO') add(clienteId, 'CRITICO', `Crítico na posição de ${br(c.semanaRef)} — ${textoAlertas(c)}`)
    }
    for (const a of alertas) {
      if (a.gravidade !== 'VERMELHO' || a.data.slice(0, 10) < inicio) continue
      add(a.clienteId, a.tipo === TIPOS_ALERTA.ALTERACAO_RESTRITIVOS ? 'PIORA_RESTRITIVOS' : 'ALERTA_VERMELHO_NOVO', `${a.tipo}: ${a.descricao}`)
    }
    for (const e of mudancas) {
      if (e.data.slice(0, 10) < inicio) continue
      add(e.clienteId, 'MUDANCA_STATUS', `Status ${e.valorAnterior ?? '—'} → ${e.valorNovo ?? '—'} em ${br(e.data)}`)
    }

    const itens: ItemPauta[] = [...motivos.entries()].map(([clienteId, lista]) => {
      const cliente = elegiveis.get(clienteId)!
      const cls = classificacoes.get(clienteId)
      return {
        clienteId,
        nome: cliente.nome,
        status: cliente.status,
        criticidade: cls?.criticidade ?? null,
        prioridadeOrdem: cls?.prioridadeOrdem ?? null,
        risco: riscoPorCliente.get(clienteId) ?? 0,
        motivos: lista,
      }
    })
    itens.sort((a, b) => (a.prioridadeOrdem ?? 5) - (b.prioridadeOrdem ?? 5) || b.motivos.length - a.motivos.length || b.risco - a.risco)
    return { comiteId: comite.id, dataComite: comite.data, desde, itens }
  }

  /** Garante que exista um comitê planejado (base nova, ou logo após uma ata
   * se algo interrompeu a criação do próximo). Seguro sob concorrência pelo
   * índice único de comitê planejado. */
  async garantirProximoPlanejado(): Promise<Comite> {
    const existente = await this.comites.proximoPlanejado()
    if (existente) return existente
    const gerentes = await this.cadastros.listarGerentes()
    const hoje = new Date()
    const diasAteSegunda = (8 - hoje.getDay()) % 7 || 7
    const comite: Comite = {
      id: novoId('cmt'),
      data: format(addDays(hoje, diasAteSegunda), 'yyyy-MM-dd'),
      participantes: [...gerentes.map((g) => g.nome), 'Diretoria de Risco', 'Compliance'],
      status: 'PLANEJADO',
    }
    await this.comites.criarSeNenhumPlanejado(comite)
    return (await this.comites.proximoPlanejado()) ?? comite
  }

  sugerirPrazo(dias = 15): string {
    return format(addDays(new Date(), dias), 'yyyy-MM-dd')
  }

  async gerarAta(comiteId: string): Promise<Ata> {
    const comite = await this.comites.porId(comiteId)
    if (!comite) throw new ErroNegocio('Comitê não encontrado.', 404, 'nao_encontrado')
    if (comite.status !== 'PLANEJADO') throw new ErroNegocio('A ata deste comitê já foi gerada.', 409, 'ata_existente')

    const [planosDoComite, todosClientes, todosAlertas, semanas, gerentes, todosPlanos] = await Promise.all([
      this.planos.doComite(comiteId),
      this.clientes.listar(),
      this.alertas.listarTodos(),
      this.snapshots.semanasDisponiveis(),
      this.cadastros.listarGerentes(),
      this.planos.listarTodos(),
    ])
    const posicao = this.posicaoDoComite(semanas, comite.data) ?? comite.data
    const kpis = await this.carteira.obterKPIs({ semanaRef: posicao })
    const clientesPorId = new Map(todosClientes.map((c) => [c.id, c]))
    const semanaAnterior = semanaAnteriorRef(semanas, posicao)
    const envolvidos = [...new Set(planosDoComite.map((p) => p.clienteId))]
    const [snapshots, pareceres, classificacoesSemana, restritivos] = await Promise.all([
      this.snapshots.porSemanas([posicao, ...(semanaAnterior ? [semanaAnterior] : [])], envolvidos),
      this.checklist.pareceres(envolvidos, posicao, ['SITUACAO_ATUAL', 'PRACA_PAGAMENTO', 'EVOLUCAO_RESTRITIVOS', 'DADOS_TRANSACIONAIS_CONTA_MOVIMENTO']),
      this.classificacoes.porSemana(posicao),
      this.restritivos.atualEAnterior(envolvidos, posicao),
    ])
    const snap = (clienteId: string, semana: string | null) => (semana ? snapshots.find((s) => s.clienteId === clienteId && s.semanaRef === semana) : undefined)

    const clientesDiscutidos: Ata['clientesDiscutidos'] = []
    for (const plano of planosDoComite) {
      const cliente = clientesPorId.get(plano.clienteId)
      if (!cliente) continue
      const snapAtual = snap(cliente.id, posicao)
      const snapAnterior = snap(cliente.id, semanaAnterior)
      const risco = snapAtual?.riscoCliente ?? 0
      const vencido = snapAtual?.vencidoOficial ?? 0
      const evolucao =
        snapAtual && snapAnterior && snapAnterior.riscoCliente > 0
          ? `Risco ${(((snapAtual.riscoCliente - snapAnterior.riscoCliente) / snapAnterior.riscoCliente) * 100).toFixed(1)}% desde o último comitê`
          : 'Sem posição da semana anterior para comparação.'
      clientesDiscutidos.push({
        clienteId: cliente.id,
        riscoTomado: risco,
        valorVencido: vencido,
        percVencido: risco > 0 ? Number(((vencido / risco) * 100).toFixed(1)) : 0,
        manifestosRelevantes:
          snapAtual && snapAtual.manifestoLastroInconsistente > 0 ? `Lastro inconsistente de ${formatarMoeda(snapAtual.manifestoLastroInconsistente)}` : null,
        principaisAlertas: classificacoesSemana.get(cliente.id)?.alertas.length
          ? classificacoesSemana.get(cliente.id)!.alertas.slice(0, 4).map((a) => `[${a.nivel === 'CRITICO' ? 'CRÍTICO' : 'ATENÇÃO'}] ${a.texto}`)
          : todosAlertas.filter((a) => a.clienteId === cliente.id).slice(0, 2).map((a) => a.tipo),
        evolucaoDesdeUltimoComite: evolucao,
        decisaoAnterior: plano.decisaoAnterior,
        oQueFoiRealizado: plano.oQueFoiFeito,
        oQueNaoFoiRealizado: plano.oQueNaoFoiFeito,
        novaDecisao: plano.decisaoAtual,
        planoAcaoId: plano.id,
        responsavel: plano.responsavel,
        prazo: plano.dataLimite,
        plano: plano.plano,
        dataDecisaoAnterior: plano.dataDecisaoAnterior,
        situacaoAtual: pareceres.get(cliente.id)?.SITUACAO_ATUAL ?? null,
        pracaPagamento: pareceres.get(cliente.id)?.PRACA_PAGAMENTO ?? null,
        evolucaoRestritivos: pareceres.get(cliente.id)?.EVOLUCAO_RESTRITIVOS ?? evolucaoRestritivosEstruturada(restritivos.get(cliente.id)),
        consideracoesTransacional: pareceres.get(cliente.id)?.DADOS_TRANSACIONAIS_CONTA_MOVIMENTO ?? null,
        criticidadeCalculada: classificacoesSemana.get(cliente.id) ? ROTULO_CRITICIDADE_CLASSIFICADA[classificacoesSemana.get(cliente.id)!.criticidade] : null,
        enquadramento: classificacoesSemana.get(cliente.id) ? ROTULO_ENQUADRAMENTO[classificacoesSemana.get(cliente.id)!.enquadramento] : null,
      })
    }
    const planosAtrasados = todosPlanos.filter((p) => p.status === 'ATRASADO').length

    const ata: Ata = {
      id: novoId('ata'),
      comiteId: comite.id,
      dataGeracao: new Date().toISOString(),
      dataComite: comite.data,
      participantes: comite.participantes,
      resumoExecutivo: {
        riscoTotal: Math.round(kpis.atual.risco),
        vencidoTotal: Math.round(kpis.atual.vencido),
        percVencido: kpis.atual.percVencido,
        principaisVariacoes: [
          `Risco total ${kpis.atual.risco >= kpis.anterior.risco ? 'subiu' : 'caiu'} em relação à semana anterior`,
          `${kpis.atual.qtdCriticos} cliente(s) em criticidade crítica nesta posição`,
          `${planosDoComite.length} caso(s) discutido(s) e com decisão registrada neste comitê`,
          `${planosAtrasados} plano(s) de ação atrasado(s) na carteira`,
          ...(kpis.atual.qtdApartados > 0 ? [`Carteira apartada fora dos totais: ${kpis.atual.qtdApartados} cliente(s), risco de ${formatarMoeda(kpis.atual.riscoApartado)}`] : []),
        ],
        qtdClientesDiscutidos: clientesDiscutidos.length,
        qtdMonitoramento: todosClientes.filter((c) => c.status === 'MONITORAMENTO').length,
        qtdSaidaDeRisco: todosClientes.filter((c) => c.status === 'SAIDA_DE_RISCO').length,
        qtdJuridico: todosClientes.filter((c) => c.status === 'JURIDICO').length,
      },
      clientesDiscutidos,
      pendencias: planosDoComite.map((p) => ({
        clienteId: p.clienteId,
        decisao: p.decisaoAtual,
        acao: p.plano,
        responsavel: p.responsavel,
        prazo: p.dataLimite,
        status: p.status,
      })),
    }

    // Tudo ou nada: ata gravada, comitê realizado e próximo comitê planejado.
    // A trava na linha do comitê impede duas atas para o mesmo comitê.
    await this.banco.transacao(async (tx) => {
      const travado = await this.comites.porId(comiteId, tx, true)
      if (!travado || travado.status !== 'PLANEJADO') throw new ErroNegocio('A ata deste comitê já foi gerada.', 409, 'ata_existente')
      await this.comites.inserirAta(ata, tx)
      await this.comites.marcarRealizado(comite.id, tx)
      const proximo: Comite = {
        id: novoId('cmt'),
        data: format(addWeeks(new Date(`${comite.data}T12:00:00`), 1), 'yyyy-MM-dd'),
        participantes: comite.participantes.length > 0 ? comite.participantes : [...gerentes.map((g) => g.nome), 'Diretoria de Risco', 'Compliance'],
        status: 'PLANEJADO',
      }
      await this.comites.criar(proximo, tx)
    })
    return ata
  }
}

function evolucaoRestritivosEstruturada(r: { atual: PosicaoRestritivos | null; anterior: PosicaoRestritivos | null } | undefined): string | null {
  if (!r?.atual) return null
  const variacoes = compararRestritivos(r.atual.linhas, r.anterior?.linhas ?? null)
  if (variacoes.length === 0) return null
  return variacoes.map(descreverVariacao).join('; ')
}
