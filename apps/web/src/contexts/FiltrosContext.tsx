import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Cliente, FiltrosGlobais, Gerente, GrupoEconomico, Plataforma } from '../models/types'
import { cadastrosRepository, clienteRepository, FILTROS_VAZIOS, snapshotRepository } from '../repositories'

interface OpcoesFiltro {
  gerentes: Gerente[]
  plataformas: Plataforma[]
  grupos: GrupoEconomico[]
  setores: string[]
  ramos: string[]
  produtos: string[]
  semanas: string[]
  clientes: Cliente[]
}

interface FiltrosContextValue {
  filtros: FiltrosGlobais
  setFiltros: (f: FiltrosGlobais) => void
  atualizarFiltro: <K extends keyof FiltrosGlobais>(chave: K, valor: FiltrosGlobais[K]) => void
  limparFiltros: () => void
  opcoes: OpcoesFiltro
  carregando: boolean
  versaoDados: number
  recarregarDados: () => void
}

const FiltrosContext = createContext<FiltrosContextValue | null>(null)

export function FiltrosProvider({ children }: { children: ReactNode }) {
  const [filtros, setFiltros] = useState<FiltrosGlobais>(FILTROS_VAZIOS)
  const [opcoes, setOpcoes] = useState<OpcoesFiltro>({ gerentes: [], plataformas: [], grupos: [], setores: [], ramos: [], produtos: [], semanas: [], clientes: [] })
  const [carregando, setCarregando] = useState(true)
  const [versaoDados, setVersaoDados] = useState(0)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([
      cadastrosRepository.listarGerentes(),
      cadastrosRepository.listarPlataformas(),
      cadastrosRepository.listarGrupos(),
      clienteRepository.valoresDistintos(),
      snapshotRepository.listarSemanasDisponiveis(),
      clienteRepository.listarTodos(),
    ]).then(([gerentes, plataformas, grupos, distintos, semanas, clientes]) => {
      if (!ativo) return
      setOpcoes({ gerentes, plataformas, grupos, setores: distintos.setores, ramos: distintos.ramos, produtos: distintos.produtos, semanas, clientes })
      setFiltros((atual) => (atual.semanaRef ? atual : { ...atual, semanaRef: semanas[semanas.length - 1] ?? null }))
      setCarregando(false)
    })
    return () => {
      ativo = false
    }
  }, [versaoDados])

  const value = useMemo<FiltrosContextValue>(
    () => ({
      filtros,
      setFiltros,
      atualizarFiltro: (chave, valor) => setFiltros((atual) => ({ ...atual, [chave]: valor })),
      limparFiltros: () => setFiltros({ ...FILTROS_VAZIOS, semanaRef: filtros.semanaRef }),
      opcoes,
      carregando,
      versaoDados,
      recarregarDados: () => setVersaoDados((v) => v + 1),
    }),
    [filtros, opcoes, carregando, versaoDados],
  )

  return <FiltrosContext.Provider value={value}>{children}</FiltrosContext.Provider>
}

export function useFiltros(): FiltrosContextValue {
  const ctx = useContext(FiltrosContext)
  if (!ctx) throw new Error('useFiltros deve ser usado dentro de FiltrosProvider')
  return ctx
}
