import { useState } from 'react'
import { ErroApi } from '../../api/cliente'
import type { PlanoAcao } from '../../models/types'
import { planoAcaoRepository } from '../../repositories'
import { formatarData } from '../../utils/formatters'
import { StatusPlanoBadge } from '../ui/Badges'
import { Modal } from '../ui/Modal'

/** Andamento do plano: o que foi feito, o que não foi feito, prazo,
 * responsável, conclusão ou reabertura. Cada gravação vira evento no
 * histórico do cliente. */
export default function ModalAndamentoPlano({ plano, nomeCliente, aoFechar }: { plano: PlanoAcao; nomeCliente?: string; aoFechar: (atualizado: PlanoAcao | null) => void }) {
  const [feito, setFeito] = useState(plano.oQueFoiFeito ?? '')
  const [naoFeito, setNaoFeito] = useState(plano.oQueNaoFoiFeito ?? '')
  const [dataLimite, setDataLimite] = useState(plano.dataLimite)
  const [responsavel, setResponsavel] = useState(plano.responsavel)
  const [justificativa, setJustificativa] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const concluido = plano.status === 'CONCLUIDO'

  async function salvar(acao: 'salvar' | 'concluir' | 'reabrir') {
    setSalvando(true)
    setErro(null)
    try {
      const atualizado = await planoAcaoRepository.registrarAndamento(plano.id, {
        oQueFoiFeito: feito,
        oQueNaoFoiFeito: naoFeito,
        responsavel,
        dataLimite,
        justificativa: justificativa || undefined,
        ...(acao === 'concluir' ? { concluir: true } : acao === 'reabrir' ? { reabrir: true } : {}),
      })
      aoFechar(atualizado)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar o andamento.')
      setSalvando(false)
    }
  }

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
          <textarea rows={3} value={feito} onChange={(e) => setFeito(e.target.value)} maxLength={4000} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
            O que não foi feito
          </span>
          <textarea rows={3} value={naoFeito} onChange={(e) => setNaoFeito(e.target.value)} maxLength={4000} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
              Prazo (data-limite)
            </span>
            <input type="date" className="campo" value={dataLimite} onChange={(e) => setDataLimite(e.target.value)} disabled={concluido} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
              Responsável por fazer acontecer
            </span>
            <input className="campo" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} maxLength={200} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
            Observação para o histórico (opcional)
          </span>
          <input className="campo" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} maxLength={1000} placeholder="Ex.: prazo repactuado no comitê de 25/09" />
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
