/**
 * Configuração central. Nenhum valor operacional é fixado em código: tudo vem
 * do ambiente (`.env` do servidor), é validado na subida e congelado.
 *
 * Variável obrigatória ausente derruba o processo na hora, com a lista do que
 * falta — é melhor a API não subir do que subir com um segredo vazio e
 * descobrir no primeiro login.
 */
import { z } from 'zod'
import { ARQUIVOS_MAX_MB_PADRAO, EXTENSOES_SEMPRE_BLOQUEADAS, perfilValido, type PerfilAcesso } from '@monitoramento/dominio'

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
  /** Orçamento agregado do PostgreSQL (docs/CONEXOES-BANCO.md): conexões
   * aprovadas para TODOS os consumidores do Monitoramento (max_connections=50
   * menos reserva de superusuário e margem). API + migração + linha de comando
   * acima disso recusa o boot. */
  DATABASE_CONEXOES_APROVADAS: inteiro(40, 1, 1000),

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
  /** Verificação periódica da Intranet (alerta de indisponibilidade), em minutos. 0 = só pelas consultas reais. */
  DIRETORIO_MONITOR_MINUTOS: inteiro(5, 0, 60),

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
  /** Central de Arquivos: tamanho máximo por arquivo em MB. 0 = padrão (100 MB). */
  ARQUIVOS_MAX_MB: inteiro(0, 0, 10_240),
  /** Extensões recusadas ALÉM das sempre bloqueadas (executáveis e scripts), separadas por vírgula. */
  ARQUIVOS_EXTENSOES_BLOQUEADAS: texto(),
  IMPORTACAO_MAX_LINHAS: inteiro(20000, 1, 200000),

  /** Bitfin (SQL Server de produção), lido SOMENTE pela foto. Senha só no .env do servidor. */
  BITFIN_SERVIDOR: texto(),
  BITFIN_PORTA: inteiro(1433, 1, 65535),
  BITFIN_BANCO: texto('UNLTD_EVERBLUE'),
  BITFIN_USUARIO: texto(),
  BITFIN_SENHA: texto(),
  /** Conexão igual à da Intranet: canal cifrado sem validar o certificado do
   * SQL Server (decisão do usuário em 29/10/2026, ADR-014). */
  BITFIN_CONFIAR_CERTIFICADO: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? true : ['1', 'true', 'sim', 'yes'].includes(v.trim().toLowerCase()))),
  BITFIN_TIMEOUT_S: inteiro(180, 5, 1800),
  /** Fotos de TESTE (sem posição gravada e sem Mapa enviado) saem depois deste
   * prazo; as que gravaram posição ou geraram Mapa são permanentes (ADR-021).
   * Piso de 90 dias também no banco (migração 0012). */
  RETENCAO_FOTO_TESTE_DIAS: inteiro(90, 90, 3650),
  // Proteção do Bitfin (padrão corporativo de conexões, ADR-020): por classe
  // de consulta, fila limitada e disjuntor. O teto da foto (BITFIN_TIMEOUT_S)
  // vale por consulta; a foto inteira tem prazo total próprio.
  BITFIN_PRAZO_FOTO_S: inteiro(900, 30, 3600),
  BITFIN_TIMEOUT_NOMES_S: inteiro(15, 2, 120),
  BITFIN_FILA_MAX: inteiro(3, 0, 20),
  BITFIN_ESPERA_FILA_FOTO_S: inteiro(60, 1, 600),
  BITFIN_ESPERA_FILA_NOMES_S: inteiro(10, 1, 120),
  BITFIN_DISJUNTOR_FALHAS: inteiro(3, 1, 20),
  BITFIN_DISJUNTOR_ABERTO_S: inteiro(300, 10, 3600),
  /** Desliga a importação por planilha (1.2: os dados vêm do Bitfin). */
  IMPORTACAO_PLANILHA_HABILITADA: booleano,

  /** Envio de e-mail (Mapa de Garantias). `desligado` registra o envio como
   * não enviado — nunca finge sucesso. */
  EMAIL_TRANSPORTE: z.enum(['desligado', 'smtp', 'graph']).default('desligado'),
  EMAIL_REMETENTE: texto(),
  EMAIL_REMETENTE_NOME: texto('Monitoramento Everblue'),
  SMTP_HOST: texto(),
  SMTP_PORTA: inteiro(587, 1, 65535),
  /** true = TLS direto (porta 465); false = STARTTLS obrigatório (porta 587). */
  SMTP_TLS_DIRETO: booleano,
  SMTP_USUARIO: texto(),
  SMTP_SENHA: texto(),
  EMAIL_TIMEOUT_S: inteiro(30, 5, 300),
  /** Perfis de acesso da Intranet (code do accessLevel) que veem Foto do
   * Bitfin, Mapa de Garantias e Parâmetros. Decisão de 30/10/2026: Administrador,
   * Diretoria e Gerente. */
  NIVEIS_ACESSO_GESTAO: texto('admin,director,manager'),
  /** App Registration para e-mail (Mail.Send de aplicação). Vazios usam ENTRA_*. */
  GRAPH_MAIL_TENANT_ID: texto(),
  GRAPH_MAIL_CLIENT_ID: texto(),
  GRAPH_MAIL_CLIENT_SECRET: texto(),

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
    /** Intervalo da verificação periódica (ms); 0 = desligada. */
    monitorMs: number
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
  importacao: { maxBytes: number; maxLinhas: number; planilhaHabilitada: boolean }
  retencaoFotoTesteDias: number
  /** Códigos de accessLevel da Intranet com acesso às áreas de gestão. */
  niveisAcessoGestao: string[]
  email: {
    transporte: 'desligado' | 'smtp' | 'graph'
    remetente: string
    remetenteNome: string
    smtp: { host: string; porta: number; tlsDireto: boolean; usuario: string; senha: string }
    timeoutMs: number
    /** App Registration usada no envio pelo Graph (GRAPH_MAIL_* ou, vazios, ENTRA_*). */
    graph: { tenantId: string; clientId: string; clientSecret: string; origem: 'GRAPH_MAIL' | 'ENTRA' }
  }
  bitfin: {
    servidor: string
    porta: number
    banco: string
    usuario: string
    senha: string
    confiarCertificado: boolean
    timeoutMs: number
    configurado: boolean
    protecao: {
      prazoFotoMs: number
      timeoutNomesMs: number
      filaMax: number
      esperaFilaFotoMs: number
      esperaFilaNomesMs: number
      disjuntorFalhas: number
      disjuntorAbertoMs: number
    }
  }
  arquivos: { maxBytes: number; extensoesBloqueadas: string[] }
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
  // Teto agregado: API (1 processo × DATABASE_POOL_MAX) + migração (2) + linha
  // de comando eventual (2) + limpeza/diagnóstico (2) ≤ capacidade aprovada.
  const tetoTotalPg = e.DATABASE_POOL_MAX + 6
  if (tetoTotalPg > e.DATABASE_CONEXOES_APROVADAS) {
    throw new Error(`Orçamento de conexões do PostgreSQL excedido: API ${e.DATABASE_POOL_MAX} + 6 de jobs = ${tetoTotalPg} > ${e.DATABASE_CONEXOES_APROVADAS} aprovadas (DATABASE_CONEXOES_APROVADAS).`)
  }
  if (!perfilValido(e.ENTRA_PERFIL_PADRAO)) {
    throw new Error(`ENTRA_PERFIL_PADRAO inválido: "${e.ENTRA_PERFIL_PADRAO}".`)
  }
  const urlPublica = e.URL_PUBLICA.replace(/\/+$/, '')
  const producao = e.AMBIENTE === 'producao'
  if (producao && !e.COOKIE_SEGURO) {
    throw new Error('Em produção COOKIE_SEGURO=true é obrigatório: sessão sem TLS não é aceitável.')
  }
  if (e.EMAIL_TRANSPORTE !== 'desligado' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.EMAIL_REMETENTE)) {
    throw new Error('EMAIL_REMETENTE precisa ser um e-mail válido quando EMAIL_TRANSPORTE está ligado.')
  }
  if (e.EMAIL_TRANSPORTE === 'smtp' && !e.SMTP_HOST) throw new Error('SMTP_HOST é obrigatório com EMAIL_TRANSPORTE=smtp.')
  const graphMail = [e.GRAPH_MAIL_TENANT_ID, e.GRAPH_MAIL_CLIENT_ID, e.GRAPH_MAIL_CLIENT_SECRET].filter((v) => v.trim() !== '').length
  if (graphMail !== 0 && graphMail !== 3) throw new Error('GRAPH_MAIL_TENANT_ID, GRAPH_MAIL_CLIENT_ID e GRAPH_MAIL_CLIENT_SECRET vão juntos: preencha os três ou deixe os três vazios.')
  const credGraph = graphMail === 3
    ? { tenantId: e.GRAPH_MAIL_TENANT_ID.trim(), clientId: e.GRAPH_MAIL_CLIENT_ID.trim(), clientSecret: e.GRAPH_MAIL_CLIENT_SECRET, origem: 'GRAPH_MAIL' as const }
    : { tenantId: e.ENTRA_TENANT_ID, clientId: e.ENTRA_CLIENT_ID, clientSecret: e.ENTRA_CLIENT_SECRET, origem: 'ENTRA' as const }
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (e.EMAIL_TRANSPORTE === 'graph') {
    if (!credGraph.tenantId || !credGraph.clientId || !credGraph.clientSecret) throw new Error('EMAIL_TRANSPORTE=graph precisa de GRAPH_MAIL_TENANT_ID, GRAPH_MAIL_CLIENT_ID e GRAPH_MAIL_CLIENT_SECRET (ou ENTRA_*).')
    if (!guid.test(credGraph.tenantId) || !guid.test(credGraph.clientId)) throw new Error(`${credGraph.origem}_TENANT_ID e ${credGraph.origem}_CLIENT_ID precisam estar no formato GUID.`)
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
      monitorMs: e.DIRETORIO_MONITOR_MINUTOS * 60_000,
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
    importacao: { maxBytes: e.IMPORTACAO_MAX_MB * 1024 * 1024, maxLinhas: e.IMPORTACAO_MAX_LINHAS, planilhaHabilitada: e.IMPORTACAO_PLANILHA_HABILITADA },
    retencaoFotoTesteDias: e.RETENCAO_FOTO_TESTE_DIAS,
    niveisAcessoGestao: (() => {
      const lista = e.NIVEIS_ACESSO_GESTAO.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
      for (const v of lista) if (!/^[a-z][a-z0-9_]{0,31}$/.test(v)) throw new Error(`NIVEIS_ACESSO_GESTAO inválido: "${v}".`)
      if (lista.length === 0) throw new Error('NIVEIS_ACESSO_GESTAO não pode ficar vazio.')
      return lista
    })(),
    email: {
      transporte: e.EMAIL_TRANSPORTE,
      remetente: e.EMAIL_REMETENTE.toLowerCase(),
      remetenteNome: e.EMAIL_REMETENTE_NOME,
      smtp: { host: e.SMTP_HOST, porta: e.SMTP_PORTA, tlsDireto: e.SMTP_TLS_DIRETO, usuario: e.SMTP_USUARIO, senha: e.SMTP_SENHA },
      timeoutMs: e.EMAIL_TIMEOUT_S * 1000,
      graph: credGraph,
    },
    bitfin: {
      servidor: e.BITFIN_SERVIDOR,
      porta: e.BITFIN_PORTA,
      banco: e.BITFIN_BANCO,
      usuario: e.BITFIN_USUARIO,
      senha: e.BITFIN_SENHA,
      confiarCertificado: e.BITFIN_CONFIAR_CERTIFICADO,
      timeoutMs: e.BITFIN_TIMEOUT_S * 1000,
      configurado: Boolean(e.BITFIN_SERVIDOR && e.BITFIN_USUARIO && e.BITFIN_SENHA),
      protecao: {
        prazoFotoMs: e.BITFIN_PRAZO_FOTO_S * 1000,
        timeoutNomesMs: e.BITFIN_TIMEOUT_NOMES_S * 1000,
        filaMax: e.BITFIN_FILA_MAX,
        esperaFilaFotoMs: e.BITFIN_ESPERA_FILA_FOTO_S * 1000,
        esperaFilaNomesMs: e.BITFIN_ESPERA_FILA_NOMES_S * 1000,
        disjuntorFalhas: e.BITFIN_DISJUNTOR_FALHAS,
        disjuntorAbertoMs: e.BITFIN_DISJUNTOR_ABERTO_S * 1000,
      },
    },
    arquivos: {
      maxBytes: (e.ARQUIVOS_MAX_MB > 0 ? e.ARQUIVOS_MAX_MB : ARQUIVOS_MAX_MB_PADRAO) * 1024 * 1024,
      extensoesBloqueadas: [
        ...new Set([
          ...EXTENSOES_SEMPRE_BLOQUEADAS,
          ...e.ARQUIVOS_EXTENSOES_BLOQUEADAS.split(',')
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
            .map((x) => (x.startsWith('.') ? x : `.${x}`)),
        ]),
      ],
    },
    adminEmail: e.ADMIN_EMAIL.toLowerCase(),
    login: { maxTentativas: e.LOGIN_MAX_TENTATIVAS, bloqueioMinutos: e.LOGIN_BLOQUEIO_MINUTOS },
  })
}
