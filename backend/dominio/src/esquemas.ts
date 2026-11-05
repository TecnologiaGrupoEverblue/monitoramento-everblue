/**
 * Esquemas de entrada compartilhados entre a API (validação no servidor, que
 * é a que vale) e os formulários da interface (React Hook Form + zod) — skill
 * Everblue, Front-end React. Mesma regra nos dois lados; a tela só antecipa o
 * erro.
 */
import { z } from 'zod'
import { ITENS_CHECKLIST } from './regras/motorChecklist'
import { TIPOS_RESTRITIVO } from './regras/restritivos'

// ------------------------------------------------------------------ átomos

export const esquemaData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data (dd/mm/aaaa).')
export const esquemaIdentificador = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/, 'identificador inválido')
export const esquemaEmail = z.string().trim().toLowerCase().max(200).email('E-mail inválido.')

/** Só os dígitos de um CPF/CNPJ digitado com ou sem máscara. */
export const somenteDigitos = (v: string) => v.replace(/\D/g, '')

function dvCpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (base: string, peso: number) => {
    let soma = 0
    for (const c of base) soma += Number(c) * peso--
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10])
}

function dvCnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = [...base].reduce((s, c, i) => s + Number(c) * pesos[i]!, 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

/** CPF ou CNPJ com dígito verificador conferido; devolve só os dígitos. */
export const esquemaCpfCnpj = z
  .string()
  .trim()
  .transform(somenteDigitos)
  .refine((v) => v.length === 11 || v.length === 14, 'Informe um CNPJ (14 dígitos) ou CPF (11 dígitos).')
  .refine((v) => (v.length === 11 ? dvCpfValido(v) : dvCnpjValido(v)), 'CPF/CNPJ inválido (dígito verificador não confere).')

// ------------------------------------------------------------------ planos e comitê

export const esquemaAndamentoPlano = z
  .object({
    oQueFoiFeito: z.string().trim().max(4000).nullable().optional(),
    oQueNaoFoiFeito: z.string().trim().max(4000).nullable().optional(),
    concluir: z.boolean().optional(),
    reabrir: z.boolean().optional(),
    dataLimite: esquemaData.optional(),
    responsavel: z.string().trim().min(1, 'Informe o responsável.').max(200).optional(),
    justificativa: z.string().trim().max(1000).optional(),
  })
  .strict()

export const esquemaDecisaoComite = z
  .object({
    clienteId: esquemaIdentificador,
    decisao: z.string().trim().min(1, 'Informe a decisão.').max(2000),
    plano: z.string().trim().max(4000).default(''),
    prazo: esquemaData,
    responsavel: z.string().trim().max(200).default(''),
  })
  .strict()

// ------------------------------------------------------------------ checklist e restritivos

export const CHAVES_CHECKLIST = ITENS_CHECKLIST.map((i) => i.chave) as [string, ...string[]]

export const esquemaItemChecklist = z
  .object({
    parecer: z.string().max(10_000).optional(),
    gravidade: z.enum(['VERDE', 'AMARELO', 'VERMELHO']).optional(),
    gravidadeManual: z.boolean().optional(),
  })
  .strict()

const TIPOS = TIPOS_RESTRITIVO.map((t) => t.tipo) as [string, ...string[]]
export const esquemaRestritivos = z
  .object({
    linhas: z
      .array(
        z.object({
          tipo: z.enum(TIPOS),
          quantidade: z.number().int('Quantidade inteira.').min(0, 'Não pode ser negativo.').max(1_000_000),
          valor: z.number().finite().min(0, 'Não pode ser negativo.').max(1e13),
          observacao: z.string().trim().max(500).nullable().optional(),
        }),
      )
      .max(TIPOS.length),
  })
  .strict()

// ------------------------------------------------------------------ parâmetros

export const esquemaMotivoAlteracao = z.string().trim().max(200)

export const esquemaLimiarAlerta = z
  .object({ limiar: z.number().finite().min(0, 'Não pode ser negativo.').max(1e12).optional(), ativo: z.boolean().optional(), motivo: esquemaMotivoAlteracao.optional() })
  .strict()
  .refine((c) => c.limiar !== undefined || c.ativo !== undefined, 'informe limiar ou ativo')

export const esquemaValorRegra = z.object({ valor: z.number().finite().min(0, 'Não pode ser negativo.').max(1e13), motivo: esquemaMotivoAlteracao.optional() }).strict()

export const esquemaCarteiraApartada = z.object({ apartada: z.boolean(), motivo: esquemaMotivoAlteracao.optional() }).strict()

// ------------------------------------------------------------------ foto do Bitfin

export const esquemaTirarFoto = z.object({ gravarPosicao: z.boolean() }).strict()

export const esquemaAgendamentoFotoCorpo = z
  .object({
    ativo: z.boolean(),
    horario: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM.'),
    diasSemana: z.array(z.number().int().min(0).max(6)).min(1, 'Escolha ao menos um dia.').max(7),
    diaPosicaoSemanal: z.number().int().min(0).max(6).nullable(),
  })
  .strict()

/** Com a regra "dia da posição ∈ dias da foto" (a API confere de novo e responde 422). */
export const esquemaAgendamentoFoto = esquemaAgendamentoFotoCorpo.refine((a) => a.diaPosicaoSemanal === null || a.diasSemana.includes(a.diaPosicaoSemanal), {
    message: 'O dia da posição do comitê precisa ser um dos dias em que a foto é tirada.',
    path: ['diaPosicaoSemanal'],
  })

// ------------------------------------------------------------------ mapa de garantias

export const esquemaTextoMapa = z.string().trim().min(3, 'Mínimo de 3 caracteres.').max(1000)
export const esquemaInclusaoMapa = z.object({ documento: esquemaCpfCnpj }).strict()
export const esquemaCopiaMapa = z.object({ email: esquemaEmail }).strict()
export const esquemaConfigMapaCliente = z
  .object({
    contasGraficas: z.array(z.number().int().positive()).max(50).nullable(),
    deducoes: z.array(z.object({ valor: z.number().positive('Valor maior que zero.').max(1e12), justificativa: esquemaTextoMapa })).max(50),
    concentracaoExcedida: esquemaTextoMapa.nullable(),
    sacadoComRestricao: esquemaTextoMapa.nullable(),
  })
  .strict()
export const esquemaEnvioDiarioMapa = z.object({ ativo: z.boolean() }).strict()

// ------------------------------------------------------------------ arquivos e acesso

export const esquemaCategoriaArquivo = z.string().trim().min(1, 'Informe a categoria.').max(80)
export const esquemaTextoArquivo = z.string().trim().max(2000)
export const esquemaEtiquetasArquivo = z
  .record(z.string().trim().min(1).max(60), z.string().trim().max(500))
  .refine((t) => Object.keys(t).length <= 30, 'No máximo 30 etiquetas.')

/** Etiquetas digitadas uma por linha, no formato chave=valor. */
export function lerEtiquetas(texto: string): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const linha of texto.split('\n')) {
    const [k, ...resto] = linha.split('=')
    if (k?.trim()) tags[k.trim()] = resto.join('=').trim()
  }
  return tags
}

export const esquemaMotivoArquivo = z.object({ motivo: z.string().trim().min(5, 'Informe o motivo (mínimo 5 caracteres).').max(500) })

export const esquemaLoginEmergencia = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(254),
  senha: z.string().min(1, 'Informe a senha.').max(256),
  destino: z.string().max(500).optional(),
})

/**
 * Número digitado no padrão brasileiro → número; texto inválido → null.
 *   com vírgula: "1.234,56", "1234,5"     (ponto só como milhar)
 *   sem vírgula: "10.000", "1.234.567"    (milhares) · "1234.5", "12" (decimal/inteiro)
 * Aceita "R$" e espaços. Nunca devolve NaN.
 */
export function lerValorBr(texto: string): number | null {
  const v = texto.trim().replace(/^R\$/, '').replace(/\s/g, '')
  if (v === '') return null
  let n: number
  if (v.includes(',')) {
    if (!/^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(v)) return null
    n = Number(v.replace(/\./g, '').replace(',', '.'))
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) {
    n = Number(v.replace(/\./g, ''))
  } else if (/^-?\d+(\.\d+)?$/.test(v)) {
    n = Number(v)
  } else return null
  return Number.isFinite(n) ? n : null
}
