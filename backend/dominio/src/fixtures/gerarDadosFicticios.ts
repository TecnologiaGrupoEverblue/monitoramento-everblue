import { addDays, format, startOfMonth, startOfWeek, subDays, subMonths, subWeeks } from 'date-fns'
import type {
  Alerta,
  Ata,
  Cliente,
  Comite,
  EventoHistorico,
  EventoIASR,
  Gerente,
  GrupoEconomico,
  Juridico,
  MovimentoContaMensal,
  Plataforma,
  PlanoAcao,
  RegistroIASR,
  SaidaDeRisco,
  SnapshotSemanal,
  StatusCliente,
  StatusPlano,
  TipoEventoIASR,
} from '../models/types'
import { avaliarAlertasPlano, avaliarAlertasSnapshot, CONFIGURACOES_ALERTA_PADRAO } from '../regras/motorDeAlertas'
import { chance, criarRng, novoId, pesoAleatorio, pick, pickMany, randomFloat, randomInt, type Rng } from './random'
import {
  DECISOES_COMITE,
  MEDIDAS_JURIDICAS,
  MOTIVOS_JURIDICO,
  MOTIVOS_MONITORAMENTO,
  MOTIVOS_RECOMPRA,
  MOTIVOS_SAIDA_DE_RISCO,
  NOMES_GERENTES,
  NOMES_PLATAFORMAS,
  PREFIXOS_GRUPO,
  PRODUTOS,
  RAMOS_ATIVIDADE,
  RESPONSAVEIS_INTERNOS,
  SETORES,
  SUFIXOS_EMPRESA,
} from './bancoDeNomes'

const REGIOES = ['Vale do Aço', 'Litoral Norte', 'Planalto Central', 'Serra Gaúcha', 'Baixada Santista', 'Triângulo Mineiro', 'Costa Sul', 'Vale do Paraíba', 'Agreste', 'Norte Pioneiro']

const TOTAL_SEMANAS = 12
const TOTAL_CLIENTES = 70
const TOTAL_GRUPOS = 15
const SEED = 424242

type Fase = { inicioSemana: number; fase: StatusCliente }

export interface DadosFicticios {
  gruposEconomicos: GrupoEconomico[]
  gerentes: Gerente[]
  plataformas: Plataforma[]
  clientes: Cliente[]
  snapshots: SnapshotSemanal[]
  eventos: EventoHistorico[]
  alertas: Alerta[]
  planosAcao: PlanoAcao[]
  saidasDeRisco: SaidaDeRisco[]
  registrosIasr: RegistroIASR[]
  eventosIasr: EventoIASR[]
  juridico: Juridico[]
  comites: Comite[]
  atas: Ata[]
  configuracoesAlerta: typeof CONFIGURACOES_ALERTA_PADRAO
  movimentosConta: MovimentoContaMensal[]
}

const MESES_MOVIMENTO_CONTA = 6

/** Gera 6 meses de movimento de conta do cliente — usado para checar se ele
 * ainda movimenta a conta com frequência normal (item "Dados transacionais"
 * do checklist). A tendência acompanha o status final do cliente (quem está
 * em Saída de Risco/Jurídico tende a esfriar a conta nos meses recentes) e,
 * em ~15% dos clientes, um mês recente recebe um pagamento atípico bem
 * acima do padrão — para exercitar a detecção de desvio. */
function gerarMovimentoContaCliente(rng: Rng, clienteId: string, statusFinal: StatusCliente, mediaLiquidadoNoPeriodo: number, hoje: Date): MovimentoContaMensal[] {
  // Ancorado no que a carteira do cliente efetivamente liquidou (não no
  // risco bruto): assim, num cliente saudável, o dinheiro que entra na
  // conta acompanha o que foi liquidado — é esse acoplamento que permite
  // o cruzamento "liquidado x entradas" pegar divergência de verdade.
  const giroBase = mediaLiquidadoNoPeriodo * randomFloat(rng, 0.85, 1.15)
  const resultado: MovimentoContaMensal[] = []

  for (let i = 0; i < MESES_MOVIMENTO_CONTA; i++) {
    const recente = i >= MESES_MOVIMENTO_CONTA - 3
    let fator: number
    if (statusFinal === 'MONITORAMENTO') fator = recente ? randomFloat(rng, 0.7, 0.95) : randomFloat(rng, 0.9, 1.1)
    else if (statusFinal === 'SAIDA_DE_RISCO') fator = recente ? randomFloat(rng, 0.35, 0.65) : randomFloat(rng, 0.8, 1.05)
    else if (statusFinal === 'JURIDICO') fator = recente ? randomFloat(rng, 0.1, 0.35) : randomFloat(rng, 0.7, 1.0)
    else fator = randomFloat(rng, 0.9, 1.1)

    const entradas = Math.round(giroBase * fator * randomFloat(rng, 0.95, 1.05))
    const saidas = Math.round(entradas * randomFloat(rng, 0.75, 0.98))
    const qtdTransacoes = Math.max(0, Math.round(randomInt(rng, 20, 70) * fator))
    const maiorPagamento = Math.round(entradas * randomFloat(rng, 0.1, 0.25))

    resultado.push({
      id: novoId('mov'),
      clienteId,
      mesRef: format(startOfMonth(subMonths(hoje, MESES_MOVIMENTO_CONTA - 1 - i)), 'yyyy-MM-dd'),
      entradas,
      saidas,
      qtdTransacoes,
      maiorPagamento,
    })
  }

  // Pagamento atípico isolado em ~15% dos clientes, num dos últimos 3 meses.
  if (chance(rng, 0.15)) {
    const idx = randomInt(rng, MESES_MOVIMENTO_CONTA - 3, MESES_MOVIMENTO_CONTA - 1)
    const multiplicador = randomFloat(rng, 3, 6)
    resultado[idx].maiorPagamento = Math.round(resultado[idx].maiorPagamento * multiplicador)
    resultado[idx].entradas = Math.round(resultado[idx].entradas + resultado[idx].maiorPagamento * 0.5)
  }

  return resultado
}

