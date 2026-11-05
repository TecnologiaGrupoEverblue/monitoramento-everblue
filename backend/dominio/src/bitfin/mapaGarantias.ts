/**
 * Mapa de Garantias (1.2) — modelo único para todos os clientes.
 *
 * Regras fechadas com o especialista (29/10/2026, documento
 * "bitfin-regras-fechadas"), conferidas contra a planilha nos clientes GF,
 * J.pack e DDC Life:
 *
 *   exigibilidade      = risco da Nota Comercial × % de exigência (garantia de
 *                        recebíveis ligada à Cobrança Vinculada)
 *   cobrança vinculada = saldo em aberto dos títulos da Cobrança Vinculada
 *   efeito vagão       = TODO o saldo dos sacados que têm qualquer título vencido
 *   manifesto          = lastro inconsistente + transação desconhecida +
 *                        transação não concluída, SÓ dos títulos fora do vagão
 *   prorrogados        = títulos prorrogados fora do vagão e do manifesto
 *   (cada título é deduzido UMA vez: vagão → manifesto → prorrogado)
 *   garantias válidas  = cobrança vinculada − vagão − manifesto − prorrogados − deduções manuais
 *   garantia total     = válidas + contas gráficas escolhidas (escrow = conta
 *                        gráfica da Cobrança Vinculada)
 *   sobra/falta        = garantia total − exigibilidade
 *
 * Outras garantias (nota promissória, alienação de estoque, debêntures) NÃO
 * entram na garantia total: aparecem à parte. ILM fica fora do cálculo
 * (mostrado, preparado para ligar quando a nova minuta valer). Concentração
 * excedida e sacado com restrição são campos manuais.
 */
import type { BitfinResponsavel } from './foto'

export const PRODUTO_NOTA_COMERCIAL = 18
export const PRODUTO_COBRANCA_VINCULADA = 7

/** Categorias de manifesto (Titulo.Status) deduzidas da garantia. */
export const STATUS_DEDUZIDOS = { 2: 'Transação não concluída', 3: 'Lastro inconsistente', 4: 'Transação desconhecida' } as const
export type StatusDeduzido = keyof typeof STATUS_DEDUZIDOS

export interface MapaClienteBitfin {
  clienteId: number
  nome: string
  documento: string
  grupo: string | null
}

export interface MapaContaBitfin {
  clienteId: number
  contaOperacionalId: number
  contaCorrenteId: number | null
  produtoId: number
  produto: string
  unidade: string
  risco: number
  prorrogados: number
  indiceLiquidez: number | null
}

/** Título em aberto (situação 0) das contas de Cobrança Vinculada. */
export interface MapaTituloBitfin {
  clienteId: number
  contaOperacionalId: number
  sacadoId: number
  saldo: number
  /** Vencimento efetivo (yyyy-MM-dd, já ajustado para dia útil): base do vagão. */
  vencimento: string
  /** Vencimento cadastrado no título hoje (Titulo.DataDeVencimento). */
  vencimentoAtual: string | null
  /** Vencimento na operação de origem (OperacaoItem.DataDeVencimentoOriginal).
   * Posterior a ele = prorrogado. (O efetivo difere do cadastrado só pelo
   * ajuste de fim de semana/feriado — isso NÃO é prorrogação.) */
  vencimentoOriginal: string | null
  /** Categoria de manifesto (Titulo.Status); `null` = sem categoria no Bitfin. */
  status: number | null
}

export interface MapaGarantiaBitfin {
  clienteId: number
  garantiaId: number
  tipo: string
  valor: number | null
  percentual: number | null
  status: number | null
  contaOperacionalId: number | null
  bemTipo: string | null
  bemDescricao: string | null
  valorEmGarantia: number | null
  vencimento: string | null
}

export interface MapaContaGraficaBitfin {
  clienteId: number
  contaCorrenteId: number
  descricao: string
  produto: string
  saldo: number
  ultimoLancamento: string | null
}

