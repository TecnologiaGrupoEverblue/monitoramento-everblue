import { criticidadeCor, gravidadeCor, prioridadeCor, statusCor, statusPlanoCor } from '../../theme/colors'
import { CRITICIDADE_LABEL, GRAVIDADE_LABEL, PRIORIDADE_LABEL, STATUS_LABEL, STATUS_PLANO_LABEL } from '../../utils/formatters'

/** Etiqueta de classificação — um carimbo retangular com borda à esquerda,
 * não uma pílula. É a mesma linguagem em qualquer lugar do sistema onde um
 * status/risco precisa ser identificado de relance. */
function Badge({ texto, cor, fundo }: { texto: string; cor: string; fundo: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md border-l-2 px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap"
      style={{ color: cor, backgroundColor: fundo, borderColor: cor }}
    >
      {texto}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const cor = statusCor[status] ?? statusCor.NORMAL
  return <Badge texto={STATUS_LABEL[status] ?? status} cor={cor.texto} fundo={cor.fundo} />
}

export function CriticidadeBadge({ criticidade }: { criticidade: string }) {
  const cor = criticidadeCor[criticidade] ?? criticidadeCor.NORMAL
  return <Badge texto={CRITICIDADE_LABEL[criticidade] ?? criticidade} cor={cor.texto} fundo={cor.fundo} />
}

export function GravidadeBadge({ gravidade }: { gravidade: string }) {
  const cor = gravidadeCor[gravidade] ?? gravidadeCor.VERDE
  return <Badge texto={GRAVIDADE_LABEL[gravidade] ?? gravidade} cor={cor.texto} fundo={cor.fundo} />
}

export function PrioridadeBadge({ prioridade }: { prioridade: string }) {
  const cor = prioridadeCor[prioridade] ?? prioridadeCor.BAIXA
  return <Badge texto={PRIORIDADE_LABEL[prioridade] ?? prioridade} cor={cor.texto} fundo={cor.fundo} />
}

export function StatusPlanoBadge({ status }: { status: string }) {
  const cor = statusPlanoCor[status] ?? statusPlanoCor.EM_DIA
  return <Badge texto={STATUS_PLANO_LABEL[status] ?? status} cor={cor.texto} fundo={cor.fundo} />
}
