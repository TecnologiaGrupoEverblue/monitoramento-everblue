import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { esquemaAndamentoPlano } from '@monitoramento/dominio'
import { ErroApi } from '../../api/cliente'
import { invalidar } from '../../consultas'
import type { PlanoAcao } from '../../models/types'
import { planoAcaoRepository } from '../../repositories'
import { formatarData } from '../../utils/formatters'
import { StatusPlanoBadge } from '../ui/Badges'
import { Modal } from '../ui/Modal'

/** Andamento do plano: o que foi feito, o que não foi feito, prazo,
 * responsável, conclusão ou reabertura. Cada gravação vira evento no
 * histórico do cliente. */
/** Campos do formulário: o mesmo esquema que a API aplica (dominio/esquemas). */
const esquemaFormulario = esquemaAndamentoPlano.pick({ oQueFoiFeito: true, oQueNaoFoiFeito: true, justificativa: true }).extend({
  dataLimite: esquemaAndamentoPlano.shape.dataLimite.unwrap(),
  responsavel: esquemaAndamentoPlano.shape.responsavel.unwrap(),
})
type Formulario = z.input<typeof esquemaFormulario>

export default function ModalAndamentoPlano({ plano, nomeCliente, aoFechar }: { plano: PlanoAcao; nomeCliente?: string; aoFechar: (atualizado: PlanoAcao | null) => void }) {
  const concluido = plano.status === 'CONCLUIDO'
  const clienteConsultas = useQueryClient()
  const { register, handleSubmit, formState } = useForm<Formulario>({
    resolver: zodResolver(esquemaFormulario),
    defaultValues: { oQueFoiFeito: plano.oQueFoiFeito ?? '', oQueNaoFoiFeito: plano.oQueNaoFoiFeito ?? '', dataLimite: plano.dataLimite, responsavel: plano.responsavel, justificativa: '' },
  })
  const gravar = useMutation({
    mutationFn: ({ dados, acao }: { dados: Formulario; acao: 'salvar' | 'concluir' | 'reabrir' }) =>
      planoAcaoRepository.registrarAndamento(plano.id, {
        oQueFoiFeito: dados.oQueFoiFeito ?? '',
        oQueNaoFoiFeito: dados.oQueNaoFoiFeito ?? '',
        responsavel: dados.responsavel,
        dataLimite: dados.dataLimite,
        justificativa: dados.justificativa || undefined,
        ...(acao === 'concluir' ? { concluir: true } : acao === 'reabrir' ? { reabrir: true } : {}),
      }),
    onSuccess: (atualizado) => {
      void invalidar(clienteConsultas, 'carteira')
      aoFechar(atualizado)
    },
  })
  const salvando = gravar.isPending
  const erro = gravar.error ? (gravar.error instanceof ErroApi ? gravar.error.message : 'Não foi possível salvar o andamento.') : null
  const salvar = (acao: 'salvar' | 'concluir' | 'reabrir') => void handleSubmit((dados) => gravar.mutate({ dados, acao }))()
  const erroCampo = (nome: keyof Formulario) => formState.errors[nome]?.message

  return (
    <Modal
      titulo="Andamento do plano de ação"
      subtitulo={
        <span className="flex flex-wrap items-center gap-2">
          {nomeCliente && <span>{nomeCliente} ·</span>}
          <span>Decidido em {formatarData(plano.dataDecisaoAtual)}</span>
          <StatusPlanoBadge status={plano.status} />
        </span>
      }
      aoFechar={() => aoFechar(null)}
      rodape={
        <>
          <button type="button" className="botao-secundario" onClick={() => aoFechar(null)} disabled={salvando}>
            Cancelar
          </button>
          {concluido ? (
            <button type="button" className="botao-secundario" onClick={() => salvar('reabrir')} disabled={salvando}>
              Reabrir plano
            </button>
          ) : (
            <button type="button" className="botao-secundario" onClick={() => salvar('concluir')} disabled={salvando}>
              Concluir plano
            </button>
          )}
          <button type="button" className="botao-primario" onClick={() => salvar('salvar')} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar andamento'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="border-l-2 p-2.5" style={{ borderColor: 'var(--cor-acao)', backgroundColor: 'var(--cor-fundo-recuado)' }}>
          <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--cor-texto-secundario)' }}>
            Decisão
          </p>
          <p className="font-medium">{plano.decisaoAtual}</p>
          {plano.decisaoAnterior && (
            <p className="mt-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              Decisão anterior ({formatarData(plano.dataDecisaoAnterior)}): {plano.decisaoAnterior}
            </p>
          )}
          <p className="mt-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
            Plano: {plano.plano}
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
            O que foi feito
          </span>
          <textarea rows={3} {...register('oQueFoiFeito')} maxLength={4000} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
            O que não foi feito
          </span>
          <textarea rows={3} {...register('oQueNaoFoiFeito')} maxLength={4000} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
              Prazo (data-limite)
            </span>
            <input type="date" className="campo" {...register('dataLimite')} disabled={concluido} aria-invalid={Boolean(erroCampo('dataLimite'))} />
            {erroCampo('dataLimite') && <span className="text-xs" style={{ color: 'var(--cor-critico)' }}>{erroCampo('dataLimite')}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
              Responsável por fazer acontecer
            </span>
            <input className="campo" {...register('responsavel')} maxLength={200} aria-invalid={Boolean(erroCampo('responsavel'))} />
            {erroCampo('responsavel') && <span className="text-xs" style={{ color: 'var(--cor-critico)' }}>{erroCampo('responsavel')}</span>}
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
            Observação para o histórico (opcional)
          </span>
          <input className="campo" {...register('justificativa')} maxLength={1000} placeholder="Ex.: prazo repactuado no comitê de 25/09" />
        </label>
        <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
          Prazo vencido sem conclusão marca o plano como <strong>atrasado</strong> automaticamente e o coloca na pauta do próximo comitê.
        </p>
        {erro && (
          <p role="alert" className="border-l-2 p-2 text-xs" style={{ borderColor: 'var(--cor-critico)', backgroundColor: 'var(--cor-critico-fundo)', color: 'var(--cor-critico)' }}>
            {erro}
          </p>
        )}
      </div>
    </Modal>
  )
}