export interface DadosMapaBitfin {
  lidoEm: string
  clientes: MapaClienteBitfin[]
  contas: MapaContaBitfin[]
  titulos: MapaTituloBitfin[]
  garantias: MapaGarantiaBitfin[]
  contasGraficas: MapaContaGraficaBitfin[]
  responsaveis: BitfinResponsavel[]
}

/** Cadastro do Monitoramento para o cliente no mapa (painel do especialista). */
export interface ConfigMapaCliente {
  /** Contas gráficas que entram (ContaCorrenteId). `null` = padrão: as da Cobrança Vinculada. */
  contasGraficas: number[] | null
  /** Deduções manuais, cada uma com justificativa e responsável (regra 11/15). */
  deducoes: { valor: number; justificativa: string; responsavel: string; data: string }[]
  concentracaoExcedida: { texto: string; responsavel: string; data: string } | null
  sacadoComRestricao: { texto: string; responsavel: string; data: string } | null
}

export const CONFIG_MAPA_PADRAO: ConfigMapaCliente = { contasGraficas: null, deducoes: [], concentracaoExcedida: null, sacadoComRestricao: null }

export interface LinhaMapaGarantia {
  bitfinClienteId: number
  nome: string
  documento: string
  fundo: string
  riscoNotaComercial: number
  exigenciaPerc: number | null
  exigibilidade: number | null
  cobrancaVinculada: number
  efeitoVagao: number
  sacadosNoVagao: number
  manifesto: { status: StatusDeduzido; descricao: string; valor: number }[]
  totalManifesto: number
  prorrogados: number
  deducoesManuais: number
  garantiasValidas: number
  contasGraficas: { contaCorrenteId: number; descricao: string; produto: string; saldo: number; incluida: boolean }[]
  totalContasGraficas: number
  garantiaTotal: number
  sobraFalta: number | null
  coberturaPerc: number | null
  ilm30: number | null
  outrasGarantias: { tipo: string; descricao: string; valor: number | null; vencimento: string | null }[]
  concentracaoExcedida: ConfigMapaCliente['concentracaoExcedida']
  sacadoComRestricao: ConfigMapaCliente['sacadoComRestricao']
  deducoes: ConfigMapaCliente['deducoes']
  responsaveis: BitfinResponsavel[]
  /** Conferências que não bateram — aparecem no mapa, nunca escondidas. */
  divergencias: string[]
}

const c2 = (v: number) => Math.round(v * 100) / 100
const soma = (vs: number[]) => vs.reduce((a, b) => a + b, 0)
const dia = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null)
export const digitosDocumento = (d: string) => {
  let x = d.replace(/\D/g, '')
  if (x.length === 15 && x.startsWith('0')) x = x.slice(1)
  return x
}

