import { useEffect, useState } from 'react'
import { ptBR } from 'date-fns/locale'
import { format } from 'date-fns'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { movimentoContaRepository } from '../repositories'
import type { AnaliseTransacional } from '../regras/motorTransacional'
import { gravidadeCor } from '../theme/colors'
import { formatarMoeda, formatarMoedaCompacta } from '../utils/formatters'
import { GravidadeBadge } from './ui/Badges'

function mesLabel(mesRef: string): string {
  return format(new Date(`${mesRef}T00:00:00`), 'MMM/yy', { locale: ptBR })
}

function StatComparativo({
  titulo,
  recente,
  referencia,
  variacaoPerc,
  formato,
}: {
  titulo: string
  recente: number
  referencia: number
  variacaoPerc: number | null
  formato: 'moeda' | 'numero'
}) {
  const fmt = (v: number) => (formato === 'moeda' ? formatarMoeda(v) : v.toFixed(0))
  const caiu = variacaoPerc !== null && variacaoPerc < 0
  return (
    <div className="border p-2.5" style={{ borderColor: 'var(--cor-borda)' }}>
      <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        {titulo}
      </p>
      <p className="fonte-editorial numeros-tabulares text-lg font-semibold" style={{ color: 'var(--cor-texto-primario)' }}>
        {fmt(recente)}
        <span className="ml-1 text-xs font-normal" style={{ color: 'var(--cor-texto-secundario)' }}>
          /mês
        </span>
      </p>
      <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        Período anterior: {fmt(referencia)}
        {variacaoPerc !== null && (
          <span className="ml-1 font-semibold" style={{ color: caiu ? 'var(--cor-critico)' : 'var(--cor-normal)' }}>
            {caiu ? '▼' : '▲'} {Math.abs(variacaoPerc).toFixed(0)}%
          </span>
        )}
      </p>
    </div>
  )
}

/** Análise Transacional — Conta Movimento: cruza os últimos 6 meses de
 * entradas, saídas, frequência e maior pagamento pra responder se o
 * cliente ainda movimenta a conta com regularidade, comparando os últimos
 * 3 meses contra os 3 anteriores e sinalizando pagamentos fora do padrão. */
export default function PainelTransacional({ clienteId }: { clienteId: string }) {
  const [analise, setAnalise] = useState<AnaliseTransacional | null | undefined>(undefined)

  useEffect(() => {
    let ativo = true
    setAnalise(undefined)
    movimentoContaRepository.analise(clienteId).then((a) => {
      if (ativo) setAnalise(a)
    })
    return () => {
      ativo = false
    }
  }, [clienteId])

  if (analise === undefined) return <p className="text-xs text-gray-400">Carregando análise transacional…</p>
  if (analise === null) return <p className="text-xs text-gray-400">Sem movimento de conta registrado para este cliente.</p>

  const dadosGrafico = analise.meses.map((m) => ({
    mes: mesLabel(m.mesRef),
    entradas: m.entradas,
    saidas: m.saidas,
    qtdTransacoes: m.qtdTransacoes,
    atipico: m.atipico,
  }))

  return (
    <div className="border bg-[var(--cor-superficie-solida)] p-4" style={{ borderColor: 'var(--cor-borda)' }}>
      <div className="mb-2 flex items-center justify-between border-b pb-1.5" style={{ borderColor: 'var(--cor-borda)' }}>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)' }}>
          Análise Transacional — Conta Movimento
        </p>
        <GravidadeBadge gravidade={analise.gravidade} />
      </div>
      <p className="mb-3 text-[12.5px]" style={{ color: 'var(--cor-texto-primario)' }}>
        {analise.resumo}
      </p>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatComparativo titulo="Volume médio (entradas + saídas)" recente={analise.mediaVolumeRecente} referencia={analise.mediaVolumeReferencia} variacaoPerc={analise.variacaoVolumePerc} formato="moeda" />
        <StatComparativo titulo="Frequência de transações" recente={analise.mediaFrequenciaRecente} referencia={analise.mediaFrequenciaReferencia} variacaoPerc={analise.variacaoFrequenciaPerc} formato="numero" />
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={dadosGrafico} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
          <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="valores" tickFormatter={(v) => formatarMoedaCompacta(Number(v))} tick={{ fontSize: 10 }} width={70} />
          <YAxis yAxisId="qtd" orientation="right" tick={{ fontSize: 10 }} width={36} allowDecimals={false} />
          <Tooltip
            formatter={(v, nome) => (nome === 'Transações/mês' ? [String(v), nome] : [formatarMoeda(Number(v)), nome])}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="valores" dataKey="entradas" name="Entradas" fill="var(--cor-acao)" radius={[2, 2, 0, 0]} />
          <Bar yAxisId="valores" dataKey="saidas" name="Saídas" fill="var(--cor-critico)" radius={[2, 2, 0, 0]} />
          <Line yAxisId="qtd" type="monotone" dataKey="qtdTransacoes" name="Transações/mês" stroke="var(--cor-acento-escuro)" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>

      {analise.alertasAtipicos.length > 0 && (
        <div className="mt-3 p-2.5" style={{ backgroundColor: 'var(--cor-critico-fundo)' }}>
          <p className="mb-1 text-[11px] font-semibold" style={{ color: 'var(--cor-critico)' }}>
            Pagamentos atípicos identificados
          </p>
          <ul className="list-inside list-disc text-[11.5px]" style={{ color: 'var(--cor-texto-primario)' }}>
            {analise.alertasAtipicos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {analise.cruzamentos.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[11px] font-semibold" style={{ color: 'var(--cor-texto-secundario)' }}>
            Cruzamento com a carteira (risco, liquidação e vencido)
          </p>
          {analise.cruzamentos.map((c) => (
            <div key={c.titulo} className="border-l-2 p-2" style={{ borderColor: gravidadeCor[c.gravidade].texto, backgroundColor: gravidadeCor[c.gravidade].fundo }}>
              <p className="text-[11.5px] font-semibold" style={{ color: gravidadeCor[c.gravidade].texto }}>
                {c.titulo}
              </p>
              <p className="text-[11.5px]" style={{ color: 'var(--cor-texto-primario)' }}>
                {c.resumo}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
