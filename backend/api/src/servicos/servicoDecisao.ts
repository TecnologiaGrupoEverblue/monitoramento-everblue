/**
 * Registro de decisão do comitê (Modo de Revisão): cria o plano de ação e o
 * evento histórico na MESMA transação, vinculados ao comitê planejado.
 *
 * Quem registrou é a pessoa da sessão — nunca um texto livre vindo da tela.
 * "Responsável" (quem executa o plano) continua sendo dado de negócio editável.
 */
import type { PlanoAcao } from '@monitoramento/dominio'
import type { Banco } from '../infra/banco'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import type { EventoRepositorio } from '../repositorios/eventoRepositorio'
import type { PlanoAcaoRepositorio } from '../repositorios/planoAcaoRepositorio'
import { ErroNegocio } from './servicoComite'

export interface NovaDecisao {
  clienteId: string
  decisao: string
  plano: string
  prazo: string
  responsavel: string
}

export class ServicoDecisao {
  constructor(
    private readonly banco: Banco,
    private readonly planos: PlanoAcaoRepositorio,
    private readonly eventos: EventoRepositorio,
    private readonly clientes: ClienteRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
    private readonly garantirComite: () => Promise<{ id: string }>,
  ) {}

  async registrar(dados: NovaDecisao, ator: { id: string; nome: string; email: string }): Promise<PlanoAcao> {
    const cliente = await this.clientes.porId(dados.clienteId)
    if (!cliente) throw new ErroNegocio('Cliente não encontrado.', 404, 'nao_encontrado')
    const [comite, anteriores] = await Promise.all([this.garantirComite(), this.planos.porCliente(dados.clienteId)])
    const ultimo = anteriores[anteriores.length - 1] ?? null
    const hoje = new Date().toISOString().slice(0, 10)

    return this.banco.transacao(async (tx) => {
      const plano = await this.planos.criar(
        {
          clienteId: cliente.id,
          comiteOrigemId: comite?.id ?? null,
          decisaoAnterior: ultimo?.decisaoAtual ?? null,
          dataDecisaoAnterior: ultimo?.dataDecisaoAtual ?? null,
          decisaoAtual: dados.decisao,
          dataDecisaoAtual: hoje,
          prazoRegularizacao: dados.prazo,
          plano: dados.plano || 'A definir.',
          responsavel: dados.responsavel || cliente.responsavel,
          oQueFoiFeito: null,
          oQueNaoFoiFeito: null,
          status: 'EM_DIA',
          dataLimite: dados.prazo,
          evidencias: [],
        },
        tx,
      )
      await this.eventos.registrar(
        {
          clienteId: cliente.id,
          data: new Date().toISOString(),
          usuario: ator.nome,
          tipo: 'DECISAO_COMITE',
          valorAnterior: ultimo?.decisaoAtual ?? null,
          valorNovo: dados.decisao,
          justificativa: dados.plano || 'Decisão registrada no Modo de Revisão do Comitê.',
          decisaoComiteId: comite?.id ?? null,
        },
        tx,
      )
      await this.auditoria.registrar(
        { acao: 'comite.decisao', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'cliente', recursoId: cliente.id, detalhes: { planoId: plano.id, comiteId: comite?.id ?? null } },
        tx,
      )
      return plano
    })
  }
}
