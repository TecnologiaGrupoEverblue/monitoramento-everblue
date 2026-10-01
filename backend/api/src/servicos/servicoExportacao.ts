/**
 * Exportações geradas pelo servidor. Todo arquivo exportado é GUARDADO no
 * MinIO (finalidade `exportado`) antes de ser entregue: fica rastreável quem
 * exportou o quê, quando, com quais filtros e o hash exato do que saiu.
 *
 * Aberto para extensão: uma exportação nova é um `Exportador` registrado na
 * composição — nenhum `switch` central muda.
 */
import type { ArquivoResumo, ClienteEnriquecido, FiltrosGlobais, PlanoAcao } from '@monitoramento/dominio'
import { ErroNegocio } from './servicoComite'
import type { Ator, ServicoArquivos } from './servicoArquivos'

export interface ConteudoExportado {
  conteudo: Buffer
  nomeArquivo: string
  descricao: string
}

export interface Exportador {
  chave: string
  titulo: string
  gerar(filtros: Partial<FiltrosGlobais>): Promise<ConteudoExportado>
}

// ------------------------------------------------------------ CSV

/** CSV para Excel pt-BR: separador `;`, vírgula decimal, BOM UTF-8. Texto
 * que começa com = + - @ recebe apóstrofo (injeção de fórmula). */
export function gerarCsv(cabecalho: string[], linhas: (string | number | null | undefined)[][]): Buffer {
  const celula = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : ''
    let t = String(v)
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const texto = [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n')
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(texto, 'utf8')])
}

const carimbo = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

export function exportadorCarteira(listar: (f: Partial<FiltrosGlobais>) => Promise<ClienteEnriquecido[]>): Exportador {
  return {
    chave: 'carteira',
    titulo: 'Carteira monitorada',
    async gerar(filtros) {
      const clientes = await listar(filtros)
      const cabecalho = [
        'Cliente', 'CNPJ', 'Grupo econômico', 'Gerente', 'Plataforma', 'Setor', 'Status', 'Prioridade', 'Criticidade', 'Responsável',
        'Semana', 'Risco do cliente (R$)', 'Risco do grupo (R$)', 'Limite global (R$)', '% consumo do limite', 'Vencido oficial (R$)',
        'Aging (dias)', 'IL30', 'IL90', 'IL180', 'Restritivos', 'Alertas abertos', 'Planos pendentes',
      ]
      const linhas = clientes.map((c) => {
        const s = c.snapshotAtual
        return [
          c.nome, c.cnpj, c.grupoEconomico?.nome, c.gerente?.nome, c.plataforma?.nome, c.setor, c.status, c.prioridade, c.criticidade, c.responsavel,
          s?.semanaRef ?? null, s?.riscoCliente, s?.riscoGrupo, s?.limiteGlobal, s?.percConsumoLimite, s?.vencidoOficial,
          s?.agingCarteiraDias, s?.il30, s?.il90, s?.il180, s?.restritivos, c.alertasAbertos.length, c.planosPendentes.length,
        ]
      })
      const semana = clientes.find((c) => c.snapshotAtual)?.snapshotAtual?.semanaRef
      return {
        conteudo: gerarCsv(cabecalho, linhas),
        nomeArquivo: `carteira_${semana ?? 'sem-posicao'}_${carimbo()}.csv`,
        descricao: `Carteira monitorada — ${clientes.length} cliente(s)${semana ? `, posição de ${semana.split('-').reverse().join('/')}` : ''}`,
      }
    },
  }
}

export function exportadorPlanos(
  listarPlanos: () => Promise<PlanoAcao[]>,
  listarClientes: (f: Partial<FiltrosGlobais>) => Promise<{ id: string; nome: string; cnpj: string }[]>,
): Exportador {
  return {
    chave: 'planos-de-acao',
    titulo: 'Planos de ação',
    async gerar(filtros) {
      const [planos, clientes] = await Promise.all([listarPlanos(), listarClientes(filtros)])
      const porId = new Map(clientes.map((c) => [c.id, c]))
      const selecionados = planos.filter((p) => porId.has(p.clienteId))
      const cabecalho = ['Cliente', 'CNPJ', 'Decisão atual', 'Data da decisão', 'Plano', 'Responsável', 'Prazo', 'Status', 'O que foi feito', 'O que não foi feito']
      const linhas = selecionados.map((p) => {
        const c = porId.get(p.clienteId)!
        return [c.nome, c.cnpj, p.decisaoAtual, p.dataDecisaoAtual, p.plano, p.responsavel, p.dataLimite, p.status, p.oQueFoiFeito, p.oQueNaoFoiFeito]
      })
      return { conteudo: gerarCsv(cabecalho, linhas), nomeArquivo: `planos-de-acao_${carimbo()}.csv`, descricao: `Planos de ação — ${selecionados.length} registro(s)` }
    },
  }
}

export class ServicoExportacao {
  private readonly exportadores: Map<string, Exportador>

  constructor(
    private readonly arquivos: ServicoArquivos,
    exportadores: Exportador[],
  ) {
    this.exportadores = new Map(exportadores.map((e) => [e.chave, e]))
  }

  disponiveis(): { chave: string; titulo: string }[] {
    return [...this.exportadores.values()].map(({ chave, titulo }) => ({ chave, titulo }))
  }

  async exportar(chave: string, filtros: Partial<FiltrosGlobais>, ator: Ator): Promise<ArquivoResumo> {
    const exportador = this.exportadores.get(chave)
    if (!exportador) throw new ErroNegocio('Exportação inexistente.', 404, 'exportacao_inexistente')
    const gerado = await exportador.gerar(filtros)
    const filtrosAtivos = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    return this.arquivos.guardarGerado(
      gerado.conteudo,
      { nomeOriginal: gerado.nomeArquivo, finalidade: 'exportado', categoria: chave, descricao: gerado.descricao, tags: { exportacao: chave, ...filtrosAtivos } },
      ator,
    )
  }
}
