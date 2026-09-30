import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import AvisoErros from '../ui/AvisoErros'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

/** Estrutura padrão da Intranet Everblue: menu lateral fixo de 240px, barra
 * superior fixa de 64px, marca d'água ao fundo e conteúdo centralizado. */
const ANO = new Date().getFullYear()

export default function Layout() {
  const [menuAberto, setMenuAberto] = useState(false)

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center" aria-hidden="true">
        <img src="/marca/everblue-watermark.png" alt="" className="h-[min(500px,90vw)] w-[min(500px,90vw)] object-contain opacity-[0.03]" />
      </div>

      <Sidebar aberto={menuAberto} aoFechar={() => setMenuAberto(false)} aoAlternar={() => setMenuAberto((v) => !v)} />
      <main className="relative z-10 min-h-dvh min-w-0 pt-16 lg:ml-[240px]">
        <Topbar />
        <div className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
        <footer className="mt-8 border-t border-white/5 sem-impressao">
          <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-white/30 sm:flex-row lg:px-8">
            <span>© {ANO} everblue. Todos os direitos reservados.</span>
            <span>Monitoramento do FIDC · uso interno</span>
          </div>
        </footer>
      </main>
      <AvisoErros />
    </div>
  )
}
