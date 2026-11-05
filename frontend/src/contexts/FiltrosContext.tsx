import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { Carteira, Cliente, FiltrosGlobais, Gerente, GrupoEconomico, Plataforma } from '../models/types'
import { FILTROS_VAZIOS } from '../repositories'
import { consultas } from '../consultas'

interface OpcoesFiltro {
  gerentes: Gerente[]
  plataformas: Plataforma[]
  grupos: GrupoEconomico[]
  carteiras: Carteira[]
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
}

const FiltrosContext = createContext<FiltrosContextValue | null>(null)

export function FiltrosProvider({ children }: { children: ReactNode }) {
  const r = useQueries({
    queries: [
      consultas.gerentes(),
      consultas.plataformas(),
      consultas.grupos(),
      consultas.valoresDistintos(),
      consultas.semanas(),
      consultas.clientes(),
      consultas.carteiras(),
    ],
  })
  const [gerentes, plataformas, grupos, distintos, semanas, clientes, carteiras] = r
  const carregando = r.some((q) => q.isPending)

  const opcoes = useMemo<OpcoesFiltro>(
    () => ({
      gerentes: gerentes.data ?? [],
      plataformas: plataformas.data ?? [],
      grupos: grupos.data ?? [],
      carteiras: carteiras.data ?? [],
      setores: distintos.data?.setores ?? [],
      ramos: distintos.data?.ramos ?? [],
      produtos: distintos.data?.produtos ?? [],
      semanas: semanas.data ?? [],
      clientes: clientes.data ?? [],
    }),
    [gerentes.data, plataformas.data, grupos.data, carteiras.data, distintos.data, semanas.data, clientes.data],
  )

  // Sem semana escolhida, a mais recente com posição.
  const ultimaSemana = semanas.data?.[semanas.data.length - 1] ?? null
  const [filtrosGravados, setFiltros] = useState<FiltrosGlobais>(FILTROS_VAZIOS)
  const filtros = useMemo(
    () => (filtrosGravados.semanaRef || !ultimaSemana ? filtrosGravados : { ...filtrosGravados, semanaRef: ultimaSemana }),
    [filtrosGravados, ultimaSemana],
  )

  const value = useMemo<FiltrosContextValue>(
    () => ({
      filtros,
      setFiltros,
      atualizarFiltro: (chave, valor) => setFiltros((atual) => ({ ...atual, [chave]: valor })),
      limparFiltros: () => setFiltros({ ...FILTROS_VAZIOS, semanaRef: filtros.semanaRef }),
      opcoes,
      carregando,
    }),
    [filtros, opcoes, carregando],
  )

  return <FiltrosContext.Provider value={value}>{children}</FiltrosContext.Provider>
}

export function useFiltros(): FiltrosContextValue {
  const ctx = useContext(FiltrosContext)
  if (!ctx) throw new Error('useFiltros deve ser usado dentro de FiltrosProvider')
  return ctx
}
