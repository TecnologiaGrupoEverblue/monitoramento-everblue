import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import Bootstrap from './Bootstrap.tsx'
import { criarClienteConsultas } from './consultas'

const clienteConsultas = criarClienteConsultas()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <Bootstrap />
    </QueryClientProvider>
  </StrictMode>,
)
