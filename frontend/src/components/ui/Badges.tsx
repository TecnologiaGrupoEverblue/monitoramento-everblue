import { criticidadeClassificadaCor, criticidadeCor, enquadramentoCor, gravidadeCor, prioridadeCor, statusCor, statusPlanoCor } from '../../theme/colors'
import { CRITICIDADE_LABEL, GRAVIDADE_LABEL, PRIORIDADE_LABEL, ROTULO_CRITICIDADE_CLASSIFICADA, ROTULO_ENQUADRAMENTO, STATUS_LABEL, STATUS_PLANO_LABEL } from '../../utils/formatters'

/** Etiqueta de classificação no padrão da Intranet: pílula com fundo
 * suave e texto na cor do status, sem borda. A mesma em todo o sistema. */
function Badge({ texto, cor, fundo }: { texto: string; cor: string; fundo: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: cor, backgroundColor: fundo }}
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

export function CriticidadeClassificadaBadge({ criticidade }: { criticidade: string }) {
  const cor = criticidadeClassificadaCor[criticidade] ?? criticidadeClassificadaCor.REGULAR
  return <Badge texto={(ROTULO_CRITICIDADE_CLASSIFICADA as Record<string, string>)[criticidade] ?? criticidade} cor={cor.texto} fundo={cor.fundo} />
}

export function EnquadramentoBadge({ enquadramento }: { enquadramento: string }) {
  const cor = enquadramentoCor[enquadramento] ?? enquadramentoCor.ENQUADRADO
  return <Badge texto={(ROTULO_ENQUADRAMENTO as Record<string, string>)[enquadramento] ?? enquadramento} cor={cor.texto} fundo={cor.fundo} />
}
