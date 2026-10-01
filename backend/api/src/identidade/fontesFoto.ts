/**
 * Fontes da foto do cartão do usuário. Estratégias intercambiáveis (a tela só
 * conhece `FonteFoto`), escolhidas por FOTO_FONTE no `.env`:
 *
 * - `graph`: GET /users/{oid}/photo/$value com token app-only — o padrão da
 *   IA Everblue.
 * - `intranet`: GET /api/access/v1/photo com a mesma assinatura interna do
 *   `/me` — o endpoint que o contrato da Intranet oferece às consumidoras.
 * - `nenhuma`: só iniciais.
 *
 * Sem foto, a interface mantém as iniciais: foto é visual, nunca bloqueia.
 */
import type { ClienteGraph } from './graph'
import type { ClienteIntranet, FotoCorporativa } from './intranet'

export interface TitularFoto {
  usuarioId: string
  entraOid: string | null
}

export interface FonteFoto {
  obter(titular: TitularFoto): Promise<FotoCorporativa | null>
}

export class FonteFotoGraph implements FonteFoto {
  constructor(private readonly graph: ClienteGraph) {}
  async obter(titular: TitularFoto): Promise<FotoCorporativa | null> {
    if (!titular.entraOid || !this.graph.configurado) return null
    try {
      return await this.graph.obterFoto(titular.entraOid)
    } catch {
      return null
    }
  }
}

export class FonteFotoIntranet implements FonteFoto {
  constructor(private readonly intranet: ClienteIntranet) {}
  async obter(titular: TitularFoto): Promise<FotoCorporativa | null> {
    return this.intranet.obterFoto(titular.entraOid)
  }
}

export class FonteFotoNenhuma implements FonteFoto {
  async obter(): Promise<FotoCorporativa | null> {
    return null
  }
}

/** Decorador com cache em memória: a foto muda raramente e a tela a pede em
 * toda navegação. Guarda também a AUSÊNCIA de foto, para não reperguntar. */
export class FonteFotoEmCache implements FonteFoto {
  private readonly cache = new Map<string, { foto: FotoCorporativa | null; expira: number }>()

  constructor(
    private readonly origem: FonteFoto,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly maximo = 500,
  ) {}

  async obter(titular: TitularFoto): Promise<FotoCorporativa | null> {
    const agora = Date.now()
    const guardada = this.cache.get(titular.usuarioId)
    if (guardada && guardada.expira > agora) return guardada.foto
    const foto = await this.origem.obter(titular)
    if (this.cache.size >= this.maximo) {
      const maisAntiga = this.cache.keys().next().value
      if (maisAntiga !== undefined) this.cache.delete(maisAntiga)
    }
    this.cache.set(titular.usuarioId, { foto, expira: agora + this.ttlMs })
    return foto
  }

  esquecer(usuarioId: string): void {
    this.cache.delete(usuarioId)
  }
}
