/**
 * Servidor local para inspeção visual (não vai para produção nem roda nos
 * testes): PostgreSQL real de desenvolvimento, MinIO em memória, Bitfin falso
 * com os números das rodadas de 10/2026. Imprime o cookie de uma sessão admin.
 *   TESTE_DATABASE_URL=... npx tsx test/servidor-local.ts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DadosFotoBitfin, DadosMapaBitfin } from '@monitoramento/dominio'
import { comporDependencias } from '../src/composicao'
import { construirServidor } from '../src/http/servidor'
import { ArmazenamentoMemoria } from '../src/infra/armazenamento'
import { criarBanco } from '../src/infra/banco'
import { executarBootstrap } from '../src/infra/bootstrap'
import { carregarDemonstracao } from '../src/infra/cargaDemonstracao'
import { aplicarMigracoes } from '../src/infra/migrador'
import { documentoBitfin } from '../src/infra/bitfinConsultas'
import type { LeitorBitfin } from '../src/infra/bitfin'
import { FonteFotoNenhuma } from '../src/identidade/fontesFoto'
import { configTeste } from './apoio'
import { dadosFotoExemplo, dadosMapaExemplo } from './fixtures/fotoBitfin'

const url = process.env.DEV_DATABASE_URL ?? ''
// Apaga e recria o esquema: só aceita banco local de desenvolvimento.
if (!/^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\/emon_dev$/.test(url)) throw new Error('DEV_DATABASE_URL precisa apontar para o banco local emon_dev.')
const banco = criarBanco(url, 5)
await banco.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
await aplicarMigracoes(banco.pool, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations'))
const armazenamento = new ArmazenamentoMemoria()
await executarBootstrap(banco.pool, armazenamento, () => {})
await carregarDemonstracao(banco, () => {})
const leitor: LeitorBitfin = {
  configurado: true,
  async ler(o) {
    const docs = new Set((o?.documentosMapa ?? []).map((d) => documentoBitfin(d)))
    const mapa: DadosMapaBitfin | undefined = docs.size ? { ...structuredClone(dadosMapaExemplo), clientes: dadosMapaExemplo.clientes.filter((c) => docs.has(documentoBitfin(c.documento))) } : undefined
    return { dados: structuredClone(dadosFotoExemplo) as DadosFotoBitfin, mapa, tempoMs: { clientes: 5 } }
  },
  async testar() {
    return { servidorAgora: new Date().toISOString(), banco: 'UNLTD_EVERBLUE' }
  },
  async buscarNomes(documentos) {
    const m = new Map<string, string>()
    for (const d of documentos) {
      const c = dadosMapaExemplo.clientes.find((x) => documentoBitfin(x.documento) === documentoBitfin(d))
      if (c) m.set(d, c.nome)
    }
    return m
  },
}
const deps = comporDependencias(configTeste({ URL_PUBLICA: 'http://localhost:5173', DIRETORIO_URL: '', DIRETORIO_INTEGRATION_SECRET: '', IMPORTACAO_PLANILHA_HABILITADA: 'false' }), { banco, armazenamento, fonteFoto: new FonteFotoNenhuma(), leitorBitfin: leitor })
const { rows } = await banco.pool.query(`INSERT INTO usuario (email, nome, perfil, origem) VALUES ('admin@grupoeverblue.com.br', 'Administrador Local', 'admin', 'local') RETURNING id`)
const u = { id: String(rows[0].id), nome: 'Administrador Local', email: 'admin@grupoeverblue.com.br' }
await deps.repos.mapa.incluirCliente('93894954000176', 'GF Pneus Comercial e Distribuidora Ltda', u.id)
await deps.repos.mapa.incluirCopia('especialista@grupoeverblue.com.br', u.id)
const id = await deps.repos.fotos.iniciar({ origem: 'MANUAL', solicitadoPor: u.id, gravarPosicao: false, versaoRegras: 'local' })
await deps.servicos.fotoBitfin.executar(id, { origem: 'MANUAL', solicitante: u, gravarPosicao: false })
const app = await construirServidor(deps)
await app.listen({ host: '127.0.0.1', port: 3000 })
console.log(`COOKIE=emon_sessao=${await deps.sessao.emitir(u.id)}`)
