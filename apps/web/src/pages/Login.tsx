import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { sessaoRepository } from '../repositories'

/** Mensagens escolhidas por CHAVE — nunca um texto recebido pela URL. */
const MENSAGENS: Record<string, string> = {
  recusado: 'O acesso corporativo foi recusado ou cancelado. Tente novamente.',
  expirado: 'A tentativa de login expirou. Tente novamente.',
  invalido: 'Não foi possível validar sua identidade corporativa. Tente novamente.',
  sem_acesso: 'Seu acesso ao Monitoramento não está liberado. Solicite a liberação na Intranet, em Configurações › Controle de Acessos.',
  nao_cadastrado: 'Sua conta não está cadastrada no Monitoramento. O cadastro vem do Controle de Acessos da Intranet.',
  inativo: 'Seu acesso ao Monitoramento está inativo. Procure o administrador.',
  intranet_indisponivel: 'Não foi possível confirmar seu acesso na Intranet agora. Tente novamente em instantes.',
  entra_indisponivel: 'Não foi possível contatar o Microsoft Entra ID. Tente novamente em instantes.',
  nao_configurado: 'O acesso corporativo ainda não foi configurado neste ambiente.',
  renovacao: 'Não foi possível renovar sua sessão automaticamente. Entre novamente.',
}

function destinoSeguro(valor: string | null): string {
  if (!valor || !valor.startsWith('/') || valor.startsWith('//') || valor.includes('\\')) return '/'
  return valor
}

export default function Login() {
  const parametros = new URLSearchParams(window.location.search)
  const erro = MENSAGENS[parametros.get('erro') ?? ''] ?? null
  const destino = destinoSeguro(parametros.get('destino'))
  const [entraDisponivel, setEntraDisponivel] = useState<boolean | null>(null)
  const [indo, setIndo] = useState(false)

  useEffect(() => {
    // Já autenticado? Vai direto ao destino.
    sessaoRepository
      .obter()
      .then(() => window.location.replace(destino))
      .catch(() => undefined)
    sessaoRepository
      .modo()
      .then((m) => setEntraDisponivel(m.entraDisponivel))
      .catch(() => setEntraDisponivel(false))
  }, [destino])

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #001035 0%, #001751 40%, #1B1489 100%)' }}>
      <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center" aria-hidden="true">
        <img src="/marca/everblue-watermark.png" alt="" className="h-[min(560px,120vw)] w-[min(560px,120vw)] object-contain opacity-[0.10]" />
      </div>
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center sm:mb-8">
          <img src="/marca/everblue-logo-v2.png" alt="Everblue Grupo" className="mx-auto mb-5 h-[66px] w-[220px] object-contain sm:h-[78px] sm:w-[260px]" />
          <h1 className="fonte-editorial text-2xl font-bold tracking-tight text-white sm:text-3xl">Monitoramento Everblue</h1>
          <p className="mt-2 text-sm text-white/50">Comitê de Monitoramento do FIDC — carteira, alertas, planos e atas</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md sm:p-8">
          {erro && (
            <p className="mb-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 p-3 text-sm text-[#fecaca]" role="alert">
              {erro}
            </p>
          )}
          {entraDisponivel === false ? (
            <p className="text-center text-sm text-amber-200" role="status">
              O acesso corporativo ainda não foi configurado neste ambiente.
            </p>
          ) : (
            <a
              href={`/entrar/entra?destino=${encodeURIComponent(destino)}`}
              onClick={() => setIndo(true)}
              aria-disabled={entraDisponivel === null}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#2F2F2F] px-4 py-3 font-medium text-white transition-colors hover:bg-[#3F3F3F] aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              {indo ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
              Entrar com Microsoft
            </a>
          )}
          <p className="mt-5 text-center text-xs text-white/40">Acesso exclusivo para colaboradores autorizados pelo Microsoft Entra ID e liberados na Intranet.</p>
        </div>
        <p className="mt-6 text-center text-xs text-white/30">Transformamos crédito em oportunidades. Juntos, construímos o futuro!</p>
      </div>
    </div>
  )
}
