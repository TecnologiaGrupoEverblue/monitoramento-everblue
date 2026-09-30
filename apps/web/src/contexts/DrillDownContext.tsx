import { createContext, useContext, useState, type ReactNode } from 'react'
import DrillDownModal from '../components/ui/DrillDownModal'

interface DrillDownContextValue {
  abrir: (titulo: string, clienteIds: string[]) => void
}

const DrillDownContext = createContext<DrillDownContextValue | null>(null)

export function DrillDownProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<{ titulo: string; clienteIds: string[] } | null>(null)

  return (
    <DrillDownContext.Provider value={{ abrir: (titulo, clienteIds) => setEstado({ titulo, clienteIds }) }}>
      {children}
      {estado && <DrillDownModal titulo={estado.titulo} clienteIds={estado.clienteIds} aoFechar={() => setEstado(null)} />}
    </DrillDownContext.Provider>
  )
}

export function useDrillDown(): DrillDownContextValue {
  const ctx = useContext(DrillDownContext)
  if (!ctx) throw new Error('useDrillDown deve ser usado dentro de DrillDownProvider')
  return ctx
}
