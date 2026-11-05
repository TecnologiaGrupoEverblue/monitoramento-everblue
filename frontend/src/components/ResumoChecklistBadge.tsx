import { useQuery } from '@tanstack/react-query'
import { consultas } from '../consultas'

/** Selo compacto com a contagem de pontos críticos/atenção do Checklist de
 * Análise Semanal do cliente — para escanear a lista inteira sem abrir cada
 * ficha. Usado como coluna extra nas telas de Monitoramento, Saída de Risco
 * e Jurídico. */
export default function ResumoChecklistBadge({ clienteId, semanaRef }: { clienteId: string; semanaRef: string | null }) {
  const consulta = useQuery({ ...consultas.resumoChecklist(clienteId, semanaRef ?? ''), enabled: Boolean(semanaRef) })
  const resumo = consulta.data

  // Falha ao consultar não vira "tudo em dia" (fail-closed).
  if (consulta.isError) return <span className="text-xs" style={{ color: 'var(--cor-atencao)' }}>Indisponível</span>
  if (!resumo) return <span className="text-xs text-[color:var(--cor-texto-secundario)]">…</span>

  if (resumo.vermelho === 0 && resumo.amarelo === 0) {
    return (
      <span className="text-xs" style={{ color: 'var(--cor-normal)' }}>
        Tudo em dia
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 text-xs font-medium">
      {resumo.vermelho > 0 && <span style={{ color: 'var(--cor-critico)' }}>● {resumo.vermelho}</span>}
      {resumo.amarelo > 0 && <span style={{ color: 'var(--cor-atencao)' }}>● {resumo.amarelo}</span>}
    </span>
  )
}
