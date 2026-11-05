import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from './App'
import { ErroApi } from './api/cliente'
import { consultas } from './consultas'
import { DrillDownProvider } from './contexts/DrillDownContext'
import { FiltrosProvider } from './contexts/FiltrosContext'
import { SessaoProvider } from './contexts/SessaoContext'
import LoginEmergencia from './pages/LoginEmergencia'
import Login from './pages/Login'

const ROTAS_PUBLICAS = ['/login', '/entrar/emergencia']

function AreaAutenticada() {
  const sessao = useQuery(consultas.sessao())
  const usuario = sessao.data ?? null
  const semSessao = sessao.error instanceof ErroApi && (sessao.error.status === 401 || sessao.error.status === 403)
  const erro = sessao.error && !semSessao ? sessao.error.message : null

  useEffect(() => {
    if (!semSessao || !(sessao.error instanceof ErroApi)) return
    const destino = `${window.location.pathname}${window.location.search}`
    const motivo = sessao.error.codigo === 'sem_acesso' ? '&erro=sem_acesso' : ''
    window.location.replace(`/login?destino=${encodeURIComponent(destino)}${motivo}`)
  }, [semSessao, sessao.error])

  if (erro) {
    return (
      <div className="tela-cheia flex items-center justify-center p-6 text-center">
        <div className="cartao-vidro max-w-md p-6">
          <p className="mb-2 text-lg font-bold" style={{ color: 'var(--cor-critico)' }}>
            Não foi possível carregar o Monitoramento
          </p>
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            {erro}
          </p>
        </div>
      </div>
    )
  }

  if (!usuario) {
    return (
      <div className="tela-cheia flex items-center justify-center">
        <div className="text-center">
          <img src="/marca/everblue-logo-v2.png" alt="Everblue Grupo" className="mx-auto mb-4 h-14 w-auto" />
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            Carregando o Monitoramento…
          </p>
        </div>
      </div>
    )
  }

  return (
    <SessaoProvider usuario={usuario}>
      <FiltrosProvider>
        <DrillDownProvider>
          <App />
        </DrillDownProvider>
      </FiltrosProvider>
    </SessaoProvider>
  )
}

export default function Bootstrap() {
  const publica = ROTAS_PUBLICAS.includes(window.location.pathname)
  return (
    <BrowserRouter>
      {publica ? (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/entrar/emergencia" element={<LoginEmergencia />} />
        </Routes>
      ) : (
        <AreaAutenticada />
      )}
    </BrowserRouter>
  )
}
