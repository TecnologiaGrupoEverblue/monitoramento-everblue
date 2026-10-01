/**
 * Comandos operacionais (executados no contêiner da API):
 *
 *   node dist/cli.js migrar                 aplica migrações + bootstrap idempotente
 *   node dist/cli.js carga-demonstracao     dados fictícios (base vazia; recusado em produção)
 *   node dist/cli.js conta-emergencia EMAIL "NOME"   senha lida de CONTA_EMERGENCIA_SENHA
 *   node dist/cli.js testar-intranet [OID]   confere a chamada assinada ao /me da Intranet
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArmazenamentoS3 } from './infra/armazenamento'
import { criarBanco } from './infra/banco'
import { executarBootstrap } from './infra/bootstrap'
import { carregarDemonstracao } from './infra/cargaDemonstracao'
import { aplicarMigracoes } from './infra/migrador'
import { carregarConfiguracao } from './config/configuracao'
import { AcessoNegado } from './identidade/erros'
import { ClienteIntranet } from './identidade/intranet'
import { UsuarioRepositorio } from './repositorios/usuarioRepositorio'
import { AuditoriaRepositorio } from './repositorios/auditoriaRepositorio'
import { gerarHashSenha, senhaAceitavel } from './seguranca/senha'

const log = (m: string) => console.log(`[monitoramento] ${m}`)

function diretorioMigracoes(): string {
  if (process.env.MIGRACOES_DIR) return process.env.MIGRACOES_DIR
  const aqui = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(aqui, '../../../database/migrations')
}

async function principal() {
  const [comando, ...args] = process.argv.slice(2)
  const cfg = carregarConfiguracao()
  const banco = criarBanco(cfg.databaseUrl, 2)
  try {
    switch (comando) {
      case 'migrar': {
        const r = await aplicarMigracoes(banco.pool, diretorioMigracoes(), log)
        log(r.aplicadas.length ? `migrações aplicadas: ${r.aplicadas.join(', ')}` : `nenhuma migração pendente (${r.jaAplicadas} já aplicadas)`)
        await executarBootstrap(banco.pool, new ArmazenamentoS3(cfg.minio), log)
        break
      }
      case 'carga-demonstracao': {
        if (cfg.producao) throw new Error('Carga de demonstração é recusada em produção.')
        await carregarDemonstracao(banco, log)
        break
      }
      case 'conta-emergencia': {
        const [email, nome] = args
        const senha = process.env.CONTA_EMERGENCIA_SENHA ?? ''
        if (!email || !nome) throw new Error('Uso: conta-emergencia EMAIL "NOME" (senha em CONTA_EMERGENCIA_SENHA)')
        const motivo = senhaAceitavel(senha)
        if (motivo) throw new Error(motivo)
        const id = await new UsuarioRepositorio(banco.pool).definirContaEmergencia(
          email,
          nome,
          await gerarHashSenha(senha),
          'Conta de emergência: acesso quando o Entra ID ou a Intranet estiverem indisponíveis.',
        )
        await new AuditoriaRepositorio(banco.pool).registrar({ acao: 'conta_emergencia.definida', resultado: 'excecao', recursoTipo: 'usuario', recursoId: id, atorEmail: 'cli' })
        log(`conta de emergência definida para ${email}`)
        break
      }
      case 'testar-intranet': {
        // Sem OID: usa uma identidade sintética que NÃO existe no cadastro. A
        // resposta esperada é 403 SYSTEM_ACCESS_DENIED — prova que a Intranet
        // aceitou a ASSINATURA (Client ID + chave) e só então negou a pessoa.
        // Com OID: mostra a decisão para aquela pessoa.
        const oid = (args[0] ?? '00000000-0000-4000-8000-000000000001').trim()
        const intranet = new ClienteIntranet(cfg)
        if (!intranet.ativo) throw new Error('Integração com a Intranet não configurada (DIRETORIO_URL, DIRETORIO_CLIENT_ID, DIRETORIO_INTEGRATION_SECRET).')
        log(`Intranet: ${cfg.diretorio.url} · Client ID: ${cfg.diretorio.clientId}`)
        try {
          const acesso = await intranet.validarAcesso(oid)
          log(`LIBERADO: ${acesso.nome || acesso.email} · departamento: ${acesso.departamento?.nome ?? '(sem departamento)'}`)
        } catch (erro) {
          if (!(erro instanceof AcessoNegado)) throw erro
          if (args[0]) log(`NEGADO para ${oid}: ${erro.message}`)
          else log('Assinatura Monitoramento/Intranet aceita: OK (identidade de teste negada, como esperado).')
        }
        break
      }
      default:
        throw new Error('Comandos: migrar | carga-demonstracao | conta-emergencia | testar-intranet')
    }
  } finally {
    await banco.encerrar()
  }
}

principal().catch((erro) => {
  console.error(`[monitoramento] ERRO: ${(erro as Error).message}`)
  process.exit(1)
})
