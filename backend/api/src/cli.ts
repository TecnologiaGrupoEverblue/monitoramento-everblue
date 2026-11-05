/**
 * Comandos operacionais (executados no contêiner da API):
 *
 *   node dist/cli.js migrar                 aplica migrações + bootstrap idempotente
 *   node dist/cli.js carga-demonstracao     dados fictícios (base vazia; recusado em produção)
 *   node dist/cli.js conta-emergencia EMAIL "NOME"   senha lida de CONTA_EMERGENCIA_SENHA
 *   node dist/cli.js testar-intranet [OID]   confere a chamada assinada ao /me da Intranet
 *   node dist/cli.js testar-bitfin           conecta ao Bitfin (somente leitura) e conta os clientes da foto
 *   node dist/cli.js testar-email EMAIL      envia um e-mail de teste pelo transporte configurado
 *   node dist/cli.js testar-rede-email       confere a saída até login.microsoftonline.com e graph.microsoft.com
 *   node dist/cli.js zerar-dados             mostra o que a limpeza total apagaria (não altera nada)
 *   node dist/cli.js zerar-dados --confirmar APAGA tudo menos usuários (frase em ZERAR_CONFIRMACAO)
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArmazenamentoS3 } from './infra/armazenamento'
import { criarBanco } from './infra/banco'
import { executarBootstrap } from './infra/bootstrap'
import { classificarUltimaSemanaPendente } from './infra/classificacaoRetroativa'
import { carregarDemonstracao } from './infra/cargaDemonstracao'
import { aplicarMigracoes } from './infra/migrador'
import { carregarConfiguracao } from './config/configuracao'
import { AcessoNegado } from './identidade/erros'
import { ClienteIntranet } from './identidade/intranet'
import { UsuarioRepositorio } from './repositorios/usuarioRepositorio'
import { AuditoriaRepositorio } from './repositorios/auditoriaRepositorio'
import { gerarHashSenha, senhaAceitavel } from './seguranca/senha'
import { ErroBitfin, LeitorBitfinSqlServer } from './infra/bitfin'
import { IntegracaoRepositorio } from './repositorios/integracaoRepositorio'
import { criarEnviadorEmail } from './infra/email'
import { configurarProxyDeSaida } from './infra/proxy'
import { FRASE_CONFIRMACAO, ServicoZerarDados, type ResultadoZerar } from './servicos/servicoZerarDados'

const log = (m: string) => console.log(`[monitoramento] ${m}`)

function diretorioMigracoes(): string {
  if (process.env.MIGRACOES_DIR) return process.env.MIGRACOES_DIR
  const aqui = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(aqui, '../../../database/migrations')
}

async function principal() {
  configurarProxyDeSaida()
  const [comando, ...args] = process.argv.slice(2)
  const cfg = carregarConfiguracao()
  const banco = criarBanco(cfg.databaseUrl, 2)
  try {
    switch (comando) {
      case 'migrar': {
        const r = await aplicarMigracoes(banco.pool, diretorioMigracoes(), log)
        log(r.aplicadas.length ? `migrações aplicadas: ${r.aplicadas.join(', ')}` : `nenhuma migração pendente (${r.jaAplicadas} já aplicadas)`)
        await executarBootstrap(banco.pool, new ArmazenamentoS3(cfg.minio), log)
        await classificarUltimaSemanaPendente(banco, log)
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
          log(`perfil de acesso (accessLevel): ${acesso.nivelAcesso ? `${acesso.nivelAcesso.codigo} (${acesso.nivelAcesso.nome})` : 'NÃO INFORMADO pela Intranet'}`)
          log(`acesso a Foto do Bitfin / Mapa / Parâmetros: ${acesso.nivelAcesso && cfg.niveisAcessoGestao.includes(acesso.nivelAcesso.codigo) ? 'SIM' : 'NÃO'} (liberados: ${cfg.niveisAcessoGestao.join(', ')})`)
          log(`estrutura do /me: raiz [${intranet.ultimaResposta?.chavesRaiz.join(', ')}] · user [${intranet.ultimaResposta?.chavesUsuario.join(', ')}] · accessLevel ${JSON.stringify(intranet.ultimaResposta?.accessLevel)}`)
        } catch (erro) {
          if (!(erro instanceof AcessoNegado)) throw erro
          if (args[0]) log(`NEGADO para ${oid}: ${erro.message}`)
          else log('Assinatura Monitoramento/Intranet aceita: OK (identidade de teste negada, como esperado).')
        }
        break
      }
      case 'testar-bitfin': {
        // Leitura completa da foto, SEM gravar nada: mostra quantos clientes e
        // quanto tempo cada consulta levou. Prova conexão, permissão e consultas.
        // Segundo consumidor do Bitfin (além da API): 1 conexão, fechada ao fim.
        const leitor = new LeitorBitfinSqlServer(cfg.bitfin, (e) => new IntegracaoRepositorio(banco.pool, cfg.ambiente).registrar(e))
        if (!leitor.configurado) throw new Error('Bitfin não configurado (BITFIN_SERVIDOR, BITFIN_USUARIO, BITFIN_SENHA).')
        log(`Bitfin: ${cfg.bitfin.servidor}:${cfg.bitfin.porta}/${cfg.bitfin.banco} como ${cfg.bitfin.usuario}${cfg.bitfin.confiarCertificado ? ' (certificado do servidor não verificado, ADR-014)' : ''}`)
        const ctx = { atorRef: 'cli', correlationId: `cli-${Date.now()}` }
        let r: Awaited<ReturnType<typeof leitor.ler>>
        try {
          const t = await leitor.testar(ctx)
          log(`conectado · hora do servidor do Bitfin: ${t.servidorAgora}`)
          r = await leitor.ler({}, ctx)
        } catch (e) {
          // Operador no servidor: mostra o código e o detalhe do driver (nunca na tela do usuário).
          if (e instanceof ErroBitfin) throw new Error(`${e.codigo}: ${e.message}${e.etapa ? ` [etapa ${e.etapa}]` : ''}${e.detalhe ? ` — ${e.detalhe}` : ''}`)
          throw e
        } finally {
          await leitor.encerrar()
        }
        const porSituacao = new Map<string, number>()
        for (const c of r.dados.clientes) porSituacao.set(c.situacao, (porSituacao.get(c.situacao) ?? 0) + 1)
        log(`clientes da foto: ${r.dados.clientes.length} (${[...porSituacao].map(([s, n]) => `${s} ${n}`).join(', ')}) · eventos da semana: ${r.dados.eventos.length}`)
        log(`tempo por consulta (ms): ${Object.entries(r.tempoMs).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
        log('Nada foi gravado (teste somente leitura).')
        break
      }
      case 'testar-email': {
        const para = (args[0] ?? '').trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) throw new Error('Uso: testar-email EMAIL')
        const email = criarEnviadorEmail(cfg)
        if (!email.ligado) throw new Error('Envio de e-mail desligado (EMAIL_TRANSPORTE).')
        await email.enviar({ para: [para], assunto: 'Monitoramento Everblue — teste de envio', html: '<p>Teste de envio do Monitoramento Everblue (Mapa de Garantias).</p>', texto: 'Teste de envio do Monitoramento Everblue (Mapa de Garantias).', anexos: [] })
        log(`e-mail de teste enviado para ${para} por ${email.descricao}`)
        break
      }
      case 'testar-rede-email': {
        for (const host of ['login.microsoftonline.com', 'graph.microsoft.com']) {
          try {
            await fetch(`https://${host}/`, { method: 'HEAD', signal: AbortSignal.timeout(10_000) })
            log(`${host}: acessível`)
          } catch (e) {
            throw new Error(`${host} inacessível a partir da API (${(e as Error).cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error).message}). Confira firewall/proxy.`)
          }
        }
        break
      }
      case 'zerar-dados': {
        const servico = new ServicoZerarDados(banco.pool, new ArmazenamentoS3(cfg.minio))
        const mostrar = (r: ResultadoZerar, verbo: string) => {
          for (const [t, n] of Object.entries(r.linhas)) if (n > 0) log(`  ${t.padEnd(24)} ${n}`)
          log(`${verbo}: ${r.totalLinhas} linha(s) no banco e ${r.arquivos.chaves} arquivo(s) (${r.arquivos.versoes} versão(ões)) no MinIO`)
          log(`mantidos: ${r.usuariosMantidos} usuário(s) e perfis`)
        }
        if (args.includes('--manifesto')) {
          await servico.manifesto((l) => console.log(l))
          break
        }
        if (!args.includes('--confirmar')) {
          mostrar(await servico.simular(), 'seria apagado (SIMULAÇÃO, nada foi alterado)')
          break
        }
        const r = await servico.zerar({ confirmacao: process.env.ZERAR_CONFIRMACAO ?? '', executadoPor: (process.env.ZERAR_EXECUTADO_POR ?? 'servidor').slice(0, 200) })
        mostrar(r, 'APAGADO')
        await executarBootstrap(banco.pool, new ArmazenamentoS3(cfg.minio), log)
        log(`regras de alerta e classificação no padrão; agendadores no padrão. Frase usada: ${FRASE_CONFIRMACAO}`)
        break
      }
      default:
        throw new Error('Comandos: migrar | carga-demonstracao | conta-emergencia | testar-intranet | testar-bitfin | testar-email | testar-rede-email | zerar-dados')
    }
  } finally {
    await banco.encerrar()
  }
}

principal().catch((erro) => {
  console.error(`[monitoramento] ERRO: ${(erro as Error).message}`)
  process.exit(1)
})
