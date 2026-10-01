import { useState } from 'react'
import { ChevronDown, ChevronUp, Filter, X } from 'lucide-react'
import { useFiltros } from '../../contexts/FiltrosContext'
import { formatarData } from '../../utils/formatters'

function Select({ label, valor, onChange, opcoes }: { label: string; valor: string; onChange: (v: string) => void; opcoes: { valor: string; label: string }[] }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-white/55">{label}</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0">
        <option value="">Todos</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Barra superior fixa (padrão Intranet): posição da carteira sempre à vista e
 * os filtros cruzados num painel recolhível — valem para todas as telas. */
export default function Topbar() {
  const { filtros, atualizarFiltro, limparFiltros, opcoes } = useFiltros()
  const [aberto, setAberto] = useState(false)
  const filtrosAtivos = Object.entries(filtros).filter(([chave, v]) => chave !== 'semanaRef' && v).length

  return (
    <>
      <header className="sem-impressao fixed inset-x-0 top-0 z-30 flex h-16 items-center border-b border-white/10 bg-[#070e31]/95 px-3 pl-16 shadow-sm backdrop-blur-md sm:px-6 sm:pl-20 lg:left-[240px] lg:pl-6">
        <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:gap-3">
          <label className="flex min-w-0 items-center gap-2">
            <span className="hidden text-xs font-medium text-white/55 sm:inline">Posição da carteira</span>
            <select
              aria-label="Posição da carteira"
              value={filtros.semanaRef ?? ''}
              onChange={(e) => atualizarFiltro('semanaRef', e.target.value || null)}
              className="min-w-[8.5rem]"
            >
              {opcoes.semanas.length === 0 && <option value="">Sem posições</option>}
              {[...opcoes.semanas].reverse().map((s) => (
                <option key={s} value={s}>
                  {formatarData(s)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-controls="painel-filtros"
            className="relative flex h-10 flex-shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white/80 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">Filtros</span>
            {filtrosAtivos > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#7C3AED] px-1 text-[10px] font-bold text-white">{filtrosAtivos}</span>
            )}
            {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {aberto && (
        <div id="painel-filtros" className="sem-impressao sticky top-16 z-20 border-b border-white/10 bg-[#0a1030]/95 px-4 py-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Select label="Plataforma" valor={filtros.plataformaId ?? ''} onChange={(v) => atualizarFiltro('plataformaId', v || null)} opcoes={opcoes.plataformas.map((p) => ({ valor: p.id, label: p.nome }))} />
            <Select label="Gerente" valor={filtros.gerenteId ?? ''} onChange={(v) => atualizarFiltro('gerenteId', v || null)} opcoes={opcoes.gerentes.map((g) => ({ valor: g.id, label: g.nome }))} />
            <Select label="Grupo econômico" valor={filtros.grupoEconomicoId ?? ''} onChange={(v) => atualizarFiltro('grupoEconomicoId', v || null)} opcoes={opcoes.grupos.map((g) => ({ valor: g.id, label: g.nome }))} />
            <Select label="Cliente" valor={filtros.clienteId ?? ''} onChange={(v) => atualizarFiltro('clienteId', v || null)} opcoes={opcoes.clientes.map((c) => ({ valor: c.id, label: c.nome }))} />
            <Select
              label="Status"
              valor={filtros.status ?? ''}
              onChange={(v) => atualizarFiltro('status', (v || null) as never)}
              opcoes={[
                { valor: 'NORMAL', label: 'Normal' },
                { valor: 'MONITORAMENTO', label: 'Monitoramento' },
                { valor: 'SAIDA_DE_RISCO', label: 'Saída de Risco' },
                { valor: 'JURIDICO', label: 'Jurídico' },
              ]}
            />
            <Select
              label="Prioridade"
              valor={filtros.prioridade ?? ''}
              onChange={(v) => atualizarFiltro('prioridade', (v || null) as never)}
              opcoes={[
                { valor: 'ALTA', label: 'Alta' },
                { valor: 'MEDIA', label: 'Média' },
                { valor: 'BAIXA', label: 'Baixa' },
              ]}
            />
            <Select label="Setor" valor={filtros.setor ?? ''} onChange={(v) => atualizarFiltro('setor', v || null)} opcoes={opcoes.setores.map((s) => ({ valor: s, label: s }))} />
            <Select label="Ramo de atividade" valor={filtros.ramoAtividade ?? ''} onChange={(v) => atualizarFiltro('ramoAtividade', v || null)} opcoes={opcoes.ramos.map((r) => ({ valor: r, label: r }))} />
            <Select label="Produto" valor={filtros.produto ?? ''} onChange={(v) => atualizarFiltro('produto', v || null)} opcoes={opcoes.produtos.map((p) => ({ valor: p, label: p }))} />
            <div className="flex items-end">
              <button type="button" onClick={limparFiltros} disabled={filtrosAtivos === 0} className="botao-secundario w-full disabled:opacity-40">
                <X className="h-4 w-4" /> Limpar filtros
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