function gerarCNPJ(rng: Rng): string {
  const bloco = () => randomInt(rng, 10, 99)
  return `${bloco()}.${bloco()}${randomInt(rng, 0, 9)}.${bloco()}${randomInt(rng, 0, 9)}/0001-${randomInt(rng, 10, 99)}`
}

function gerarNomeEmpresa(rng: Rng): string {
  return `${pick(rng, REGIOES)} ${pick(rng, SUFIXOS_EMPRESA)}`
}

function semanasReferencia(): Date[] {
  const semanaAtual = startOfWeek(new Date(), { weekStartsOn: 1 })
  return Array.from({ length: TOTAL_SEMANAS }, (_, i) => subWeeks(semanaAtual, TOTAL_SEMANAS - 1 - i))
}

/** Define as fases (status) que um cliente atravessa ao longo das 12 semanas simuladas. */
function definirFases(rng: Rng, statusFinal: StatusCliente): Fase[] {
  if (statusFinal === 'NORMAL') return [{ inicioSemana: 0, fase: 'NORMAL' }]

  if (statusFinal === 'MONITORAMENTO') {
    const t1 = randomInt(rng, 2, 8)
    return [
      { inicioSemana: 0, fase: 'NORMAL' },
      { inicioSemana: t1, fase: 'MONITORAMENTO' },
    ]
  }

  if (statusFinal === 'SAIDA_DE_RISCO') {
    const t1 = randomInt(rng, 1, 4)
    const t2 = randomInt(rng, t1 + 2, 8)
    return [
      { inicioSemana: 0, fase: 'NORMAL' },
      { inicioSemana: t1, fase: 'MONITORAMENTO' },
      { inicioSemana: t2, fase: 'SAIDA_DE_RISCO' },
    ]
  }

  // JURIDICO
  const t1 = randomInt(rng, 0, 3)
  const t2 = randomInt(rng, t1 + 2, 7)
  return [
    { inicioSemana: 0, fase: 'NORMAL' },
    { inicioSemana: t1, fase: 'MONITORAMENTO' },
    { inicioSemana: t2, fase: 'JURIDICO' },
  ]
}

function faseNaSemana(fases: Fase[], semana: number): StatusCliente {
  let atual: StatusCliente = fases[0].fase
  for (const f of fases) {
    if (f.inicioSemana <= semana) atual = f.fase
    else break
  }
  return atual
}

interface ParametrosBase {
  riscoBase: number
  limiteGlobal: number
  trancheConsolidada: number
}

