import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/layout/Layout'

// Uma rota, um pacote: a primeira tela não paga o custo das demais.
const DashboardExecutivo = lazy(() => import('./pages/DashboardExecutivo'))
const ClientesMonitoramento = lazy(() => import('./pages/ClientesMonitoramento'))
const SaidaDeRisco = lazy(() => import('./pages/SaidaDeRisco'))
const Juridico = lazy(() => import('./pages/Juridico'))
const PlanosDeAcao = lazy(() => import('./pages/PlanosDeAcao'))
const VisaoGerentesPlataformas = lazy(() => import('./pages/VisaoGerentesPlataformas'))
const ComitesAtas = lazy(() => import('./pages/ComitesAtas'))
const Historico = lazy(() => import('./pages/Historico'))
const ImportacaoSemanal = lazy(() => import('./pages/ImportacaoSemanal'))
const CadastrosConfiguracoes = lazy(() => import('./pages/CadastrosConfiguracoes'))
const FichaCliente = lazy(() => import('./pages/FichaCliente'))
const CentralArquivos = lazy(() => import('./pages/CentralArquivos'))

function Carregando() {
  return (
    <div className="flex h-64 items-center justify-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }} role="status">
      Carregando…
    </div>
  )
}

function NaoEncontrada() {
  return (
    <div className="py-16 text-center">
      <p className="fonte-editorial text-xl">Página não encontrada</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
        Use o menu lateral para navegar.
      </p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {(
          [
            ['/', DashboardExecutivo],
            ['/monitoramento', ClientesMonitoramento],
            ['/saida-de-risco', SaidaDeRisco],
            ['/juridico', Juridico],
            ['/planos-de-acao', PlanosDeAcao],
            ['/gerentes-plataformas', VisaoGerentesPlataformas],
            ['/comites', ComitesAtas],
            ['/historico', Historico],
            ['/importacao', ImportacaoSemanal],
            ['/arquivos', CentralArquivos],
            ['/cadastros', CadastrosConfiguracoes],
            ['/clientes/:id', FichaCliente],
          ] as const
        ).map(([rota, Pagina]) => (
          <Route
            key={rota}
            path={rota}
            element={
              <Suspense fallback={<Carregando />}>
                <Pagina />
              </Suspense>
            }
          />
        ))}
        <Route path="*" element={<NaoEncontrada />} />
      </Route>
    </Routes>
  )
}
