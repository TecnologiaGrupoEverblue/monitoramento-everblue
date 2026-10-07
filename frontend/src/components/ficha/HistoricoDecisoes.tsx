import { useState } from 'react'
import type { PlanoAcao } from '../../models/types'
import { formatarData, formatarDataHora } from '../../utils/formatters'
import ModalAndamentoPlano from '../comite/ModalAndamentoPlano'
import { StatusPlanoBadge } from '../ui/Badges'
import { Painel } from '../ui/Card'

/** Linha do tempo das decisões do comitê para o cliente — decisão anterior →
 * nova decisão, plano, responsável, prazo e o andamento (feito / não feito). */
export default function HistoricoDecisoes({
  planos,
  podeEditar,
  aoAtualizar,
}: {
  planos: PlanoAcao[]
  podeEditar: boolean
  aoAtualizar: (plano: PlanoAcao) => void
}) {
  const [editando, setEditando] = useState<PlanoAcao | null>(null)
  const ordenados = [...planos].sort((a, b) => b.dataDecisaoAtual.localeCompare(a.dataDecisaoAtual) || b.id.localeCompare(a.id))
  return (
    <Painel titulo={`Histórico de decisões do comitê (${planos.length})`} className="lg:col-span-2">
      {ordenados.length === 0 ? (
        <p className="py-4 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Nenhuma decisão registrada. Decisões entram pelo Modo de Revisão do comitê.
        </p>
      ) : (
        <ol className="flex flex-col gap-3 border-l-2 pl-4" style={{ borderColor: 'var(--cor-borda)' }}>
          {ordenados.map((p) => (
            <li key={p.id} className="relative text-sm">
              <span
                className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: p.status === 'ATRASADO' ? 'var(--cor-critico)' : p.status === 'CONCLUIDO' ? 'var(--cor-normal)' : 'var(--cor-acao)' }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold" style={{ color: 'var(--cor-texto-secundario)' }}>
                  Comitê de {formatarData(p.dataDecisaoAtual)}
                </span>
                <StatusPlanoBadge status={p.status} />
                <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                  Prazo {formatarData(p.dataLimite)} · {p.responsavel}
                </span>
                {podeEditar && (
                  <button type="button" onClick={() => setEditando(p)} className="alvo-toque ml-auto text-xs font-medium underline" style={{ color: 'var(--cor-destaque)' }}>
                    Registrar andamento
                  </button>
                )}
              </div>
              {p.decisaoAnterior && (
                <p className="mt-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                  Decisão anterior ({formatarData(p.dataDecisaoAnterior)}): {p.decisaoAnterior}
                </p>
              )}
              <p className="mt-0.5 font-medium">{p.decisaoAtual}</p>
              <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                Plano: {p.plano}
              </p>
              {p.oQueFoiFeito && (
                <p className="mt-1 text-xs" style={{ color: 'var(--cor-normal)' }}>
                  Feito: {p.oQueFoiFeito}
                </p>
              )}
              {p.oQueNaoFoiFeito && (
                <p className="text-xs" style={{ color: 'var(--cor-critico)' }}>
                  Não feito: {p.oQueNaoFoiFeito}
                </p>
              )}
              {p.atualizadoEm && (
                <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                  Atualizado em {formatarDataHora(p.atualizadoEm)} por {p.atualizadoPor}
                  {p.concluidoEm ? ` · concluído em ${formatarData(p.concluidoEm.slice(0, 10))}` : ''}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {editando && (
        <ModalAndamentoPlano
          plano={editando}
          aoFechar={(atualizado) => {
            setEditando(null)
            if (atualizado) aoAtualizar(atualizado)
          }}
        />
      )}
    </Painel>
  )
}
