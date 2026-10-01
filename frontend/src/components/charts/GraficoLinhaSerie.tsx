import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarData, formatarMoedaCompacta } from '../../utils/formatters'

export default function GraficoLinhaSerie({
  dados,
  chaveValor,
  cor,
  onClickPonto,
}: {
  dados: { semana: string; [chave: string]: number | string }[]
  chaveValor: string
  cor: string
  onClickPonto?: (semana: string) => void
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={dados} margin={{ left: 8, right: 16 }} onClick={(e) => e?.activeLabel !== undefined && onClickPonto?.(String(e.activeLabel))}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
        <XAxis dataKey="semana" tickFormatter={(v) => formatarData(String(v))} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v) => formatarMoedaCompacta(Number(v))} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => formatarMoedaCompacta(Number(v))} labelFormatter={(v) => formatarData(String(v))} />
        <Line type="monotone" dataKey={chaveValor} stroke={cor} strokeWidth={2.5} dot={{ r: 3, cursor: 'pointer' }} activeDot={{ r: 6, cursor: 'pointer' }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
