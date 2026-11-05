import { lazy, Suspense, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/layout/Layout'
import { consultas } from './consultas'
import { useSessao } from './contexts/SessaoContext'

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
const FotoBitfin = lazy(() => import('./pages/FotoBitfin'))
const MapaGarantias = lazy(() => import('./pages/MapaGarantias'))

function Carregando() {
  return (
    <div className="flex h-64 items-center justify-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }} role="status">
      Carregando…
    </div>
  )
}

/** 1.2: a importação por planilha só abre se o servidor a mantiver habilitada
 * (contingência); senão, leva para a Foto do Bitfin. */
function ImportacaoContingencia() {
  const q = useQuery(consultas.situacaoFoto())
  const habilitada = q.isError ? false : (q.data?.planilhaHabilitada ?? null)
  if (habilitada === null) return <Carregando />
  return habilitada ? <ImportacaoSemanal /> : <Navigate to="/" replace />
}

/** Foto do Bitfin, Mapa de Garantias e Parâmetros: só Administrador, Diretoria
 * e Gerente (perfil da Intranet). Quem não tem volta ao início; o servidor
 * também recusa as chamadas. */
function SoGestao({ children }: { children: ReactNode }) {
  const { usuario } = useSessao()
  return usuario.acessoGestao ? <>{children}</> : <Navigate to="/" replace />
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
            ['/foto-bitfin', FotoBitfin, true],
            ['/mapa-garantias', MapaGarantias, true],
            ['/importacao', ImportacaoContingencia, true],
            ['/arquivos', CentralArquivos],
            ['/cadastros', CadastrosConfiguracoes, true],
            ['/clientes/:id', FichaCliente],
          ] as ReadonlyArray<readonly [string, React.ComponentType, boolean?]>
        ).map(([rota, Pagina, gestao]) => (
          <Route
            key={rota}
            path={rota}
            element={
              <Suspense fallback={<Carregando />}>
                {gestao ? (
                  <SoGestao>
                    <Pagina />
                  </SoGestao>
                ) : (
                  <Pagina />
                )}
              </Suspense>
            }
          />
        ))}
        <Route path="*" element={<NaoEncontrada />} />
      </Route>
    </Routes>
  )
}
