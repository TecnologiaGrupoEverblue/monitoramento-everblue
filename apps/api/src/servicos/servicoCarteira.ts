/**
 * Leituras compostas da carteira: clientes enriquecidos, dashboard executivo,
 * rankings, IASR e análise transacional. Porte das regras do protótipo, com as
 * consultas feitas em lote (uma ida ao banco por conjunto, nunca por cliente).
 */
import { format, startOfWeek } from 'date-fns'
import {
  analisarMovimentoConta,
  semanaAnteriorRef,
  semanaMesAnteriorRef,
  type AgregadosSemana,
  type AnaliseTransacional,
  type Cliente,
  type ClienteEnriquecido,
  type DimensaoRisco,
  type FiltrosGlobais,
  type IndicadoresIASR,
  type KPIsDashboard,
  type RankingDimensao,
  type RegistroIasrComEventos,
  type RiscoPorDimensaoItem,
  type SnapshotSemanal,
} from '@monitoramento/dominio'
import type { AlertaRepositorio } from '../repositorios/alertaRepositorio'
import type { CadastrosRepositorio } from '../repositorios/cadastrosRepositorio'
import type { CarteiraRepositorio } from '../repositorios/carteiraRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { EventoRepositorio } from '../repositorios/eventoRepositorio'
import type { PlanoAcaoRepositorio } from '../repositorios/planoAcaoRepositorio'
import type { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'

const AGREGADOS_VAZIOS: AgregadosSemana = {
  risco: 0,
  vencido: 0,
  percVencido: 0,
  limiteGlobal: 0,
  trancheConsolidada: 0,
  valorEmAndamento: 0,
  percLimiteConsumido: 0,
  percTrancheConsumida: 0,
  riscoMonitoramento: 0,
  riscoSaidaDeRisco: 0,
  riscoJuridico: 0,
  riscoCritico: 0,
  riscoAtencao: 0,
  qtdCriticos: 0,
  qtdAtencao: 0,
  qtdClientes: 0,
}

const ROTULO_STATUS: Record<string, string> = { NORMAL: 'Normal', MONITORAMENTO: 'Monitoramento', SAIDA_DE_RISCO: 'Saída de Risco', JURIDICO: 'Jurídico' }

/** O Dashboard Executivo representa a carteira sob acompanhamento do comitê —
 * nunca a base inteira. Clientes em status NORMAL só aparecem em "Risco por status". */
function apenasMonitorados(clientes: Cliente[]): Cliente[] {
  return clientes.filter((c) => c.status !== 'NORMAL')
}

export function agregar(clientes: Cliente[], mapa: Map<string, SnapshotSemanal>): AgregadosSemana {
  const ag = { ...AGREGADOS_VAZIOS }
  for (const cliente of clientes) {
    const snap = mapa.get(cliente.id)
    if (!snap) continue
    ag.risco += snap.riscoCliente
    ag.vencido += snap.vencidoOficial
    ag.limiteGlobal += snap.limiteGlobal
    ag.trancheConsolidada += snap.trancheConsolidada
    ag.valorEmAndamento += snap.valorEmAndamento
    ag.qtdClientes += 1
    if (cliente.status === 'MONITORAMENTO') ag.riscoMonitoramento += snap.riscoCliente
    if (cliente.status === 'SAIDA_DE_RISCO') ag.riscoSaidaDeRisco += snap.riscoCliente
    if (cliente.status === 'JURIDICO') ag.riscoJuridico += snap.riscoCliente
    if (cliente.criticidade === 'CRITICA') {
      ag.riscoCritico += snap.riscoCliente
      ag.qtdCriticos += 1
    }
    if (cliente.criticidade === 'ATENCAO') {
      ag.riscoAtencao += snap.riscoCliente
      ag.qtdAtencao += 1
    }
  }
  ag.percVencido = ag.risco > 0 ? Number(((ag.vencido / ag.risco) * 100).toFixed(1)) : 0
  ag.percLimiteConsumido = ag.limiteGlobal > 0 ? Number(((ag.risco / ag.limiteGlobal) * 100).toFixed(1)) : 0
  ag.percTrancheConsumida = ag.trancheConsolidada > 0 ? Number(((ag.valorEmAndamento / ag.trancheConsolidada) * 100).toFixed(1)) : 0
  return ag
}

export class ServicoCarteira {
  constructor(
    private readonly clientes: ClienteRepositorio,
    private readonly snapshots: SnapshotRepositorio,
    private readonly cadastros: CadastrosRepositorio,
    private readonly alertas: AlertaRepositorio,
    private readonly planos: PlanoAcaoRepositorio,
    private readonly eventos: EventoRepositorio,
    private readonly carteira: CarteiraRepositorio,
  ) {}

  private async semanaDeReferencia(filtros: Partial<FiltrosGlobais>) {
    const semanas = await this.snapshots.semanasDisponiveis()
    const semanaRef = filtros.semanaRef ?? semanas[semanas.length - 1] ?? null
    return { semanas, semanaRef }
  }

  private async mapaSnapshots(semanas: (string | null)[]): Promise<Map<string, Map<string, SnapshotSemanal>>> {
    const validas = semanas.filter((s): s is string => Boolean(s))
    const lista = await this.snapshots.porSemanas(validas)
    const porSemana = new Map<string, Map<string, SnapshotSemanal>>()
    for (const s of validas) porSemana.set(s, new Map())
    for (const snap of lista) porSemana.get(snap.semanaRef)?.set(snap.clienteId, snap)
    return porSemana
  }

  /** Clientes filtrados e enriquecidos com cadastros, snapshots atual/anterior
   * e pendências — o ponto único de "junção" usado pelas telas. */
  async listarEnriquecidos(filtros: Partial<FiltrosGlobais>): Promise<ClienteEnriquecido[]> {
    const [clientes, grupos, gerentes, plataformas, { semanas, semanaRef }, alertas, planos] = await Promise.all([
      this.clientes.listar(filtros),
      this.cadastros.listarGrupos(),
      this.cadastros.listarGerentes(),
      this.cadastros.listarPlataformas(),
      this.semanaDeReferencia(filtros),
      this.alertas.abertos(),
      this.planos.listarTodos(),
    ])
    const semanaAnterior = semanaRef ? semanaAnteriorRef(semanas, semanaRef) : null
    const mapas = await this.mapaSnapshots([semanaRef, semanaAnterior])
    const mapaGrupos = new Map(grupos.map((g) => [g.id, g]))
    const mapaGerentes = new Map(gerentes.map((g) => [g.id, g]))
    const mapaPlataformas = new Map(plataformas.map((p) => [p.id, p]))
    const alertasPorCliente = agruparPor(alertas, (a) => a.clienteId)
    const planosPorCliente = agruparPor(
      planos.filter((p) => p.status !== 'CONCLUIDO'),
      (p) => p.clienteId,
    )

    return clientes.map((cliente) => ({
      ...cliente,
      grupoEconomico: mapaGrupos.get(cliente.grupoEconomicoId)!,
      gerente: mapaGerentes.get(cliente.gerenteId)!,
      plataforma: mapaPlataformas.get(cliente.plataformaId)!,
      snapshotAtual: (semanaRef && mapas.get(semanaRef)?.get(cliente.id)) || null,
      snapshotAnterior: (semanaAnterior && mapas.get(semanaAnterior)?.get(cliente.id)) || null,
      alertasAbertos: alertasPorCliente.get(cliente.id) ?? [],
      planosPendentes: planosPorCliente.get(cliente.id) ?? [],
    }))
  }

  async obterKPIs(filtros: Partial<FiltrosGlobais>): Promise<KPIsDashboard> {
    const [{ semanas, semanaRef }, todos] = await Promise.all([this.semanaDeReferencia(filtros), this.clientes.listar(filtros)])
    const semanaAnterior = semanaRef ? semanaAnteriorRef(semanas, semanaRef) : null
    const semanaMesAnterior = semanaRef ? semanaMesAnteriorRef(semanas, semanaRef) : null
    const clientes = apenasMonitorados(todos)
    const mapas = await this.mapaSnapshots([semanaRef, semanaAnterior, semanaMesAnterior])
    const vazio = new Map<string, SnapshotSemanal>()
    return {
      semanaRef,
      semanaAnterior,
      semanaMesAnterior,
      atual: agregar(clientes, (semanaRef && mapas.get(semanaRef)) || vazio),
      anterior: agregar(clientes, (semanaAnterior && mapas.get(semanaAnterior)) || vazio),
      mesAnterior: semanaMesAnterior ? agregar(clientes, mapas.get(semanaMesAnterior) ?? vazio) : null,
    }
  }

  async serieEvolucaoSemanal(filtros: Partial<FiltrosGlobais>): Promise<{ semana: string; risco: number; vencido: number }[]> {
    const clientes = apenasMonitorados(await this.clientes.listar(filtros))
    return this.snapshots.serieAgregada(clientes.map((c) => c.id))
  }

  async riscoPorDimensao(filtros: Partial<FiltrosGlobais>, dimensao: DimensaoRisco): Promise<RiscoPorDimensaoItem[]> {
    const [{ semanaRef }, clientes, gerentes, plataformas, grupos] = await Promise.all([
      this.semanaDeReferencia(filtros),
      this.clientes.listar(filtros),
      this.cadastros.listarGerentes(),
      this.cadastros.listarPlataformas(),
      this.cadastros.listarGrupos(),
    ])
    const mapaSnap = semanaRef ? ((await this.mapaSnapshots([semanaRef])).get(semanaRef) ?? new Map()) : new Map<string, SnapshotSemanal>()
    const nomes = new Map<string, string>([
      ...(dimensao === 'gerenteId' ? gerentes.map((g) => [g.id, g.nome] as const) : []),
      ...(dimensao === 'plataformaId' ? plataformas.map((p) => [p.id, p.nome] as const) : []),
      ...(dimensao === 'grupoEconomicoId' ? grupos.map((g) => [g.id, g.nome] as const) : []),
    ])
    const rotulo = (chave: string) => (dimensao === 'status' ? (ROTULO_STATUS[chave] ?? chave) : (nomes.get(chave) ?? chave))

    const acumulado = new Map<string, { risco: number; clienteIds: Set<string> }>()
    for (const cliente of clientes) {
      const snap = mapaSnap.get(cliente.id)
      if (!snap) continue
      const chaves = dimensao === 'produto' ? cliente.produtos : [String(cliente[dimensao] ?? '')]
      for (const chave of chaves) {
        if (!chave) continue
        const atual = acumulado.get(chave) ?? { risco: 0, clienteIds: new Set<string>() }
        atual.risco += snap.riscoCliente
        atual.clienteIds.add(cliente.id)
        acumulado.set(chave, atual)
      }
    }
    return Array.from(acumulado.entries())
      .map(([chave, v]) => ({ chave, label: rotulo(chave), risco: v.risco, qtdClientes: v.clienteIds.size, clienteIds: Array.from(v.clienteIds) }))
      .sort((a, b) => b.risco - a.risco)
  }

  /** Ranking por gerente ou plataforma — carteira, risco por status, vencido e planos. */
  async rankingPorDimensao(filtros: Partial<FiltrosGlobais>, dimensao: 'gerenteId' | 'plataformaId'): Promise<RankingDimensao[]> {
    const [{ semanaRef }, clientes, gerentes, plataformas, planos] = await Promise.all([
      this.semanaDeReferencia(filtros),
      this.clientes.listar(filtros),
      this.cadastros.listarGerentes(),
      this.cadastros.listarPlataformas(),
      this.planos.listarTodos(),
    ])
    const mapaSnap = semanaRef ? ((await this.mapaSnapshots([semanaRef])).get(semanaRef) ?? new Map()) : new Map<string, SnapshotSemanal>()
    const nomes = new Map((dimensao === 'gerenteId' ? gerentes : plataformas).map((x) => [x.id, x.nome]))
    const planosPorCliente = agruparPor(planos, (p) => p.clienteId)

    const acumulado = new Map<string, RankingDimensao>()
    for (const cliente of clientes) {
      const chave = cliente[dimensao]
      const item =
        acumulado.get(chave) ??
        ({
          id: chave,
          nome: nomes.get(chave) ?? chave,
          qtdClientes: 0,
          riscoTotal: 0,
          riscoMonitoramento: 0,
          qtdMonitoramento: 0,
          riscoSaidaDeRisco: 0,
          qtdSaidaDeRisco: 0,
          riscoJuridico: 0,
          qtdJuridico: 0,
          vencido: 0,
          percVencido: 0,
          planosPendentes: 0,
          planosAtrasados: 0,
          clienteIds: [],
        } satisfies RankingDimensao)
      item.qtdClientes += 1
      item.clienteIds.push(cliente.id)
      const snap = mapaSnap.get(cliente.id)
      if (snap) {
        item.riscoTotal += snap.riscoCliente
        item.vencido += snap.vencidoOficial
        if (cliente.status === 'MONITORAMENTO') {
          item.riscoMonitoramento += snap.riscoCliente
          item.qtdMonitoramento += 1
        }
        if (cliente.status === 'SAIDA_DE_RISCO') {
          item.riscoSaidaDeRisco += snap.riscoCliente
          item.qtdSaidaDeRisco += 1
        }
        if (cliente.status === 'JURIDICO') {
          item.riscoJuridico += snap.riscoCliente
          item.qtdJuridico += 1
        }
      }
      const doCliente = planosPorCliente.get(cliente.id) ?? []
      item.planosPendentes += doCliente.filter((p) => p.status !== 'CONCLUIDO').length
      item.planosAtrasados += doCliente.filter((p) => p.status === 'ATRASADO').length
      acumulado.set(chave, item)
    }
    for (const item of acumulado.values()) {
      item.percVencido = item.riscoTotal > 0 ? Number(((item.vencido / item.riscoTotal) * 100).toFixed(1)) : 0
    }
    return Array.from(acumulado.values()).sort((a, b) => b.riscoTotal - a.riscoTotal)
  }

  async clientesPorCriticidade(filtros: Partial<FiltrosGlobais>): Promise<{ criticidade: string; qtd: number; clienteIds: string[] }[]> {
    const clientes = await this.clientes.listar(filtros)
    const grupos: Record<string, string[]> = { NORMAL: [], ATENCAO: [], CRITICA: [] }
    for (const c of clientes) grupos[c.criticidade].push(c.id)
    return Object.entries(grupos).map(([criticidade, ids]) => ({ criticidade, qtd: ids.length, clienteIds: ids }))
  }

  async evolucaoEntradasSaidasMonitoramento(filtros: Partial<FiltrosGlobais>): Promise<{ semana: string; entradas: number; saidas: number }[]> {
    const [semanas, clientes] = await Promise.all([this.snapshots.semanasDisponiveis(), this.clientes.listar(filtros)])
    const eventos = await this.eventos.mudancasDeStatus(clientes.map((c) => c.id))
    const contagem = new Map(semanas.map((s) => [s, { entradas: 0, saidas: 0 }]))
    for (const evento of eventos) {
      const semanaDoEvento = format(startOfWeek(new Date(evento.data), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const bucket = contagem.get(semanaDoEvento)
      if (!bucket) continue
      if (evento.valorNovo === 'MONITORAMENTO') bucket.entradas += 1
      if (evento.valorAnterior === 'MONITORAMENTO' && evento.valorNovo !== 'MONITORAMENTO') bucket.saidas += 1
    }
    return semanas.map((semana) => ({ semana, ...(contagem.get(semana) ?? { entradas: 0, saidas: 0 }) }))
  }

  async iasrComEventos(): Promise<RegistroIasrComEventos[]> {
    const [registros, eventos] = await Promise.all([this.carteira.registrosIasr(), this.carteira.eventosIasr()])
    const porRegistro = agruparPor(eventos, (e) => e.registroIasrId)
    return registros.map((r) => ({ ...r, eventos: porRegistro.get(r.id) ?? [] }))
  }

  async indicadoresIasr(hoje = new Date()): Promise<IndicadoresIASR> {
    const registros = await this.iasrComEventos()
    const acompanhadas = registros.filter((r) => new Date(r.acompanharAte) >= hoje || r.eventos.length > 0)
    const comEventos = registros.filter((r) => r.eventos.length > 0)
    const temposDias = comEventos.map((r) => {
      const primeiro = [...r.eventos].sort((a, b) => a.data.localeCompare(b.data))[0]
      return Math.floor((Date.parse(primeiro.data) - Date.parse(r.dataDecisao)) / 86_400_000)
    })
    const motivos = new Map<string, number>()
    for (const r of comEventos) motivos.set(r.motivo, (motivos.get(r.motivo) ?? 0) + 1)
    return {
      saidasRealizadas: registros.length,
      saidasAcompanhadas: acompanhadas.length,
      comEventosPosteriores: comEventos.length,
      percAssertividade: registros.length > 0 ? Number((((registros.length - comEventos.length) / registros.length) * 100).toFixed(1)) : 0,
      tempoMedioDiasDecisaoEvento: temposDias.length > 0 ? Math.round(temposDias.reduce((a, b) => a + b, 0) / temposDias.length) : null,
      motivosQueMaisAntecipam: Array.from(motivos.entries())
        .map(([motivo, ocorrencias]) => ({ motivo, ocorrencias }))
        .sort((a, b) => b.ocorrencias - a.ocorrencias),
    }
  }

  /** Cruza os 6 meses de movimento de conta com a carteira do cliente. */
  async analiseTransacional(clienteId: string): Promise<AnaliseTransacional | null> {
    const [meses, cliente, snapshots] = await Promise.all([
      this.carteira.movimentosDoCliente(clienteId),
      this.clientes.porId(clienteId),
      this.snapshots.porCliente(clienteId),
    ])
    const ultimo = snapshots[snapshots.length - 1] ?? null
    // Média das últimas ~4 semanas: evita comparar a entrada mensal da conta
    // com um pico ou vale pontual da carteira.
    const janela = snapshots.slice(-4)
    const mediaLiquidado = janela.length > 0 ? janela.reduce((soma, s) => soma + s.liquidadoNoPeriodo, 0) / janela.length : 0
    const contexto = cliente && ultimo ? { riscoCliente: ultimo.riscoCliente, vencidoOficial: ultimo.vencidoOficial, liquidadoUltimoMes: mediaLiquidado } : null
    return analisarMovimentoConta(meses, contexto)
  }
}

export function agruparPor<T>(lista: T[], chave: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const item of lista) {
    const k = chave(item)
    const grupo = mapa.get(k)
    if (grupo) grupo.push(item)
    else mapa.set(k, [item])
  }
  return mapa
}
