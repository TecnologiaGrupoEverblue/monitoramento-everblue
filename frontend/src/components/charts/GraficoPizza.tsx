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
  if (total === 0) return <p className="py-10 text-center text-sm text-[color:var(--cor-texto-secundario)]">Sem dados para o recorte selecionado.</p>

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div className="h-[200px] w-full max-w-[240px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dados}
              dataKey="valor"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="90%"
              paddingAngle={2}
              cursor="pointer"
              isAnimationActive={false}
              onClick={(d) => onClickFatia?.((d as unknown as { chave: string }).chave)}
            >
              {dados.map((d) => (
                <Cell key={d.chave} fill={cores[d.chave] ?? 'var(--cor-inativo)'} />
              ))}
            </Pie>
            <Tooltip formatter={(valor) => `${valor} (${((Number(valor) / total) * 100).toFixed(0)}%)`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Legenda com número e %: a pizza sozinha não diz quanto é cada fatia. */}
      <ul className="flex w-full flex-col gap-1.5 text-sm">
        {dados.map((d) => (
          <li key={d.chave}>
            <button
              type="button"
              className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--cor-fundo-recuado)]"
              onClick={() => onClickFatia?.(d.chave)}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cores[d.chave] ?? 'var(--cor-inativo)' }} aria-hidden="true" />
              <span className="flex-1">{d.label}</span>
              <span className="numeros-tabulares font-semibold">{d.valor}</span>
              <span className="numeros-tabulares w-12 text-right text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                {((d.valor / total) * 100).toFixed(0)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
