import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { NIVEL_PERFIL, type PerfilAcesso, type SessaoUsuario } from '@monitoramento/dominio'
import { sessaoRepository } from '../repositories'

interface ValorSessao {
  usuario: SessaoUsuario
  /** Esconder/desabilitar uma ação na tela é conveniência — a autorização
   * de verdade é sempre decidida pela API. */
  pode: (minimo: PerfilAcesso) => boolean
  sair: () => Promise<void>
}

const Contexto = createContext<ValorSessao | null>(null)

export function SessaoProvider({ usuario, children }: { usuario: SessaoUsuario; children: ReactNode }) {
  const pode = useCallback((minimo: PerfilAcesso) => NIVEL_PERFIL[usuario.perfil] >= NIVEL_PERFIL[minimo], [usuario.perfil])
  const sair = useCallback(async () => {
    await sessaoRepository.sair().catch(() => undefined)
    window.location.assign('/login')
  }, [])
  const valor = useMemo(() => ({ usuario, pode, sair }), [usuario, pode, sair])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSessao(): ValorSessao {
  const valor = useContext(Contexto)
  if (!valor) throw new Error('useSessao fora de SessaoProvider')
  return valor
}
