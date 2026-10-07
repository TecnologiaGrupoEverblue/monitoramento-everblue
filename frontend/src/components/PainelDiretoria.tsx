import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PainelSemanal, PontoPainelSemanal } from '../models/types'
import { formatarData, formatarMoeda, formatarPercentual } from '../utils/formatters'
import { Painel } from './ui/Card'

type Indicador = {
  titulo: string
  valor: (p: PontoPainelSemanal) => number
  formatar: (v: number) => string
  formatarDelta: (d: number) => string
  detalhe?: (p: PontoPainelSemanal) => string
}

const pp = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} p.p.`
const qtd = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d)}`

const INDICADORES: Indicador[] = [
  { titulo: 'Clientes críticos', valor: (p) => p.qtdCriticos, formatar: String, formatarDelta: qtd, detalhe: (p) => `${formatarMoeda(p.riscoCritico)} em risco · ${p.qtdAtencao} em atenção` },
  { titulo: 'Vencido', valor: (p) => p.vencido, formatar: formatarMoeda, formatarDelta: (d) => `${d >= 0 ? '+' : '−'} ${formatarMoeda(Math.abs(d))}`, detalhe: (p) => `${formatarPercentual(p.percVencido, 2)} do risco` },
  { titulo: 'Consumo do limite', valor: (p) => p.percConsumoLimite, formatar: (v) => formatarPercentual(v, 1), formatarDelta: pp, detalhe: (p) => `${formatarMoeda(p.risco)} de ${formatarMoeda(p.limiteGlobal)}` },
  { titulo: 'Planos atrasados', valor: (p) => p.planosAtrasados, formatar: String, formatarDelta: qtd },
]

/** Painel semanal da diretoria: os quatro números que o comitê acompanha,
 * comparados com a semana anterior, e a evolução recente. Subir é piorar em
 * todos eles — por isso o aumento sai em vermelho. */
export default function PainelDiretoria({ painel }: { painel: PainelSemanal }) {
  const { atual, anterior, serie } = painel
  if (!atual) return null
  const dados = serie.map((p) => ({ ...p, rotulo: formatarData(p.semana) }))
  const naoClassificadas = serie.filter((p) => !p.classificada).length
  return (
    <Painel titulo={`Painel semanal da diretoria — ${formatarData(atual.semana)}${anterior ? ` vs. ${formatarData(anterior.semana)}` : ''}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {INDICADORES.map((ind) => {
          const v = ind.valor(atual)
          const delta = anterior ? v - ind.valor(anterior) : null
          const cor = delta === null || Math.abs(delta) < 1e-9 ? 'var(--cor-texto-secundario)' : delta > 0 ? 'var(--cor-critico)' : 'var(--cor-normal)'
          return (
            <div key={ind.titulo} className="border px-3 py-2.5" style={{ borderColor: 'var(--cor-borda)' }}>
              <p className="text-[12px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                {ind.titulo}
              </p>
              <p className="fonte-editorial numeros-tabulares text-xl font-semibold">{ind.formatar(v)}</p>
              <p className="numeros-tabulares text-[11px] font-medium" style={{ color: cor }}>
                {delta === null ? 'sem semana anterior' : `${ind.formatarDelta(delta)} vs. semana anterior`}
              </p>
              {ind.detalhe && (
                <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                  {ind.detalhe(atual)}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {serie.length > 1 && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              Críticos e planos atrasados
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dados} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="qtdCriticos" name="Críticos" stroke="var(--cor-critico)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="planosAtrasados" name="Planos atrasados" stroke="var(--cor-atencao)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="mb-1 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              % vencido e consumo do limite
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dados} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v) => formatarPercentual(Number(v), 2)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="percVencido" name="% vencido" stroke="var(--cor-critico)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="percConsumoLimite" name="Consumo do limite" stroke="var(--cor-destaque)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        Carteira Everblue inteira (carteiras apartadas fora). Críticos pela classificação semanal do comitê
        {naoClassificadas > 0 ? `; ${naoClassificadas} semana(s) anterior(es) à versão 1.1 classificada(s) agora, com as regras atuais` : ''}.
      </p>
    </Painel>
  )
}
