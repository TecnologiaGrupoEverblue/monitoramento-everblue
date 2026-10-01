import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { graficoPaleta } from '../../theme/colors'
import { formatarMoedaCompacta } from '../../utils/formatters'

export interface ItemDimensao {
  chave: string
  label: string
  risco: number
  qtdClientes: number
  clienteIds: string[]
}

export default function GraficoBarrasDimensao({
  dados,
  onClickBarra,
  limite = 10,
  horizontal = true,
}: {
  dados: ItemDimensao[]
  onClickBarra: (item: ItemDimensao) => void
  limite?: number
  horizontal?: boolean
}) {
  const dadosLimitados = dados.slice(0, limite)

  if (dadosLimitados.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">Sem dados para o recorte selecionado.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, dadosLimitados.length * 34)}>
      <BarChart data={dadosLimitados} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} stroke="var(--cor-grade)" />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={(v) => formatarMoedaCompacta(v)} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis tickFormatter={(v) => formatarMoedaCompacta(v)} tick={{ fontSize: 11 }} />
          </>
        )}
        <Tooltip formatter={(valor) => formatarMoedaCompacta(Number(valor))} labelStyle={{ fontWeight: 600 }} />
        <Bar dataKey="risco" radius={[4, 4, 4, 4]} cursor="pointer" onClick={(d) => onClickBarra(d as unknown as ItemDimensao)}>
          {dadosLimitados.map((_, i) => (
            <Cell key={i} fill={graficoPaleta[i % graficoPaleta.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
