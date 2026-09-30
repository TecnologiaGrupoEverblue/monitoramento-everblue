import { useEffect, useState } from 'react'
import { checklistRepository } from '../repositories'

/** Selo compacto com a contagem de pontos críticos/atenção do Checklist de
 * Análise Semanal do cliente — para escanear a lista inteira sem abrir cada
 * ficha. Usado como coluna extra nas telas de Monitoramento, Saída de Risco
 * e Jurídico. */
export default function ResumoChecklistBadge({ clienteId, semanaRef }: { clienteId: string; semanaRef: string | null }) {
  const [resumo, setResumo] = useState<{ vermelho: number; amarelo: number } | null>(null)

  useEffect(() => {
    if (!semanaRef) return
    let ativo = true
    checklistRepository.resumo(clienteId, semanaRef).then((r) => {
      if (ativo) setResumo(r)
    })
    return () => {
      ativo = false
    }
  }, [clienteId, semanaRef])

  if (!resumo) return <span className="text-xs text-gray-300">…</span>

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
