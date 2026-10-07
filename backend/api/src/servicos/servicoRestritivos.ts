/**
 * Lançamento manual (ou correção) do quadro restritivo de um cliente numa
 * semana. Compara com a última posição anterior: piora gera alerta e tudo
 * fica no histórico do cliente.
 */
import {
  compararRestritivos,
  descreverVariacao,
  TIPOS_ALERTA,
  type LinhaRestritivo,
  type RestritivoSemanal,
} from '@monitoramento/dominio'
import type { Banco } from '../infra/banco'
import type { AlertaRepositorio } from '../repositorios/alertaRepositorio'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { ConfiguracaoRepositorio } from '../repositorios/configuracaoRepositorio'
import type { EventoRepositorio } from '../repositorios/eventoRepositorio'
import type { RestritivoRepositorio } from '../repositorios/restritivoRepositorio'
import type { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'
import { ErroNegocio } from './servicoComite'

export interface ResultadoRestritivos {
  restritivos: RestritivoSemanal[]
  pioras: string[]
  alertaGerado: boolean
}

export class ServicoRestritivos {
  constructor(
    private readonly banco: Banco,
    private readonly restritivos: RestritivoRepositorio,
    private readonly clientes: ClienteRepositorio,
    private readonly eventos: EventoRepositorio,
    private readonly alertas: AlertaRepositorio,
    private readonly configuracoes: ConfiguracaoRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly snapshots: SnapshotRepositorio,
  ) {}

  async gravar(
    clienteId: string,
    semanaRef: string,
    linhas: (LinhaRestritivo & { observacao?: string | null })[],
    ator: { id: string; nome: string; email: string },
  ): Promise<ResultadoRestritivos> {
    const cliente = await this.clientes.porId(clienteId)
    if (!cliente) throw new ErroNegocio('Cliente não encontrado.', 404, 'nao_encontrado')
    // Só se lança restritivo numa posição que existe para o cliente: data
    // solta criaria uma "semana" que nenhuma comparação enxerga.
    if (!(await this.snapshots.porClienteESemana(clienteId, semanaRef))) {
      throw new ErroNegocio('Não há posição importada deste cliente nesta semana. Escolha uma posição existente.', 422, 'semana_inexistente')
    }
    const tipos = new Set(linhas.map((l) => l.tipo))
    if (tipos.size !== linhas.length) throw new ErroNegocio('Cada tipo de restritivo aparece uma vez só.', 400, 'tipo_repetido')

    const posicoes = await this.restritivos.atualEAnterior([clienteId], semanaRef)
    const anterior = posicoes.get(clienteId)?.anterior ?? null
    const pioras = compararRestritivos(linhas, anterior?.linhas ?? null).filter((v) => v.piorou).map(descreverVariacao)
    const cfg = (await this.configuracoes.listarAlertas()).find((c) => c.tipo === 'ALTERACAO_RESTRITIVOS' && c.ativo)
    const agora = new Date().toISOString()

    await this.banco.transacao(async (tx) => {
      const antes = await this.restritivos.gravarSemana(clienteId, semanaRef, linhas, 'MANUAL', ator.nome, tx)
      const semana = semanaRef.split('-').reverse().join('/')
      await this.eventos.registrar(
        {
          clienteId,
          data: agora,
          usuario: ator.nome,
          tipo: 'RESTRITIVOS',
          valorAnterior: antes.length ? antes.map((r) => `${r.tipo}:${r.quantidade}/${r.valor}`).join(' ') : null,
          valorNovo: linhas.map((r) => `${r.tipo}:${r.quantidade}/${r.valor}`).join(' ') || null,
          justificativa: (pioras.length > 0
            ? `Quadro restritivo de ${semana} lançado com piora frente a ${anterior!.semanaRef.split('-').reverse().join('/')}: ${pioras.join('; ')}.`
            : `Quadro restritivo de ${semana} lançado${anterior ? ' sem piora frente à posição anterior' : ''}.`
          ).slice(0, 2000),
          decisaoComiteId: null,
        },
        tx,
      )
      if (cfg && pioras.length > 0) {
        await this.alertas.criarMuitos(
          [{ clienteId, tipo: cfg.descricao ?? TIPOS_ALERTA.ALTERACAO_RESTRITIVOS, gravidade: cfg.gravidadeSugerida, data: agora, descricao: `Piora de restritivos: ${pioras.join('; ')}`, status: 'ABERTO', responsavel: cliente.responsavel }],
          tx,
        )
      }
      await this.auditoria.registrar(
        { acao: 'restritivos.gravados', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'cliente', recursoId: clienteId, detalhes: { semanaRef, tipos: [...tipos], pioras: pioras.length } },
        tx,
      )
    })
    return { restritivos: await this.restritivos.porCliente(clienteId), pioras, alertaGerado: Boolean(cfg && pioras.length > 0) }
  }
}
