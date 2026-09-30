import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  ClipboardList,
  DoorOpen,
  FileSignature,
  FolderOpen,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Scale,
  Settings,
  ShieldAlert,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useSessao } from '../../contexts/SessaoContext'
import { sessaoRepository } from '../../repositories'

const ITENS_MENU: { rota: string; label: string; icone: LucideIcon }[] = [
  { rota: '/', label: 'Dashboard Executivo', icone: LayoutDashboard },
  { rota: '/monitoramento', label: 'Clientes em Monitoramento', icone: ShieldAlert },
  { rota: '/saida-de-risco', label: 'Saída de Risco', icone: DoorOpen },
  { rota: '/juridico', label: 'Jurídico', icone: Scale },
  { rota: '/planos-de-acao', label: 'Planos de Ação', icone: ClipboardList },
  { rota: '/gerentes-plataformas', label: 'Gerentes e Plataformas', icone: Users },
  { rota: '/comites', label: 'Comitês e Atas', icone: FileSignature },
  { rota: '/historico', label: 'Histórico', icone: History },
  { rota: '/importacao', label: 'Importação Semanal', icone: Upload },
  { rota: '/arquivos', label: 'Central de Arquivos', icone: FolderOpen },
  { rota: '/cadastros', label: 'Cadastros e Configurações', icone: Settings },
]

function Avatar({ nome, temFoto }: { nome: string; temFoto: boolean }) {
  const [falhou, setFalhou] = useState(false)
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#1B1489] to-[#7C3AED] text-sm font-bold text-white">
      {temFoto && !falhou ? (
        <img src={sessaoRepository.urlFoto} alt={`Foto de ${nome}`} className="h-full w-full object-cover" onError={() => setFalhou(true)} />
      ) : (
        iniciais || '?'
      )}
    </div>
  )
}

export default function Sidebar({ aberto, aoFechar, aoAlternar }: { aberto: boolean; aoFechar: () => void; aoAlternar: () => void }) {
  const { usuario, sair } = useSessao()
  const local = useLocation()

  useEffect(() => {
    aoFechar()
    // fecha o menu móvel ao navegar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.pathname])

  useEffect(() => {
    document.body.style.overflow = aberto ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [aberto])

  return (
    <>
      <button
        className="sem-impressao fixed left-4 top-2.5 z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#0a1640] text-white shadow-lg lg:hidden"
        onClick={aoAlternar}
        aria-label="Menu"
        aria-expanded={aberto}
        aria-controls="menu-lateral"
      >
        {aberto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {aberto && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={aoFechar} aria-hidden="true" />}

      <aside
        id="menu-lateral"
        className={`sem-impressao fixed inset-y-0 left-0 z-40 flex h-dvh max-h-dvh w-[min(280px,86vw)] flex-col overflow-hidden border-r border-white/5 bg-[#0a1030]/95 backdrop-blur-md transition-transform duration-300 lg:w-[240px] ${
          aberto ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-5 pb-2">
          <NavLink to="/" className="flex items-center gap-2">
            <img src="/marca/everblue-logo-v2.png" alt="Everblue Grupo" className="h-10 w-[160px] object-contain object-left" />
          </NavLink>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-white/50">
            <BarChart3 className="h-3.5 w-3.5 text-[#DFBF7D]" /> Monitoramento do FIDC
          </p>
        </div>

        <div className="mx-3 mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="flex items-center gap-3">
            <Avatar nome={usuario.nome} temFoto={usuario.temFoto} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white" title={usuario.nome}>
                {usuario.nome}
              </p>
              <p className="truncate text-xs text-white/50" title={usuario.departamento ?? usuario.cargo ?? usuario.email}>
                {usuario.departamento ?? usuario.cargo ?? usuario.email}
              </p>
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4" aria-label="Menu principal">
          {ITENS_MENU.map((item, indice) => {
            const Icone = item.icone
            const inicio = indice === 0
            return (
              <NavLink
                key={item.rota}
                to={item.rota}
                end={item.rota === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200 ${inicio ? 'mb-2' : ''} ${
                    isActive
                      ? 'border-white/10 bg-white/10 text-white shadow-sm'
                      : inicio
                        ? 'border-[#DFBF7D]/20 bg-white/[0.06] text-white/85 hover:border-[#DFBF7D]/35 hover:bg-white/10'
                        : 'border-transparent text-white/60 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                <Icone className="h-5 w-5 flex-shrink-0" />
                <span className="leading-tight">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <button onClick={() => void sair()} className="flex w-full items-center gap-2 px-1 text-sm text-white/50 transition-colors hover:text-white">
            <LogOut className="h-4 w-4" />
            <span>Sair</span>
          </button>
        </div>
      </aside>
    </>
  )
}
