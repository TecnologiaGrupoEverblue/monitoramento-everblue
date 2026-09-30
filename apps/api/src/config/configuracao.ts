/**
 * Configuração central. Nenhum valor operacional é fixado em código: tudo vem
 * do ambiente (`.env` do servidor), é validado na subida e congelado.
 *
 * Variável obrigatória ausente derruba o processo na hora, com a lista do que
 * falta — é melhor a API não subir do que subir com um segredo vazio e
 * descobrir no primeiro login.
 */
import { z } from 'zod'
import { perfilValido, type PerfilAcesso } from '@monitoramento/dominio'

/** Caminho de retorno do OIDC — o mesmo usado pela IA Everblue. */
export const CAMINHO_RETORNO_OIDC = '/oauth/oidc/callback'

const booleano = z
  .string()
  .optional()
  .transform((v) => ['1', 'true', 'sim', 'yes'].includes((v ?? '').trim().toLowerCase()))

const inteiro = (padrao: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? padrao : Number(v)))
    .pipe(z.number().int().min(min).max(max))

const texto = (padrao = '') =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? padrao).trim())

const esquema = z.object({
  AMBIENTE: z.enum(['desenvolvimento', 'homologacao', 'producao']).default('desenvolvimento'),
  PORTA: inteiro(3000, 1, 65535),
  URL_PUBLICA: z.string().url().default('http://localhost:5173'),
  NIVEL_LOG: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DATABASE_POOL_MAX: inteiro(10, 1, 100),

  SESSAO_SEGREDO: z.string().min(32, 'SESSAO_SEGREDO precisa ter ao menos 32 caracteres (openssl rand -hex 32)'),
  SESSAO_HORAS: inteiro(8, 1, 24),
  COOKIE_SEGURO: booleano,
  /** Semente da chave do cofre (AES-GCM). Mantida para compatibilidade: desde
   * a 1.0.2 nenhum token delegado é guardado. */
  COFRE_CHAVE: z.string().min(32, 'COFRE_CHAVE precisa ter ao menos 32 caracteres (openssl rand -hex 32)'),

  ENTRA_TENANT_ID: texto(),
  ENTRA_CLIENT_ID: texto(),
  ENTRA_CLIENT_SECRET: texto(),
  ENTRA_REDIRECT_URI: texto(),
  ENTRA_MAPA_PERFIL: texto(),
  ENTRA_PERFIL_PADRAO: texto('leitor'),
  ENTRA_TIMEOUT_S: inteiro(15, 1, 120),
  /** Nome, e-mail e cargo vêm do Microsoft Graph (permissão de aplicação
   * User.Read.All), como na IA Everblue. `false` usa só as claims do token. */
  ENTRA_GRAPH_PERFIL: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? true : ['1', 'true', 'sim', 'yes'].includes(v.trim().toLowerCase()))),

  DIRETORIO_URL: texto(),
  /** Application (client) ID DESTE Monitoramento, igual ao cadastro em
   * Controle de Acessos da Intranet. Vazio usa ENTRA_CLIENT_ID. */
  DIRETORIO_CLIENT_ID: texto(),
  /** Chave derivada EXCLUSIVA desta aplicação, provisionada pela Intranet.
   * Não é o Client Secret do Entra. */
  DIRETORIO_INTEGRATION_SECRET: texto(),
  /** Legado (token delegado `access_as_user`): aceitas e ignoradas, para que
   * um .env antigo não impeça a subida. */
  DIRETORIO_AUDIENCE: texto(),
  DIRETORIO_ESCOPO: texto(),
  DIRETORIO_TIMEOUT_S: inteiro(20, 1, 120),
  DIRETORIO_GRACA_MINUTOS: inteiro(0, 0, 60),

  /** De onde vem a foto do cartão: `graph` (padrão da IA Everblue),
   * `intranet` (GET /api/access/v1/photo) ou `nenhuma` (só iniciais). */
  FOTO_FONTE: z.enum(['graph', 'intranet', 'nenhuma']).default('graph'),

  MINIO_ENDPOINT: z.string().url().default('http://minio:9000'),
  MINIO_REGIAO: texto('us-east-1'),
  MINIO_ACCESS_KEY: z.string().min(3, 'MINIO_ACCESS_KEY é obrigatória'),
  MINIO_SECRET_KEY: z.string().min(1, 'MINIO_SECRET_KEY é obrigatória'),
  MINIO_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'MINIO_BUCKET inválido').default('everblue-monitoramento'),
  MINIO_OBJECT_LOCK: booleano,

  IMPORTACAO_MAX_MB: inteiro(20, 1, 100),
  /** Central de Arquivos: tamanho máximo por arquivo em MB. 0 = sem limite. */
  ARQUIVOS_MAX_MB: inteiro(0, 0, 10_000_000),
  /** Extensões recusadas, separadas por vírgula (ex.: ".exe,.bat"). Vazio = todas aceitas. */
  ARQUIVOS_EXTENSOES_BLOQUEADAS: texto(),
  IMPORTACAO_MAX_LINHAS: inteiro(20000, 1, 200000),

  ADMIN_EMAIL: texto(),
  LOGIN_MAX_TENTATIVAS: inteiro(5, 1, 50),
  LOGIN_BLOQUEIO_MINUTOS: inteiro(15, 1, 1440),
})

