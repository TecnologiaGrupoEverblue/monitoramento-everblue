import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { formatarDataHora } from '../../utils/formatters'
import { consultas } from '../../consultas'

const INTERVALO_MS = 2 * 60_000

/**
 * Alerta quando a validação de acesso pela Intranet está fora: sem ela,
 * ninguém entra e as sessões não são renovadas (fail-closed). Aparece na tela
 * de login e no topo do sistema; some sozinho quando a Intranet volta.
 */
export default function AvisoIntranet({ variante }: { variante: 'login' | 'sistema' }) {
  const { data: estado } = useQuery({ ...consultas.saudeIntranet(), refetchInterval: INTERVALO_MS })

  if (estado?.situacao !== 'INDISPONIVEL') return null
  const desde = estado.desde ? ` desde ${formatarDataHora(estado.desde)}` : ''

  if (variante === 'login') {
    return (
      <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100" role="alert">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          A validação de acesso pela Intranet está indisponível{desde}. O login fica bloqueado até ela voltar — a equipe de TI precisa ser avisada.
        </span>
      </p>
    )
  }
  return (
    <div
      className="sem-impressao mx-auto mt-4 flex max-w-[1440px] items-start gap-2 rounded-lg border px-4 py-2 text-sm sm:mx-6 lg:mx-8"
      style={{ borderColor: 'var(--cor-critico)', color: 'var(--cor-critico)', background: 'var(--cor-critico-fundo)' }}
      role="alert"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>
        Intranet indisponível{desde}: novos logins e a renovação das sessões estão bloqueados. Avise a equipe de TI.
      </span>
    </div>
  )
}