function gerarSnapshotsCliente(rng: Rng, clienteId: string, fases: Fase[], semanas: Date[], base: ParametrosBase): SnapshotSemanal[] {
  const resultado: SnapshotSemanal[] = []
  let risco = base.riscoBase
  let atraso = randomFloat(rng, 2, 10)
  let ilBase = randomFloat(rng, 82, 96)
  let restritivos = 0
  let semanasNaFaseSaida = 0

  for (let w = 0; w < semanas.length; w++) {
    const fase = faseNaSemana(fases, w)

    let deltaRisco: number
    let percVencidoAlvo: number
    let deltaAtraso: number
    let deltaIl: number

    switch (fase) {
      case 'NORMAL':
        deltaRisco = randomFloat(rng, -0.02, 0.025)
        percVencidoAlvo = randomFloat(rng, 0, 3.5)
        deltaAtraso = randomFloat(rng, -0.6, 0.6)
        deltaIl = randomFloat(rng, -0.5, 0.8)
        break
      case 'MONITORAMENTO':
        deltaRisco = randomFloat(rng, -0.01, 0.06)
        percVencidoAlvo = randomFloat(rng, 6, 20)
        deltaAtraso = randomFloat(rng, 0.2, 2.2)
        deltaIl = randomFloat(rng, -2.2, 0.2)
        break
      case 'SAIDA_DE_RISCO':
        semanasNaFaseSaida += 1
        deltaRisco = -randomFloat(rng, 0.03, 0.12)
        percVencidoAlvo = Math.max(8, randomFloat(rng, 18, 32) - semanasNaFaseSaida * 0.8)
        deltaAtraso = randomFloat(rng, -1.2, 0.8)
        deltaIl = randomFloat(rng, -0.5, 1.6)
        break
      default: // JURIDICO
        deltaRisco = randomFloat(rng, -0.05, 0.02)
        percVencidoAlvo = randomFloat(rng, 35, 70)
        deltaAtraso = randomFloat(rng, 0.5, 2.5)
        deltaIl = randomFloat(rng, -1.5, 0.3)
    }

    risco = Math.max(base.riscoBase * 0.08, risco * (1 + deltaRisco))
    atraso = Math.max(0, atraso + deltaAtraso)
    ilBase = Math.min(99, Math.max(35, ilBase + deltaIl))
    if (fase !== 'NORMAL' && chance(rng, 0.06)) restritivos += 1

    const percVencido = Math.max(0, percVencidoAlvo + randomFloat(rng, -1.5, 1.5))
    const vencidoOficial = Math.round(risco * (percVencido / 100))

    const il30 = Math.max(30, ilBase - randomFloat(rng, 12, 20))
    const il60 = Math.max(35, ilBase - randomFloat(rng, 7, 13))
    const il90 = Math.max(40, ilBase - randomFloat(rng, 3, 7))
    const il120 = Math.max(45, ilBase - randomFloat(rng, 1, 3))
    const il150 = Math.min(99, ilBase + randomFloat(rng, 0, 1.5))
    const il180 = Math.min(99.5, ilBase + randomFloat(rng, 1, 3))

    const percConsumoLimite = Math.min(135, (risco / base.limiteGlobal) * 100)
    const valorEmAndamento = risco * randomFloat(rng, 0.55, 0.95)
    const percConsumoTranche = Math.min(135, (valorEmAndamento / base.trancheConsolidada) * 100)
    const statusTranche = percConsumoTranche >= 100 ? 'EXCEDIDA' : percConsumoTranche >= 85 ? 'PROXIMA_DO_LIMITE' : 'DENTRO_DO_LIMITE'

    const propostaVencida = fase !== 'NORMAL' && chance(rng, 0.08)
    const statusProposta = propostaVencida ? 'VENCIDA' : pesoAleatorio(rng, [
      ['APROVADA', 8],
      ['EM_ANALISE', 2],
    ] as const)

    const manifestoBase = fase === 'NORMAL' ? 0.15 : fase === 'MONITORAMENTO' ? 0.45 : fase === 'SAIDA_DE_RISCO' ? 0.55 : 0.7
    const manifestoInacessivel = chance(rng, manifestoBase) ? Math.round(risco * randomFloat(rng, 0.001, 0.015)) : 0
    const manifestoNaoConfirma = chance(rng, manifestoBase * 0.8) ? Math.round(risco * randomFloat(rng, 0.001, 0.012)) : 0
    const manifestoTransacaoDesconhecida = chance(rng, manifestoBase * 0.5) ? Math.round(risco * randomFloat(rng, 0.0005, 0.008)) : 0
    const manifestoLastroInconsistente = chance(rng, manifestoBase * 0.4) ? Math.round(risco * randomFloat(rng, 0.001, 0.02)) : 0
    const manifestoTransacaoNaoConcluida = chance(rng, manifestoBase * 0.6) ? Math.round(risco * randomFloat(rng, 0.0005, 0.01)) : 0

    const recompras = chance(rng, fase === 'NORMAL' ? 0.05 : 0.22) ? Math.round(risco * randomFloat(rng, 0.005, 0.04)) : 0

    resultado.push({
      id: novoId('snap'),
      clienteId,
      semanaRef: format(semanas[w], 'yyyy-MM-dd'),
      criadoEm: addDays(semanas[w], 4).toISOString(),
      riscoCliente: Math.round(risco),
      riscoGrupo: 0, // preenchido no pós-processamento
      limiteGlobal: Math.round(base.limiteGlobal),
      percConsumoLimite: Number(percConsumoLimite.toFixed(1)),
      statusProposta,
      validadeProposta: format(propostaVencida ? subDays(semanas[w], randomInt(rng, 5, 40)) : addDays(semanas[w], randomInt(rng, 20, 90)), 'yyyy-MM-dd'),
      trancheConsolidada: Math.round(base.trancheConsolidada),
      valorEmAndamento: Math.round(valorEmAndamento),
      percConsumoTranche: Number(percConsumoTranche.toFixed(1)),
      statusTranche,
      vencidoOficial,
      vencidoDesde: vencidoOficial > 0 ? format(subDays(semanas[w], randomInt(rng, 7, 120)), 'yyyy-MM-dd') : null,
      agingCarteiraDias: randomInt(rng, 15, fase === 'NORMAL' ? 45 : 180),
      prazoMedioCarteiraDias: randomInt(rng, 30, 90),
      il30: Number(il30.toFixed(1)),
      il60: Number(il60.toFixed(1)),
      il90: Number(il90.toFixed(1)),
      il120: Number(il120.toFixed(1)),
      il150: Number(il150.toFixed(1)),
      il180: Number(il180.toFixed(1)),
      manifestoPercSemAtuacao: Number(randomFloat(rng, 0, fase === 'NORMAL' ? 8 : 35).toFixed(1)),
      manifestoInacessivel,
      manifestoNaoConfirma,
      manifestoTransacaoDesconhecida,
      manifestoLastroInconsistente,
      manifestoTransacaoNaoConcluida,
      liquidadoNoPeriodo: Math.round(risco * randomFloat(rng, 0.15, 0.4)),
      recompras,
      motivoRecompra: recompras > 0 ? pick(rng, MOTIVOS_RECOMPRA) : null,
      percLiquidadoNoPrazo: Number(randomFloat(rng, fase === 'NORMAL' ? 88 : 55, fase === 'NORMAL' ? 99 : 90).toFixed(1)),
      atrasoMedioDias: Math.round(atraso),
      restritivos,
    })
  }

  return resultado
}

