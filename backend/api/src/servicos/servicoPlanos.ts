/**
 * Andamento dos planos de ação: o que foi feito, o que não foi feito,
 * conclusão, reabertura e repactuação de prazo. Cada mudança deixa evento no
 * histórico do cliente e trilha de auditoria — o comitê seguinte enxerga
 * exatamente o que mudou e quem mudou.
 */
import type { AndamentoPlano, PlanoAcao } from '@monitoramento/dominio'
import type { Banco } from '../infra/banco'
import type { AuditoriaRepositorio } from '../repositorios/auditoriaRepositorio'
import type { EventoRepositorio } from '../repositorios/eventoRepositorio'
import type { PlanoAcaoRepositorio } from '../repositorios/planoAcaoRepositorio'
import { ErroNegocio } from './servicoComite'

export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

export class ServicoPlanos {
  constructor(
    private readonly banco: Banco,
    private readonly planos: PlanoAcaoRepositorio,
    private readonly eventos: EventoRepositorio,
    private readonly auditoria: AuditoriaRepositorio,
  ) {}

  async registrarAndamento(planoId: string, dados: AndamentoPlano, ator: { id: string; nome: string; email: string }): Promise<PlanoAcao> {
    if (dados.concluir && dados.reabrir) throw new ErroNegocio('Informe concluir OU reabrir, não os dois.', 400, 'pedido_invalido')
    return this.banco.transacao(async (tx) => {
      const atual = await this.planos.porId(planoId, tx, true)
      if (!atual) throw new ErroNegocio('Plano de ação não encontrado.', 404, 'nao_encontrado')
      if (atual.status === 'CONCLUIDO' && !dados.reabrir && ((dados.dataLimite && dados.dataLimite !== atual.dataLimite) || dados.concluir)) {
        throw new ErroNegocio('Plano concluído: reabra antes de mudar prazo.', 409, 'plano_concluido')
      }

      const hoje = hojeSaoPaulo()
      const dataLimite = dados.dataLimite ?? atual.dataLimite
      if (dados.dataLimite && dados.dataLimite < atual.dataDecisaoAtual) {
        throw new ErroNegocio('O prazo não pode ser anterior à data da decisão.', 422, 'prazo_invalido')
      }
      let status = atual.status
      let concluidoEm = atual.concluidoEm ?? null
      if (dados.concluir) {
        status = 'CONCLUIDO'
        concluidoEm = new Date().toISOString()
      } else if (dados.reabrir || status !== 'CONCLUIDO') {
        status = dataLimite < hoje ? 'ATRASADO' : 'EM_DIA'
        if (dados.reabrir) concluidoEm = null
      }

      const novo = {
        oQueFoiFeito: dados.oQueFoiFeito !== undefined ? dados.oQueFoiFeito || null : atual.oQueFoiFeito,
        oQueNaoFoiFeito: dados.oQueNaoFoiFeito !== undefined ? dados.oQueNaoFoiFeito || null : atual.oQueNaoFoiFeito,
        responsavel: dados.responsavel?.trim() || atual.responsavel,
        dataLimite,
        status,
      }
      const mudancas: string[] = []
      if (novo.status !== atual.status) mudancas.push(`status ${atual.status} → ${novo.status}`)
      if (novo.dataLimite !== atual.dataLimite) mudancas.push(`prazo ${atual.dataLimite.split('-').reverse().join('/')} → ${novo.dataLimite.split('-').reverse().join('/')}`)
      if (novo.responsavel !== atual.responsavel) mudancas.push(`responsável ${atual.responsavel} → ${novo.responsavel}`)
      if (novo.oQueFoiFeito !== atual.oQueFoiFeito) mudancas.push('o que foi feito atualizado')
      if (novo.oQueNaoFoiFeito !== atual.oQueNaoFoiFeito) mudancas.push('o que não foi feito atualizado')
      if (mudancas.length === 0) return atual

      const gravado = await this.planos.gravarAndamento(planoId, { ...novo, concluidoEm, atualizadoPor: ator.nome }, tx)
      await this.eventos.registrar(
        {
          clienteId: atual.clienteId,
          data: new Date().toISOString(),
          usuario: ator.nome,
          tipo: 'PLANO_ACAO',
          valorAnterior: atual.status,
          valorNovo: novo.status,
          justificativa: `Plano "${atual.decisaoAtual.slice(0, 120)}": ${mudancas.join('; ')}.${dados.justificativa ? ` ${dados.justificativa.trim()}` : ''}`.slice(0, 2000),
          decisaoComiteId: atual.comiteOrigemId,
        },
        tx,
      )
      await this.auditoria.registrar(
        { acao: 'plano.andamento', atorId: ator.id, atorEmail: ator.email, recursoTipo: 'plano_acao', recursoId: planoId, detalhes: { mudancas } },
        tx,
      )
      return gravado!
    })
  }
}
