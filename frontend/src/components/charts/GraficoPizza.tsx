import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

export default function GraficoPizza({
  dados,
  cores,
  onClickFatia,
}: {
  dados: { chave: string; label: string; valor: number }[]
  cores: Record<string, string>
  onClickFatia?: (chave: string) => void
}) {
  const total = dados.reduce((s, d) => s + d.valor, 0)
  if (total === 0) return <p className="py-10 text-center text-sm text-gray-400">Sem dados para o recorte selecionado.</p>

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={dados}
          dataKey="valor"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={80}
          paddingAngle={2}
          cursor="pointer"
          onClick={(d) => onClickFatia?.((d as unknown as { chave: string }).chave)}
        >
          {dados.map((d) => (
            <Cell key={d.chave} fill={cores[d.chave] ?? 'var(--cor-inativo)'} />
          ))}
        </Pie>
        <Tooltip formatter={(valor) => `${valor} (${((Number(valor) / total) * 100).toFixed(0)}%)`} />
      </PieChart>
    </ResponsiveContainer>
  )
}
