import { useState } from 'react'
import { LockKeyhole, Loader2 } from 'lucide-react'
import { ErroApi } from '../api/cliente'
import { sessaoRepository } from '../repositories'

/** Acesso de emergência — sem link a partir de lugar nenhum. Existe para
 * quando o Entra ID ou a Intranet estiverem fora do ar; cada uso é auditado. */
export default function LoginEmergencia() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    try {
      const { destino } = await sessaoRepository.entrarEmergencia(email.trim(), senha, '/')
      window.location.replace(destino)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível entrar.')
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #001035 0%, #001751 40%, #1B1489 100%)' }}>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/marca/everblue-logo-v2.png" alt="Everblue Grupo" className="mx-auto mb-4 h-[60px] w-[200px] object-contain" />
          <h1 className="fonte-editorial text-2xl font-bold text-white">Acesso de emergência</h1>
          <p className="mt-2 text-sm text-white/50">Uso restrito ao administrador. Toda entrada por aqui é auditada.</p>
        </div>
        <form onSubmit={entrar} className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md sm:p-8">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-white/80">
              E-mail
            </label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required className="w-full" />
          </div>
          <div>
            <label htmlFor="senha" className="mb-1 block text-sm text-white/80">
              Senha
            </label>
            <input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required className="w-full" />
          </div>
          {erro && (
            <p className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 p-3 text-sm text-[#fecaca]" role="alert">
              {erro}
            </p>
          )}
          <button type="submit" disabled={enviando} className="botao-primario w-full py-3 text-sm">
            {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <LockKeyhole className="h-5 w-5" />}
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}
