import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { esquemaLoginEmergencia } from '@monitoramento/dominio'
import { LockKeyhole, Loader2 } from 'lucide-react'
import { ErroApi } from '../api/cliente'
import { sessaoRepository } from '../repositories'

/** Mesmas regras da API (dominio/esquemas), sem o destino (fixo em '/'). */
const esquemaFormEmergencia = esquemaLoginEmergencia.omit({ destino: true })
type FormEmergencia = z.output<typeof esquemaFormEmergencia>

/** Acesso de emergência — sem link a partir de lugar nenhum. Existe para
 * quando o Entra ID ou a Intranet estiverem fora do ar; cada uso é auditado. */
export default function LoginEmergencia() {
  const { register, handleSubmit, formState } = useForm<FormEmergencia>({
    resolver: zodResolver(esquemaFormEmergencia),
    defaultValues: { email: '', senha: '' },
  })
  const entrada = useMutation({
    mutationFn: ({ email, senha }: FormEmergencia) => sessaoRepository.entrarEmergencia(email, senha, '/'),
    onSuccess: ({ destino }) => window.location.replace(destino),
  })
  const enviando = entrada.isPending || entrada.isSuccess
  const erro =
    formState.errors.email?.message ??
    formState.errors.senha?.message ??
    (entrada.error ? (entrada.error instanceof ErroApi ? entrada.error.message : 'Não foi possível entrar.') : null)
  const entrar = handleSubmit((dados) => entrada.mutate(dados))

  return (
    <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #001035 0%, #001751 40%, #1B1489 100%)' }}>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/marca/everblue-logo-v2.png" alt="Everblue Grupo" className="mx-auto mb-4 h-[60px] w-[200px] object-contain" />
          <h1 className="fonte-editorial text-2xl font-bold text-white">Acesso de emergência</h1>
          <p className="mt-2 text-sm text-white/50">Uso restrito ao administrador. Toda entrada por aqui é auditada.</p>
        </div>
        <form onSubmit={(e) => void entrar(e)} noValidate className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md sm:p-8">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-white/80">
              E-mail
            </label>
            <input id="email" type="email" {...register('email')} aria-invalid={Boolean(formState.errors.email)} autoComplete="username" required className="w-full" />
          </div>
          <div>
            <label htmlFor="senha" className="mb-1 block text-sm text-white/80">
              Senha
            </label>
            <input id="senha" type="password" {...register('senha')} aria-invalid={Boolean(formState.errors.senha)} autoComplete="current-password" required className="w-full" />
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
