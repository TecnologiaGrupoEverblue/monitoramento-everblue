import type { ClassificacaoSemanal } from '../../models/types'
import { formatarData, ROTULO_PRIORIDADE_ORDEM, ROTULO_TENDENCIA } from '../../utils/formatters'
import { CriticidadeClassificadaBadge, EnquadramentoBadge } from '../ui/Badges'
import { Painel } from '../ui/Card'

/** Classificação semanal calculada pelas regras do comitê: prioridade,
 * enquadramento, criticidade, tendência da liquidez e os alertas que a
 * justificam — e a trilha das últimas semanas. */
export default function PainelClassificacao({ historico, semanaRef }: { historico: ClassificacaoSemanal[]; semanaRef: string | null }) {
  const atual = (semanaRef ? historico.find((c) => c.semanaRef === semanaRef) : null) ?? historico[historico.length - 1] ?? null
  return (
    <Painel titulo="Classificação semanal — regras do comitê" className="lg:col-span-2">
      {!atual ? (
        <p className="py-4 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Ainda sem classificação: ela é calculada na confirmação da próxima importação semanal.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              Posição de {formatarData(atual.semanaRef)}:
            </span>
            <span className="font-semibold">{ROTULO_PRIORIDADE_ORDEM[atual.prioridadeOrdem]}</span>
            <CriticidadeClassificadaBadge criticidade={atual.criticidade} />
            <EnquadramentoBadge enquadramento={atual.enquadramento} />
            <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              Liquidez: {ROTULO_TENDENCIA[atual.tendenciaLiquidez]} · {atual.qtdAlertas} alerta(s)
            </span>
          </div>
          {atual.motivosEnquadramento.length > 0 && atual.enquadramento !== 'APARTADO' && (
            <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              Desenquadramento: {atual.motivosEnquadramento.join(' · ')}
            </p>
          )}
          {atual.enquadramento === 'APARTADO' && (
            <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              {atual.motivosEnquadramento[0]}
            </p>
          )}
          {atual.alertas.length > 0 && (
            <ul className="flex flex-col gap-1">
              {atual.alertas.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className="mt-0.5 shrink-0 border-l-2 px-1.5 text-[10px] font-bold"
                    style={{
                      color: a.nivel === 'CRITICO' ? 'var(--cor-critico)' : 'var(--cor-atencao)',
                      backgroundColor: a.nivel === 'CRITICO' ? 'var(--cor-critico-fundo)' : 'var(--cor-atencao-fundo)',
                      borderColor: a.nivel === 'CRITICO' ? 'var(--cor-critico)' : 'var(--cor-atencao)',
                    }}
                  >
                    {a.nivel === 'CRITICO' ? 'CRÍTICO' : 'ATENÇÃO'}
                  </span>
                  <span className="min-w-0 break-words">{a.texto}</span>
                </li>
              ))}
            </ul>
          )}
          {atual.naoAvaliados && atual.naoAvaliados.length > 0 && (
            <p className="border-l-2 p-2 text-xs" style={{ borderColor: 'var(--cor-atencao)', backgroundColor: 'var(--cor-atencao-fundo)' }}>
              <strong>Não avaliado por falta de dado</strong> (ausência de alerta aqui não significa situação regular): {atual.naoAvaliados.join(' · ')}
            </p>
          )}
          {historico.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-2" style={{ borderColor: 'var(--cor-borda)' }}>
              <span className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                Últimas semanas:
              </span>
              {historico.slice(-8).map((c) => (
                <span key={c.semanaRef} className="flex items-center gap-1 text-[11px]" title={`${formatarData(c.semanaRef)} · ${c.qtdAlertas} alerta(s)`}>
                  {formatarData(c.semanaRef).slice(0, 5)} <CriticidadeClassificadaBadge criticidade={c.criticidade} />
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Painel>
  )
}
