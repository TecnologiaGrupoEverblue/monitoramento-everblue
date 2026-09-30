import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatarData } from '../../utils/formatters'

export default function GraficoEntradasSaidas({ dados }: { dados: { semana: string; entradas: number; saidas: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={dados} margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
        <XAxis dataKey="semana" tickFormatter={(v) => formatarData(v)} tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip labelFormatter={(v) => formatarData(String(v))} />
        <Legend />
        <Bar dataKey="entradas" name="Entradas em Monitoramento" fill="var(--cor-atencao)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="saidas" name="Saídas de Monitoramento" fill="var(--cor-normal)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