export function calcularMapaCliente(dados: DadosMapaBitfin, clienteId: number, config: ConfigMapaCliente, hojeIso: string): LinhaMapaGarantia | null {
  const cliente = dados.clientes.find((c) => c.clienteId === clienteId)
  if (!cliente) return null
  const divergencias: string[] = []
  const contas = dados.contas.filter((c) => c.clienteId === clienteId)
  const nc = contas.filter((c) => c.produtoId === PRODUTO_NOTA_COMERCIAL)
  const cv = contas.filter((c) => c.produtoId === PRODUTO_COBRANCA_VINCULADA)
  const idsCv = new Set(cv.map((c) => c.contaOperacionalId))
  const titulos = dados.titulos.filter((t) => t.clienteId === clienteId && idsCv.has(t.contaOperacionalId))

  const riscoNotaComercial = c2(soma(nc.map((c) => c.risco)))
  const fundo = [...new Set((nc.length > 0 ? nc : contas).map((c) => c.unidade))].join(', ') || '—'

  // Exigência: garantia de recebíveis (ativa) ligada à Cobrança Vinculada.
  const exigencias = dados.garantias.filter((g) => g.clienteId === clienteId && g.tipo === 'Recebivel' && g.percentual !== null && (g.contaOperacionalId === null || idsCv.has(g.contaOperacionalId)))
  const percentuais = [...new Set(exigencias.map((g) => Number(g.percentual)))]
  if (percentuais.length > 1) divergencias.push(`Mais de um % de exigência cadastrado no Bitfin (${percentuais.join('%, ')}%): usado o maior.`)
  const exigenciaPerc = percentuais.length > 0 ? Math.max(...percentuais) : null
  if (exigenciaPerc === null && riscoNotaComercial > 0) divergencias.push('Sem % de exigência de garantia cadastrado no Bitfin: exigibilidade não calculada.')
  const exigibilidade = exigenciaPerc === null ? null : c2((riscoNotaComercial * exigenciaPerc) / 100)

  // Cobrança vinculada e conferência contra a posição da conta.
  const cobrancaVinculada = c2(soma(titulos.map((t) => t.saldo)))
  const riscoCv = c2(soma(cv.map((c) => c.risco)))
  if (Math.abs(riscoCv - cobrancaVinculada) > 0.01) divergencias.push(`Títulos em aberto da Cobrança Vinculada somam R$ ${cobrancaVinculada} e a posição da conta R$ ${riscoCv}.`)

  // 1º efeito vagão: todo o saldo dos sacados com qualquer título vencido.
  const sacadosVencidos = new Set(titulos.filter((t) => t.vencimento < hojeIso).map((t) => t.sacadoId))
  const noVagao = (t: MapaTituloBitfin) => sacadosVencidos.has(t.sacadoId)
  const efeitoVagao = c2(soma(titulos.filter(noVagao).map((t) => t.saldo)))

  // 2º manifesto, só fora do vagão.
  const foraDoVagao = titulos.filter((t) => !noVagao(t))
  const manifesto = (Object.keys(STATUS_DEDUZIDOS).map(Number) as StatusDeduzido[]).map((status) => ({
    status,
    descricao: STATUS_DEDUZIDOS[status],
    valor: c2(soma(foraDoVagao.filter((t) => t.status === status).map((t) => t.saldo))),
  }))
  const totalManifesto = c2(soma(manifesto.map((m) => m.valor)))

  // 3º prorrogados, fora do vagão e do manifesto.
  // Prorrogado: vencimento cadastrado posterior ao da operação; ou vencimento
  // efetivo mais de 5 dias depois dele (o ajuste de fim de semana/feriado é de
  // no máximo 4 dias). Conferido abaixo contra o total de prorrogados da conta.
  const diasEntreIso = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
  const prorrogado = (t: MapaTituloBitfin) => {
    const original = dia(t.vencimentoOriginal)
    if (!original) return false
    const atual = dia(t.vencimentoAtual)
    return (atual !== null && atual > original) || diasEntreIso(original, dia(t.vencimento)!) > 5
  }
  const deduzidoNoManifesto = (t: MapaTituloBitfin) => t.status !== null && t.status in STATUS_DEDUZIDOS
  const prorrogados = c2(soma(foraDoVagao.filter((t) => !deduzidoNoManifesto(t) && prorrogado(t)).map((t) => t.saldo)))
  const semCategoria = titulos.filter((t) => t.status === null)
  if (semCategoria.length > 0) divergencias.push(`${semCategoria.length} título(s) sem categoria de manifesto no Bitfin (R$ ${c2(soma(semCategoria.map((t) => t.saldo)))}): não deduzidos.`)
  const prorrogadosPosicao = c2(soma(cv.map((c) => c.prorrogados)))
  const prorrogadosTitulos = c2(soma(titulos.filter(prorrogado).map((t) => t.saldo)))
  if (Math.abs(prorrogadosPosicao - prorrogadosTitulos) > 0.01) divergencias.push(`Prorrogados pelos títulos R$ ${prorrogadosTitulos} × posição da conta R$ ${prorrogadosPosicao}.`)

  const deducoesManuais = c2(soma(config.deducoes.map((d) => d.valor)))
  const garantiasValidas = c2(cobrancaVinculada - efeitoVagao - totalManifesto - prorrogados - deducoesManuais)

  // Contas gráficas: padrão = as da Cobrança Vinculada; o analista escolhe quando há mais de uma.
  const ccPadrao = new Set(cv.map((c) => c.contaCorrenteId).filter((x): x is number => x !== null))
  const escolhidas = config.contasGraficas === null ? ccPadrao : new Set(config.contasGraficas)
  const vistas = new Set<number>()
  const contasGraficas = dados.contasGraficas
    .filter((g) => g.clienteId === clienteId && !vistas.has(g.contaCorrenteId) && vistas.add(g.contaCorrenteId))
    .map((g) => ({ contaCorrenteId: g.contaCorrenteId, descricao: g.descricao, produto: g.produto, saldo: c2(g.saldo), incluida: escolhidas.has(g.contaCorrenteId) }))
  const totalContasGraficas = c2(soma(contasGraficas.filter((g) => g.incluida).map((g) => g.saldo)))

  const garantiaTotal = c2(garantiasValidas + totalContasGraficas)
  const outrasGarantias = dados.garantias
    .filter((g) => g.clienteId === clienteId && g.tipo !== 'Recebivel')
    .map((g) => ({ tipo: g.bemTipo ? `${g.tipo} (${g.bemTipo})` : g.tipo, descricao: g.bemDescricao ?? '', valor: g.valorEmGarantia ?? g.valor, vencimento: dia(g.vencimento) }))

  return {
    bitfinClienteId: clienteId,
    nome: cliente.nome,
    documento: cliente.documento,
    fundo,
    riscoNotaComercial,
    exigenciaPerc,
    exigibilidade,
    cobrancaVinculada,
    efeitoVagao,
    sacadosNoVagao: sacadosVencidos.size,
    manifesto,
    totalManifesto,
    prorrogados,
    deducoesManuais,
    garantiasValidas,
    contasGraficas,
    totalContasGraficas,
    garantiaTotal,
    sobraFalta: exigibilidade === null ? null : c2(garantiaTotal - exigibilidade),
    coberturaPerc: exigibilidade && exigibilidade > 0 ? Math.round((garantiaTotal / exigibilidade) * 10000) / 100 : null,
    ilm30: cv.find((c) => c.indiceLiquidez !== null)?.indiceLiquidez ?? null,
    outrasGarantias,
    concentracaoExcedida: config.concentracaoExcedida,
    sacadoComRestricao: config.sacadoComRestricao,
    deducoes: config.deducoes,
    responsaveis: dados.responsaveis.filter((r) => r.clienteId === clienteId),
    divergencias,
  }
}