export interface Configuracao {
  ambiente: 'desenvolvimento' | 'homologacao' | 'producao'
  producao: boolean
  porta: number
  urlPublica: string
  nivelLog: string
  databaseUrl: string
  databasePoolMax: number
  sessaoSegredo: string
  sessaoHoras: number
  cookieSeguro: boolean
  cofreChave: string
  entra: {
    tenantId: string
    clientId: string
    clientSecret: string
    redirectUri: string
    mapaPerfil: Map<string, PerfilAcesso>
    perfilPadrao: PerfilAcesso
    timeoutMs: number
    configurado: boolean
    graphPerfil: boolean
  }
  diretorio: {
    url: string
    clientId: string
    integrationSecret: string
    timeoutMs: number
    gracaMinutos: number
    /** Autorização pelo /api/access/v1/me ligada. */
    autorizacaoPeloMe: boolean
  }
  fotoFonte: 'graph' | 'intranet' | 'nenhuma'
  minio: {
    endpoint: string
    regiao: string
    accessKey: string
    secretKey: string
    bucket: string
    objectLock: boolean
  }
  importacao: { maxBytes: number; maxLinhas: number }
  arquivos: { maxBytes: number | null; extensoesBloqueadas: string[] }
  adminEmail: string
  login: { maxTentativas: number; bloqueioMinutos: number }
}

/** Interpreta `grupo1=perfil;grupo2=perfil` — texto simples e não JSON,
 * porque quem preenche é o administrador do tenant num arquivo `.env`. */
export function interpretarMapaPerfil(bruto: string): Map<string, PerfilAcesso> {
  const mapa = new Map<string, PerfilAcesso>()
  for (const par of bruto.split(';')) {
    const [chave, valor] = par.split('=', 2).map((p) => p?.trim() ?? '')
    if (chave && valor && perfilValido(valor)) mapa.set(chave.toLowerCase(), valor)
  }
  return mapa
}

