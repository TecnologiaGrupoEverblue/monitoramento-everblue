/** Checklist de Análise Semanal: sugestão automática (cruzando dado real) com
 * o que o executivo já salvou (parecer e/ou gravidade ajustada) por cima. */
import {
  semanaMesAnteriorRef,
  sugerirChecklist,
  type AlteracaoItemChecklist,
  type ChaveItemChecklist,
  type ItemChecklistView,
  type ResumoChecklist,
} from '@monitoramento/dominio'
import type { AlertaRepositorio } from '../repositorios/alertaRepositorio'
import type { CarteiraRepositorio } from '../repositorios/carteiraRepositorio'
import type { ChecklistRepositorio } from '../repositorios/checklistRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { PlanoAcaoRepositorio } from '../repositorios/planoAcaoRepositorio'
import type { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'
import type { ServicoCarteira } from './servicoCarteira'

export class ServicoChecklist {
  constructor(
    private readonly clientes: ClienteRepositorio,
    private readonly snapshots: SnapshotRepositorio,
    private readonly planos: PlanoAcaoRepositorio,
    private readonly alertas: AlertaRepositorio,
    private readonly carteira: CarteiraRepositorio,
    private readonly checklist: ChecklistRepositorio,
    private readonly servicoCarteira: ServicoCarteira,
  ) {}

  async obter(clienteId: string, semanaRef: string): Promise<ItemChecklistView[]> {
    const [cliente, serieCompleta, semanas, planos, alertas, juridico, salvos, analiseTransacional] = await Promise.all([
      this.clientes.porId(clienteId),
      this.snapshots.porCliente(clienteId),
      this.snapshots.semanasDisponiveis(),
      this.planos.porCliente(clienteId),
      this.alertas.porCliente(clienteId),
      this.carteira.juridicoDoCliente(clienteId),
      this.checklist.salvos(clienteId, semanaRef),
      this.servicoCarteira.analiseTransacional(clienteId),
    ])
    if (!cliente) return []

    const indiceAtual = serieCompleta.findIndex((s) => s.semanaRef === semanaRef)
    const snapshotAtual = indiceAtual >= 0 ? serieCompleta[indiceAtual] : null
    const snapshotAnterior = indiceAtual > 0 ? serieCompleta[indiceAtual - 1] : null
    const semanaMes = semanaMesAnteriorRef(semanas, semanaRef)
    const snapshotMesAnterior = semanaMes ? (serieCompleta.find((s) => s.semanaRef === semanaMes) ?? null) : null
    const serieRecente = indiceAtual >= 0 ? serieCompleta.slice(Math.max(0, indiceAtual - 7), indiceAtual + 1) : serieCompleta.slice(-8)

    const sugestoes = sugerirChecklist({
      cliente,
      snapshotAtual,
      snapshotAnterior,
      snapshotMesAnterior,
      serieRecente,
      planos,
      alertas: alertas.filter((a) => a.status !== 'RESOLVIDO'),
      juridico,
      analiseTransacional,
    })
    const salvosPorItem = new Map(salvos.map((s) => [s.item, s]))
    return sugestoes.map((sugestao) => {
      const salvo = salvosPorItem.get(sugestao.item)
      return {
        ...sugestao,
        gravidade: salvo?.gravidadeManual ? salvo.gravidade : sugestao.gravidade,
        parecer: salvo?.parecer ?? '',
        gravidadeManual: salvo?.gravidadeManual ?? false,
        persistido: Boolean(salvo),
        atualizadoEm: salvo?.atualizadoEm ?? null,
        atualizadoPor: salvo?.atualizadoPor ?? null,
      }
    })
  }

  async salvarItem(clienteId: string, semanaRef: string, item: ChaveItemChecklist, alteracoes: AlteracaoItemChecklist, atualizadoPor: string): Promise<void> {
    await this.checklist.salvar(clienteId, semanaRef, item, alteracoes, atualizadoPor)
  }

  async resumo(clienteId: string, semanaRef: string): Promise<ResumoChecklist> {
    const itens = await this.obter(clienteId, semanaRef)
    return {
      vermelho: itens.filter((i) => i.gravidade === 'VERMELHO').length,
      amarelo: itens.filter((i) => i.gravidade === 'AMARELO').length,
      verde: itens.filter((i) => i.gravidade === 'VERDE').length,
      semParecer: itens.filter((i) => !i.parecer.trim()).length,
    }
  }

  /** Resumos de vários clientes numa chamada (telas de lista). Concorrência
   * limitada para não ocupar o pool inteiro com uma única tela. */
  async resumos(clienteIds: string[], semanaRef: string, concorrencia = 4): Promise<Record<string, ResumoChecklist>> {
    const resultado: Record<string, ResumoChecklist> = {}
    const fila = [...new Set(clienteIds)]
    const trabalhadores = Array.from({ length: Math.min(concorrencia, fila.length) }, async () => {
      for (let id = fila.shift(); id !== undefined; id = fila.shift()) {
        resultado[id] = await this.resumo(id, semanaRef)
      }
    })
    await Promise.all(trabalhadores)
    return resultado
  }
}