export function gerarDadosFicticios(): DadosFicticios {
  const rng = criarRng(SEED)
  const semanas = semanasReferencia()
  const hoje = new Date()

  const gruposEconomicos: GrupoEconomico[] = PREFIXOS_GRUPO.slice(0, TOTAL_GRUPOS).map((nome) => ({ id: novoId('grp'), nome }))
  const gerentes: Gerente[] = NOMES_GERENTES.map((nome) => ({ id: novoId('ger'), nome, email: `${nome.split(' ')[0].toLowerCase()}@everblue.com.br` }))
  const plataformas: Plataforma[] = NOMES_PLATAFORMAS.map((nome) => ({ id: novoId('plt'), nome }))

  // Distribuição de status fixada para garantir clientes em todos os status.
  const statusPlano: StatusCliente[] = [
    ...Array(45).fill('NORMAL'),
    ...Array(14).fill('MONITORAMENTO'),
    ...Array(7).fill('SAIDA_DE_RISCO'),
    ...Array(4).fill('JURIDICO'),
  ] as StatusCliente[]
  const statusEmbaralhado = pickMany(rng, statusPlano, statusPlano.length)

  const clientes: Cliente[] = []
  const fasesPorCliente = new Map<string, Fase[]>()
  const baseParametrosPorCliente = new Map<string, ParametrosBase>()

  for (let i = 0; i < TOTAL_CLIENTES; i++) {
    const status = statusEmbaralhado[i]
    const grupo = pick(rng, gruposEconomicos)
    const gerente = pick(rng, gerentes)
    const plataforma = pick(rng, plataformas)
    const setor = pick(rng, SETORES)
    const ramos = RAMOS_ATIVIDADE[setor]

    const criticidade =
      status === 'NORMAL'
        ? pesoAleatorio(rng, [['NORMAL', 8], ['ATENCAO', 2]] as const)
        : status === 'MONITORAMENTO'
          ? pesoAleatorio(rng, [['ATENCAO', 7], ['CRITICA', 3]] as const)
          : status === 'SAIDA_DE_RISCO'
            ? pesoAleatorio(rng, [['CRITICA', 9], ['ATENCAO', 1]] as const)
            : 'CRITICA'

    const prioridade =
      status === 'NORMAL'
        ? pesoAleatorio(rng, [['BAIXA', 5], ['MEDIA', 3.5], ['ALTA', 1.5]] as const)
        : status === 'MONITORAMENTO'
          ? pesoAleatorio(rng, [['MEDIA', 5], ['ALTA', 5]] as const)
          : 'ALTA'

    const cliente: Cliente = {
      id: novoId('cli'),
      nome: gerarNomeEmpresa(rng),
      cnpj: gerarCNPJ(rng),
      grupoEconomicoId: grupo.id,
      gerenteId: gerente.id,
      plataformaId: plataforma.id,
      setor,
      ramoAtividade: pick(rng, ramos),
      produtos: pickMany(rng, PRODUTOS, randomInt(rng, 1, 3)),
      status,
      prioridade,
      criticidade,
      responsavel: pick(rng, RESPONSAVEIS_INTERNOS),
      criadoEm: subMonths(hoje, randomInt(rng, 6, 36)).toISOString(),
    }
    clientes.push(cliente)
    fasesPorCliente.set(cliente.id, definirFases(rng, status))

    const riscoBase = randomFloat(rng, 300_000, 4_000_000, 0)
    baseParametrosPorCliente.set(cliente.id, {
      riscoBase,
      limiteGlobal: riscoBase * randomFloat(rng, 1.15, 1.6),
      trancheConsolidada: riscoBase * randomFloat(rng, 0.35, 0.65),
    })
  }

  // --- Snapshots semanais ---
  let snapshots: SnapshotSemanal[] = []
  const snapshotsPorCliente = new Map<string, SnapshotSemanal[]>()
  for (const cliente of clientes) {
    const serie = gerarSnapshotsCliente(rng, cliente.id, fasesPorCliente.get(cliente.id)!, semanas, baseParametrosPorCliente.get(cliente.id)!)
    snapshotsPorCliente.set(cliente.id, serie)
    snapshots = snapshots.concat(serie)
  }

  // --- Movimento mensal da conta (dado transacional, 6 meses) ---
  let movimentosConta: MovimentoContaMensal[] = []
  for (const cliente of clientes) {
    const serieCliente = snapshotsPorCliente.get(cliente.id)!
    const mediaLiquidadoNoPeriodo = serieCliente.reduce((soma, s) => soma + s.liquidadoNoPeriodo, 0) / serieCliente.length
    movimentosConta = movimentosConta.concat(gerarMovimentoContaCliente(rng, cliente.id, cliente.status, mediaLiquidadoNoPeriodo, hoje))
  }

  // Pós-processamento: risco consolidado do grupo econômico, por semana.
  for (let w = 0; w < semanas.length; w++) {
    const semanaRef = format(semanas[w], 'yyyy-MM-dd')
    const riscoPorGrupo = new Map<string, number>()
    for (const cliente of clientes) {
      const snap = snapshotsPorCliente.get(cliente.id)![w]
      riscoPorGrupo.set(cliente.grupoEconomicoId, (riscoPorGrupo.get(cliente.grupoEconomicoId) ?? 0) + snap.riscoCliente)
    }
    for (const cliente of clientes) {
      const snap = snapshotsPorCliente.get(cliente.id)!.find((s) => s.semanaRef === semanaRef)!
      snap.riscoGrupo = Math.round(riscoPorGrupo.get(cliente.grupoEconomicoId) ?? 0)
    }
  }

  // --- Eventos de mudança de status ---
  const eventos: EventoHistorico[] = []
  const comiteAnteriorId = novoId('cmt')
  for (const cliente of clientes) {
    const fases = fasesPorCliente.get(cliente.id)!
    for (let i = 1; i < fases.length; i++) {
      const anterior = fases[i - 1].fase
      const novo = fases[i].fase
      const semanaTransicao = semanas[fases[i].inicioSemana]
      const justificativa =
        novo === 'MONITORAMENTO' ? pick(rng, MOTIVOS_MONITORAMENTO) : novo === 'SAIDA_DE_RISCO' ? pick(rng, MOTIVOS_SAIDA_DE_RISCO) : pick(rng, MOTIVOS_JURIDICO)
      const ligadoAoComiteAnterior = fases[i].inicioSemana === TOTAL_SEMANAS - 2 && chance(rng, 0.5)
      eventos.push({
        id: novoId('evt'),
        clienteId: cliente.id,
        data: addDays(semanaTransicao, 2).toISOString(),
        usuario: cliente.responsavel,
        tipo: 'MUDANCA_STATUS',
        valorAnterior: anterior,
        valorNovo: novo,
        justificativa,
        decisaoComiteId: ligadoAoComiteAnterior ? comiteAnteriorId : null,
      })
    }
  }

  // --- Saída de risco (dados específicos) ---
  const saidasDeRisco: SaidaDeRisco[] = []
  for (const cliente of clientes.filter((c) => c.status === 'SAIDA_DE_RISCO')) {
    const fases = fasesPorCliente.get(cliente.id)!
    const faseSaida = fases[fases.length - 1]
    const snapNaEntrada = snapshotsPorCliente.get(cliente.id)![faseSaida.inicioSemana]
    saidasDeRisco.push({
      id: novoId('sdr'),
      clienteId: cliente.id,
      dataEntrada: format(semanas[faseSaida.inicioSemana], 'yyyy-MM-dd'),
      motivo: pick(rng, MOTIVOS_SAIDA_DE_RISCO),
      riscoNaEntrada: snapNaEntrada.riscoCliente,
      planoSaida: 'Redução gradual da exposição via não renovação de operações e cobrança ativa do saldo em aberto.',
      prazoEsperado: format(addDays(semanas[faseSaida.inicioSemana], 180), 'yyyy-MM-dd'),
      responsavel: cliente.responsavel,
      liquidadoIntegralmente: false,
    })
  }

  // --- Jurídico ---
  const juridico: Juridico[] = []
  for (const cliente of clientes.filter((c) => c.status === 'JURIDICO')) {
    const fases = fasesPorCliente.get(cliente.id)!
    const faseJuridico = fases[fases.length - 1]
    const snapAtual = snapshotsPorCliente.get(cliente.id)![TOTAL_SEMANAS - 1]
    const valorRecuperado = Math.round(snapAtual.vencidoOficial * randomFloat(rng, 0.1, 0.45))
    juridico.push({
      id: novoId('jur'),
      clienteId: cliente.id,
      dataEnvio: format(semanas[faseJuridico.inicioSemana], 'yyyy-MM-dd'),
      motivo: pick(rng, MOTIVOS_JURIDICO),
      medidaAdotada: pick(rng, MEDIDAS_JURIDICAS),
      responsavelJuridico: pick(rng, RESPONSAVEIS_INTERNOS),
      status: pesoAleatorio(rng, [['EM_ANDAMENTO', 6], ['ACORDO', 3], ['ENCERRADO', 1]] as const),
      valorRecuperado,
      saldo: Math.max(0, snapAtual.vencidoOficial - valorRecuperado),
      proximoPasso: 'Aguardar manifestação do devedor sobre proposta de acordo.',
      prazo: format(addDays(hoje, randomInt(rng, 5, 45)), 'yyyy-MM-dd'),
      ultimaAtualizacao: subDays(hoje, randomInt(rng, 1, 20)).toISOString(),
    })
  }

  // --- IASR: registros de saída de risco acompanhados por 12 meses ---
  const registrosIasr: RegistroIASR[] = []
  const eventosIasr: EventoIASR[] = []

  const clientesSaida = clientes.filter((c) => c.status === 'SAIDA_DE_RISCO')
  for (const cliente of clientesSaida) {
    const sdr = saidasDeRisco.find((s) => s.clienteId === cliente.id)!
    const snapEntrada = snapshotsPorCliente.get(cliente.id)!.find((s) => s.semanaRef === sdr.dataEntrada)!
    const registro: RegistroIASR = {
      id: novoId('iasr'),
      clienteId: cliente.id,
      dataDecisao: sdr.dataEntrada,
      motivo: sdr.motivo,
      riscoExistente: sdr.riscoNaEntrada,
      indicadoresNaData: {
        percVencido: snapEntrada.riscoCliente > 0 ? Number(((snapEntrada.vencidoOficial / snapEntrada.riscoCliente) * 100).toFixed(1)) : 0,
        ilMedio: Number(((snapEntrada.il30 + snapEntrada.il60 + snapEntrada.il90) / 3).toFixed(1)),
        aging: snapEntrada.agingCarteiraDias,
      },
      decisaoComiteId: null,
      gerenteId: cliente.gerenteId,
      plataformaId: cliente.plataformaId,
      analista: cliente.responsavel,
      acompanharAte: format(addDays(new Date(sdr.dataEntrada), 365), 'yyyy-MM-dd'),
    }
    registrosIasr.push(registro)
    if (chance(rng, 0.3)) {
      eventosIasr.push({
        id: novoId('evi'),
        registroIasrId: registro.id,
        tipo: pick(rng, ['INADIMPLENCIA_RELEVANTE', 'RESTRITIVO_RELEVANTE'] as TipoEventoIASR[]),
        data: format(addDays(new Date(sdr.dataEntrada), randomInt(rng, 20, 70)), 'yyyy-MM-dd'),
        descricao: 'Identificado novo evento de crédito após a saída — decisão sendo reavaliada quanto à antecipação.',
      })
    }
  }

  // Casos históricos: clientes que hoje estão em Jurídico já tiveram uma saída de risco
  // registrada meses atrás — a decisão de saída não foi assertiva (eventos posteriores graves).
  const clientesJuridicoParaHistoricoIasr = clientes.filter((c) => c.status === 'JURIDICO')
  for (const cliente of clientesJuridicoParaHistoricoIasr) {
    const dataDecisaoAntiga = subMonths(hoje, randomInt(rng, 5, 9))
    const registro: RegistroIASR = {
      id: novoId('iasr'),
      clienteId: cliente.id,
      dataDecisao: format(dataDecisaoAntiga, 'yyyy-MM-dd'),
      motivo: pick(rng, MOTIVOS_SAIDA_DE_RISCO),
      riscoExistente: Math.round(randomFloat(rng, 200_000, 1_500_000, 0)),
      indicadoresNaData: { percVencido: randomFloat(rng, 10, 25), ilMedio: randomFloat(rng, 55, 75), aging: randomInt(rng, 60, 150) },
      decisaoComiteId: null,
      gerenteId: cliente.gerenteId,
      plataformaId: cliente.plataformaId,
      analista: cliente.responsavel,
      acompanharAte: format(addDays(dataDecisaoAntiga, 365), 'yyyy-MM-dd'),
    }
    registrosIasr.push(registro)
    eventosIasr.push({
      id: novoId('evi'),
      registroIasrId: registro.id,
      tipo: pesoAleatorio(rng, [['RECUPERACAO_JUDICIAL', 3], ['PROTESTO', 3], ['INADIMPLENCIA_RELEVANTE', 4]] as const),
      data: format(addDays(dataDecisaoAntiga, randomInt(rng, 60, 150)), 'yyyy-MM-dd'),
      descricao: 'Cliente reincidiu após a saída de risco e acabou encaminhado ao Jurídico — decisão de saída não foi assertiva.',
    })
  }

  // --- Planos de ação ---
  const planosAcao: PlanoAcao[] = []
  const clientesComPlano = clientes.filter((c) => c.status !== 'NORMAL')
  let contadorPlanoComiteAnterior = 0
  for (const cliente of clientesComPlano) {
    const dataDecisaoAtual = subDays(hoje, randomInt(rng, 3, 10))
    const atrasado = chance(rng, 0.4)
    const concluido = !atrasado && chance(rng, 0.25)
    const dataLimite = atrasado ? subDays(hoje, randomInt(rng, 2, 25)) : addDays(hoje, randomInt(rng, 5, 35))
    const status: StatusPlano = concluido ? 'CONCLUIDO' : atrasado ? 'ATRASADO' : 'EM_DIA'
    const vinculadoAoComiteAnterior = contadorPlanoComiteAnterior < 6 && chance(rng, 0.5)
    if (vinculadoAoComiteAnterior) contadorPlanoComiteAnterior += 1

    planosAcao.push({
      id: novoId('pla'),
      clienteId: cliente.id,
      comiteOrigemId: vinculadoAoComiteAnterior ? comiteAnteriorId : null,
      decisaoAnterior: vinculadoAoComiteAnterior ? pick(rng, DECISOES_COMITE) : null,
      dataDecisaoAnterior: vinculadoAoComiteAnterior ? format(semanas[TOTAL_SEMANAS - 2], 'yyyy-MM-dd') : null,
      decisaoAtual: pick(rng, DECISOES_COMITE),
      dataDecisaoAtual: format(dataDecisaoAtual, 'yyyy-MM-dd'),
      prazoRegularizacao: format(dataLimite, 'yyyy-MM-dd'),
      plano: 'Apresentar plano de regularização com cronograma de pagamento e reforço de garantias.',
      responsavel: cliente.responsavel,
      oQueFoiFeito: status !== 'EM_DIA' ? 'Contato realizado e negociação iniciada com o cliente.' : null,
      oQueNaoFoiFeito: status === 'ATRASADO' ? 'Cliente não apresentou o plano de regularização no prazo combinado.' : null,
      status,
      dataLimite: format(dataLimite, 'yyyy-MM-dd'),
      evidencias: status === 'CONCLUIDO' ? ['comprovante-pagamento.pdf'] : [],
    })
  }

  // --- Alertas (motor de regras sobre as últimas transições semanais) ---
  const alertas: Alerta[] = []
  for (const cliente of clientes) {
    const serie = snapshotsPorCliente.get(cliente.id)!
    for (let w = Math.max(1, TOTAL_SEMANAS - 4); w < TOTAL_SEMANAS; w++) {
      const gerados = avaliarAlertasSnapshot(serie[w], serie[w - 1], CONFIGURACOES_ALERTA_PADRAO)
      for (const g of gerados) {
        alertas.push({
          id: novoId('alr'),
          clienteId: cliente.id,
          tipo: g.tipo,
          gravidade: g.gravidade,
          data: format(semanas[w], 'yyyy-MM-dd'),
          descricao: g.descricao,
          status: w === TOTAL_SEMANAS - 1 ? 'ABERTO' : pesoAleatorio(rng, [['ABERTO', 3], ['EM_TRATATIVA', 4], ['RESOLVIDO', 3]] as const),
          responsavel: cliente.responsavel,
        })
      }
    }
  }
  for (const plano of planosAcao) {
    const gerados = avaliarAlertasPlano(plano, CONFIGURACOES_ALERTA_PADRAO, hoje)
    for (const g of gerados) {
      alertas.push({
        id: novoId('alr'),
        clienteId: plano.clienteId,
        tipo: g.tipo,
        gravidade: g.gravidade,
        data: format(hoje, 'yyyy-MM-dd'),
        descricao: g.descricao,
        status: 'ABERTO',
        responsavel: plano.responsavel,
      })
    }
  }

  // --- Comitê anterior + Ata anterior (obrigatório: exatamente 1 ata anterior) ---
  const participantesComite = [...gerentes.map((g) => g.nome), 'Diretoria de Risco', 'Compliance']
  const comiteAnterior: Comite = {
    id: comiteAnteriorId,
    data: format(semanas[TOTAL_SEMANAS - 2], 'yyyy-MM-dd'),
    participantes: participantesComite,
    status: 'REALIZADO',
  }
  const comiteAtual: Comite = {
    id: novoId('cmt'),
    data: format(semanas[TOTAL_SEMANAS - 1], 'yyyy-MM-dd'),
    participantes: participantesComite,
    status: 'PLANEJADO',
  }
  const comites: Comite[] = [comiteAnterior, comiteAtual]

  const clientesDiscutidosAnterior = pickMany(rng, clientes.filter((c) => c.status !== 'NORMAL'), Math.min(8, clientesComPlano.length))
  const snapshotsSemanaAnterior = clientes.map((c) => snapshotsPorCliente.get(c.id)!.find((s) => s.semanaRef === comiteAnterior.data)!)
  const riscoTotalAnterior = snapshotsSemanaAnterior.reduce((soma, s) => soma + s.riscoCliente, 0)
  const vencidoTotalAnterior = snapshotsSemanaAnterior.reduce((soma, s) => soma + s.vencidoOficial, 0)

  const ataAnterior: Ata = {
    id: novoId('ata'),
    comiteId: comiteAnterior.id,
    dataGeracao: addDays(new Date(comiteAnterior.data), 1).toISOString(),
    dataComite: comiteAnterior.data,
    participantes: participantesComite,
    resumoExecutivo: {
      riscoTotal: Math.round(riscoTotalAnterior),
      vencidoTotal: Math.round(vencidoTotalAnterior),
      percVencido: riscoTotalAnterior > 0 ? Number(((vencidoTotalAnterior / riscoTotalAnterior) * 100).toFixed(1)) : 0,
      principaisVariacoes: [
        'Aumento do risco em clientes do setor de Construção Civil',
        'Redução da exposição em Saída de Risco em cerca de 8% na semana',
        'Dois novos clientes classificados em Monitoramento',
      ],
      qtdClientesDiscutidos: clientesDiscutidosAnterior.length,
      qtdMonitoramento: clientes.filter((c) => c.status === 'MONITORAMENTO').length,
      qtdSaidaDeRisco: clientes.filter((c) => c.status === 'SAIDA_DE_RISCO').length,
      qtdJuridico: clientes.filter((c) => c.status === 'JURIDICO').length,
    },
    clientesDiscutidos: clientesDiscutidosAnterior.map((cliente) => {
      const snap = snapshotsPorCliente.get(cliente.id)!.find((s) => s.semanaRef === comiteAnterior.data)!
      const planoRelacionado = planosAcao.find((p) => p.clienteId === cliente.id)
      return {
        clienteId: cliente.id,
        riscoTomado: snap.riscoCliente,
        valorVencido: snap.vencidoOficial,
        percVencido: snap.riscoCliente > 0 ? Number(((snap.vencidoOficial / snap.riscoCliente) * 100).toFixed(1)) : 0,
        manifestosRelevantes: snap.manifestoLastroInconsistente > 0 ? `Lastro inconsistente de R$ ${snap.manifestoLastroInconsistente.toLocaleString('pt-BR')}` : null,
        principaisAlertas: alertas.filter((a) => a.clienteId === cliente.id).slice(0, 2).map((a) => a.tipo),
        evolucaoDesdeUltimoComite: 'Indicadores em linha com o esperado desde a última reunião.',
        decisaoAnterior: planoRelacionado?.decisaoAnterior ?? null,
        oQueFoiRealizado: planoRelacionado?.oQueFoiFeito ?? null,
        oQueNaoFoiRealizado: planoRelacionado?.oQueNaoFoiFeito ?? null,
        novaDecisao: planoRelacionado?.decisaoAtual ?? pick(rng, DECISOES_COMITE),
        planoAcaoId: planoRelacionado?.id ?? null,
        responsavel: cliente.responsavel,
        prazo: planoRelacionado?.dataLimite ?? format(addDays(hoje, 30), 'yyyy-MM-dd'),
      }
    }),
    pendencias: planosAcao
      .filter((p) => p.comiteOrigemId === comiteAnterior.id)
      .map((p) => ({
        clienteId: p.clienteId,
        decisao: p.decisaoAnterior ?? p.decisaoAtual,
        acao: p.plano,
        responsavel: p.responsavel,
        prazo: p.dataLimite,
        status: p.status,
      })),
  }

  return {
    gruposEconomicos,
    gerentes,
    plataformas,
    clientes,
    snapshots,
    eventos,
    alertas,
    planosAcao,
    saidasDeRisco,
    registrosIasr,
    eventosIasr,
    juridico,
    comites,
    atas: [ataAnterior],
    configuracoesAlerta: CONFIGURACOES_ALERTA_PADRAO,
    movimentosConta,
  }
}