export function carregarConfiguracao(ambiente: NodeJS.ProcessEnv = process.env): Configuracao {
  const resultado = esquema.safeParse(ambiente)
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuração inválida no .env:\n${problemas}`)
  }
  const e = resultado.data
  if (!perfilValido(e.ENTRA_PERFIL_PADRAO)) {
    throw new Error(`ENTRA_PERFIL_PADRAO inválido: "${e.ENTRA_PERFIL_PADRAO}".`)
  }
  const urlPublica = e.URL_PUBLICA.replace(/\/+$/, '')
  const producao = e.AMBIENTE === 'producao'
  if (producao && !e.COOKIE_SEGURO) {
    throw new Error('Em produção COOKIE_SEGURO=true é obrigatório: sessão sem TLS não é aceitável.')
  }
  const diretorioUrl = e.DIRETORIO_URL.replace(/\/+$/, '')
  const diretorioClientId = (e.DIRETORIO_CLIENT_ID || e.ENTRA_CLIENT_ID).trim().toLowerCase()
  const integrationSecret = e.DIRETORIO_INTEGRATION_SECRET.trim()
  if (integrationSecret && integrationSecret.length < 32) {
    throw new Error('DIRETORIO_INTEGRATION_SECRET inválido: a chave derivada da Intranet tem ao menos 32 caracteres.')
  }
  if (integrationSecret && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(diretorioClientId)) {
    throw new Error('DIRETORIO_CLIENT_ID (ou ENTRA_CLIENT_ID) precisa ser o Application (client) ID, no formato GUID.')
  }
  if (diretorioUrl && producao && !diretorioUrl.startsWith('https://')) {
    throw new Error('DIRETORIO_URL precisa ser https em produção.')
  }
  return Object.freeze({
    ambiente: e.AMBIENTE,
    producao,
    porta: e.PORTA,
    urlPublica,
    nivelLog: e.NIVEL_LOG,
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    sessaoSegredo: e.SESSAO_SEGREDO,
    sessaoHoras: e.SESSAO_HORAS,
    cookieSeguro: e.COOKIE_SEGURO,
    cofreChave: e.COFRE_CHAVE,
    entra: {
      tenantId: e.ENTRA_TENANT_ID,
      clientId: e.ENTRA_CLIENT_ID,
      clientSecret: e.ENTRA_CLIENT_SECRET,
      // Derivado de URL_PUBLICA quando vazio: manter o mesmo endereço em duas
      // variáveis é como um ambiente acaba com `localhost` apontando para produção.
      redirectUri: e.ENTRA_REDIRECT_URI || `${urlPublica}${CAMINHO_RETORNO_OIDC}`,
      mapaPerfil: interpretarMapaPerfil(e.ENTRA_MAPA_PERFIL),
      perfilPadrao: e.ENTRA_PERFIL_PADRAO,
      timeoutMs: e.ENTRA_TIMEOUT_S * 1000,
      configurado: Boolean(e.ENTRA_TENANT_ID && e.ENTRA_CLIENT_ID && e.ENTRA_CLIENT_SECRET),
      graphPerfil: e.ENTRA_GRAPH_PERFIL,
    },
    diretorio: {
      url: diretorioUrl,
      clientId: diretorioClientId,
      integrationSecret,
      timeoutMs: e.DIRETORIO_TIMEOUT_S * 1000,
      gracaMinutos: e.DIRETORIO_GRACA_MINUTOS,
      // Como na IA: URL + Client ID + chave forte ligam a autorização.
      autorizacaoPeloMe: Boolean(diretorioUrl && diretorioClientId && integrationSecret.length >= 32),
    },
    fotoFonte: e.FOTO_FONTE,
    minio: {
      endpoint: e.MINIO_ENDPOINT,
      regiao: e.MINIO_REGIAO,
      accessKey: e.MINIO_ACCESS_KEY,
      secretKey: e.MINIO_SECRET_KEY,
      bucket: e.MINIO_BUCKET,
      objectLock: e.MINIO_OBJECT_LOCK,
    },
    importacao: { maxBytes: e.IMPORTACAO_MAX_MB * 1024 * 1024, maxLinhas: e.IMPORTACAO_MAX_LINHAS },
    arquivos: {
      maxBytes: e.ARQUIVOS_MAX_MB > 0 ? e.ARQUIVOS_MAX_MB * 1024 * 1024 : null,
      extensoesBloqueadas: e.ARQUIVOS_EXTENSOES_BLOQUEADAS.split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .map((x) => (x.startsWith('.') ? x : `.${x}`)),
    },
    adminEmail: e.ADMIN_EMAIL.toLowerCase(),
    login: { maxTentativas: e.LOGIN_MAX_TENTATIVAS, bloqueioMinutos: e.LOGIN_BLOQUEIO_MINUTOS },
  })
}
