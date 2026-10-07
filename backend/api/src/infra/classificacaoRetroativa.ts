/**
 * Classificação da última posição já importada antes da versão 1.1.
 *
 * A classificação semanal nasce na confirmação da importação; a posição que
 * já estava no banco quando a versão subiu ficaria sem ela até a próxima
 * semana. Este passo (idempotente, no job de migração) classifica SÓ a última
 * semana, e só se ela ainda não tem nenhuma classificação — com o status
 * atual do cliente, que é o daquela posição. Semanas mais antigas não são
 * tocadas: o painel da diretoria as classifica na hora, sem gravar.
 */
import { CARTEIRA_PADRAO_ID, classificarCliente, criticidadeDoCadastro, limiaresDe, prioridadeDoCadastro, semanaAnteriorRef, type ClassificacaoSemanal } from '@monitoramento/dominio'
import type { Banco } from './banco'
import { CadastrosRepositorio } from '../repositorios/cadastrosRepositorio'
import { ClassificacaoRepositorio } from '../repositorios/classificacaoRepositorio'
import { ClienteRepositorio } from '../repositorios/clienteRepositorio'
import { SnapshotRepositorio } from '../repositorios/snapshotRepositorio'

export async function classificarUltimaSemanaPendente(banco: Banco, log: (m: string) => void): Promise<number> {
  const snapshots = new SnapshotRepositorio(banco.pool)
  const classificacoes = new ClassificacaoRepositorio(banco.pool)
  const semanas = await snapshots.semanasDisponiveis()
  const ultima = semanas[semanas.length - 1]
  if (!ultima) return 0
  if ((await classificacoes.porSemana(ultima)).size > 0) return 0

  const anterior = semanaAnteriorRef(semanas, ultima)
  const [atuais, anteriores, clientes, apartadas, carteiras, regras] = await Promise.all([
    snapshots.porSemanas([ultima]),
    anterior ? snapshots.porSemanas([anterior]) : Promise.resolve([]),
    new ClienteRepositorio(banco.pool).listar(),
    new CadastrosRepositorio(banco.pool).idsCarteirasApartadas(),
    new CadastrosRepositorio(banco.pool).listarCarteiras(),
    classificacoes.listarRegras(),
  ])
  const lim = limiaresDe(regras)
  const porCliente = new Map(clientes.map((c) => [c.id, c]))
  const anteriorPorCliente = new Map(anteriores.map((s) => [s.clienteId, s]))
  const nomeCarteira = new Map(carteiras.map((c) => [c.id, c.nome]))
  const agora = new Date().toISOString()
  const lista: ClassificacaoSemanal[] = []
  for (const s of atuais) {
    const cliente = porCliente.get(s.clienteId)
    if (!cliente) continue
    const carteiraId = cliente.carteiraId ?? CARTEIRA_PADRAO_ID
    const c = classificarCliente(
      { status: cliente.status, carteiraApartada: apartadas.has(carteiraId), nomeCarteira: nomeCarteira.get(carteiraId), atual: s, anterior: anteriorPorCliente.get(s.clienteId) ?? null },
      lim,
    )
    lista.push({ ...c, clienteId: s.clienteId, semanaRef: ultima, calculadoEm: agora })
  }
  await banco.transacao(async (tx) => {
    const repo = new ClassificacaoRepositorio(tx)
    const clientesTx = new ClienteRepositorio(tx)
    await repo.inserir(lista, tx)
    await clientesTx.gravarClassificacoes(
      lista.map((c) => ({ id: c.clienteId, prioridade: prioridadeDoCadastro(c.prioridadeOrdem), criticidade: criticidadeDoCadastro(c.criticidade) })),
      tx,
    )
  })
  log(`classificação semanal calculada para a posição de ${ultima.split('-').reverse().join('/')} (${lista.length} cliente(s))`)
  return lista.length
}
