/** Comitês e atas. A ata é compilada a partir das decisões registradas (planos
 * de ação com este comitê como origem) e fica imutável depois de gerada. */
import { addDays, addWeeks, format } from 'date-fns'
import { semanaAnteriorRef, type Ata, type Comite } from '@monitoramento/dominio'
import type { Banco } from '../infra/banco'
import type { AlertaRepositorio } from '../repositorios/alertaRepositorio'
import type { CadastrosRepositorio } from '../repositorios/cadastrosRepositorio'
import { novoId } from '../repositorios/cadastrosRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { ComiteRepositorio } from '../repositorios/comiteRepositorio'
import type { PlanoAcaoRepositorio } from '../repositorios/planoAcaoRepositorio'
import type { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'
import type { ServicoCarteira } from './servicoCarteira'

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
  ) {}

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

    const [planosDoComite, todosClientes, todosAlertas, kpis, semanas, gerentes] = await Promise.all([
      this.planos.doComite(comiteId),
      this.clientes.listar(),
      this.alertas.listarTodos(),
      this.carteira.obterKPIs({ semanaRef: comite.data }),
      this.snapshots.semanasDisponiveis(),
      this.cadastros.listarGerentes(),
    ])
    const clientesPorId = new Map(todosClientes.map((c) => [c.id, c]))
    const semanaAnterior = semanaAnteriorRef(semanas, comite.data)
    const envolvidos = [...new Set(planosDoComite.map((p) => p.clienteId))]
    const snapshots = await this.snapshots.porSemanas([comite.data, ...(semanaAnterior ? [semanaAnterior] : [])], envolvidos)
    const snap = (clienteId: string, semana: string | null) => (semana ? snapshots.find((s) => s.clienteId === clienteId && s.semanaRef === semana) : undefined)

    const clientesDiscutidos: Ata['clientesDiscutidos'] = []
    for (const plano of planosDoComite) {
      const cliente = clientesPorId.get(plano.clienteId)
      if (!cliente) continue
      const snapAtual = snap(cliente.id, comite.data)
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
          snapAtual && snapAtual.manifestoLastroInconsistente > 0 ? `Lastro inconsistente de R$ ${snapAtual.manifestoLastroInconsistente.toLocaleString('pt-BR')}` : null,
        principaisAlertas: todosAlertas.filter((a) => a.clienteId === cliente.id).slice(0, 2).map((a) => a.tipo),
        evolucaoDesdeUltimoComite: evolucao,
        decisaoAnterior: plano.decisaoAnterior,
        oQueFoiRealizado: plano.oQueFoiFeito,
        oQueNaoFoiRealizado: plano.oQueNaoFoiFeito,
        novaDecisao: plano.decisaoAtual,
        planoAcaoId: plano.id,
        responsavel: plano.responsavel,
        prazo: plano.dataLimite,
      })
    }

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