export type PapelDestinatario = 'GERENTE' | 'ASSISTENTE' | 'SUBGERENTE' | 'SUPERINTENDENTE' | 'DIRETOR' | 'COPIA'

export interface DestinatarioMapa {
  email: string
  nome: string | null
  papeis: PapelDestinatario[]
  /** Documentos (só dígitos) dos clientes que esta pessoa recebe. */
  clientes: string[]
}

/** Quem recebe o quê: cada responsável (gerente, assistente e superiores do
 * cadastro do cliente no Bitfin) recebe só os SEUS clientes; os e-mails em
 * cópia recebem todos. Responsável inativo ou sem e-mail não recebe. Uma
 * pessoa = um e-mail, mesmo com vários papéis. */
export function montarDestinatarios(linhas: LinhaMapaGarantia[], copias: string[]): DestinatarioMapa[] {
  const porEmail = new Map<string, DestinatarioMapa>()
  const adicionar = (email: string, nome: string | null, papel: PapelDestinatario, documento: string) => {
    const chave = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave)) return
    let d = porEmail.get(chave)
    if (!d) {
      d = { email: chave, nome, papeis: [], clientes: [] }
      porEmail.set(chave, d)
    }
    if (!d.papeis.includes(papel)) d.papeis.push(papel)
    if (!d.clientes.includes(documento)) d.clientes.push(documento)
  }
  for (const l of linhas) {
    const doc = digitosDocumento(l.documento)
    for (const r of l.responsaveis) if (r.ativo && r.email) adicionar(r.email, r.nome, r.papel, doc)
    for (const c of copias) adicionar(c, null, 'COPIA', doc)
  }
  return [...porEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
}
