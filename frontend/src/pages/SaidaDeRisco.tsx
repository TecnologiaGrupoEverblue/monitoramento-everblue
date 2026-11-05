import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import BotaoModoRevisao from '../components/BotaoModoRevisao'
import ClientesTabela from '../components/ClientesTabela'
import ResumoChecklistBadge from '../components/ResumoChecklistBadge'
import { KpiCard, Painel } from '../components/ui/Card'
import { Carregando, ErroCarga } from '../components/ui/EstadoCarga'
import { useFiltros } from '../contexts/FiltrosContext'
import { consultas } from '../consultas'
import { formatarData, formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '../utils/formatters'

export default function SaidaDeRisco() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const [aba, setAba] = useState<'clientes' | 'iasr'>('clientes')
  const qClientes = useQuery({ ...consultas.clientesEnriquecidos({ ...filtros, status: 'SAIDA_DE_RISCO' }), enabled: !carregandoFiltros })
  const qSaidas = useQuery(consultas.saidas())
  const qIasr = useQuery(consultas.iasrIndicadores())
  const clientes = qClientes.data ?? []
  const dadosSaida = useMemo(() => new Map((qSaidas.data ?? []).map((x) => [x.clienteId, x])), [qSaidas.data])
  const indicadoresIasr = qIasr.data ?? null
  const carregando = qClientes.isPending || qSaidas.isPending || qIasr.isPending
  const erro = qClientes.error ?? qSaidas.error ?? qIasr.error

  const dadosGrafico = clientes
    .map((c) => {
      const sdr = dadosSaida.get(c.id)
      // Sem risco de entrada registrado não há o que comparar (não é "zero").
      if (!sdr || !(sdr.riscoNaEntrada > 0)) return null
      return { nome: c.nome.length > 22 ? `${c.nome.slice(0, 21)}…` : c.nome, 'Risco na entrada': sdr.riscoNaEntrada, 'Risco atual': c.snapshotAtual?.riscoCliente ?? 0 }
    })
    .filter(Boolean) as { nome: string; 'Risco na entrada': number; 'Risco atual': number }[]

  const comEntrada = clientes.filter((c) => (dadosSaida.get(c.id)?.riscoNaEntrada ?? 0) > 0)
  const totalEntrada = comEntrada.reduce((s, c) => s + (dadosSaida.get(c.id)?.riscoNaEntrada ?? 0), 0)
  const totalAtualComEntrada = comEntrada.reduce((s, c) => s + (c.snapshotAtual?.riscoCliente ?? 0), 0)
  const totalAtual = clientes.reduce((s, c) => s + (c.snapshotAtual?.riscoCliente ?? 0), 0)
  const percReducao = totalEntrada > 0 ? ((totalEntrada - totalAtualComEntrada) / totalEntrada) * 100 : null
  const semEntrada = clientes.length - comEntrada.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            Saída de Risco
          </h1>
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            {clientes.length} cliente(s) em desmobilização de exposição
          </p>
        </div>
        {aba === 'clientes' && <BotaoModoRevisao clientes={clientes} statusAtual="SAIDA_DE_RISCO" />}
      </div>

      <div className="flex gap-5 border-b text-sm" style={{ borderColor: 'var(--cor-borda-forte)' }}>
        <button
          onClick={() => setAba('clientes')}
          className="border-b-2 py-2"
          style={{ borderColor: aba === 'clientes' ? 'var(--cor-acento)' : 'transparent', color: aba === 'clientes' ? 'var(--cor-texto-primario)' : 'var(--cor-texto-secundario)', fontWeight: aba === 'clientes' ? 600 : 400 }}
        >
          Clientes
        </button>
        <button
          onClick={() => setAba('iasr')}
          className="border-b-2 py-2"
          style={{ borderColor: aba === 'iasr' ? 'var(--cor-acento)' : 'transparent', color: aba === 'iasr' ? 'var(--cor-texto-primario)' : 'var(--cor-texto-secundario)', fontWeight: aba === 'iasr' ? 600 : 400 }}
        >
          IASR — Assertividade
        </button>
      </div>

      {erro && <ErroCarga erro={erro} aoTentarDeNovo={() => void Promise.all([qClientes.refetch(), qSaidas.refetch(), qIasr.refetch()])} />}
      {!erro && carregando && <Carregando />}

      {!erro && !carregando && aba === 'clientes' && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard titulo="Risco na entrada (total)" valor={comEntrada.length > 0 ? formatarMoeda(totalEntrada) : 'Não informado'} formatoVariacao="numero" />
            <KpiCard titulo="Risco atual (total)" valor={formatarMoeda(totalAtual)} formatoVariacao="numero" />
            <KpiCard titulo="% de redução da exposição" valor={percReducao === null ? 'Não informado' : formatarPercentual(percReducao)} formatoVariacao="numero" destaque="normal" />
          </div>
          {semEntrada > 0 && (
            <p className="-mt-2 text-xs" style={{ color: 'var(--cor-atencao)' }}>
              {semEntrada} de {clientes.length} cliente(s) sem data e risco de entrada na Saída de Risco registrados: ficam fora do cálculo de redução.
            </p>
          )}

          <Painel titulo="Risco na entrada x Risco atual — velocidade de desmobilização">
            {dadosGrafico.length === 0 ? (
              <p className="py-10 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
                Nenhum cliente com risco de entrada registrado: sem base para comparar.
              </p>
            ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dadosGrafico} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
                <XAxis dataKey="nome" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis tickFormatter={(v) => formatarMoedaCompacta(v)} tick={{ fontSize: 11 }} width={84} />
                <Tooltip formatter={(v) => formatarMoedaCompacta(Number(v))} />
                <Legend />
                <Bar dataKey="Risco na entrada" fill="var(--cor-inativo)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Risco atual" fill="var(--cor-saida)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </Painel>

          <Painel>
            <ClientesTabela
              clientes={clientes}
              mostrarStatus={false}
              semColunas={['grupo', 'plataforma', 'prioridade']}
              complementoGerente={(c) => {
                // Responsável só aparece quando não é o próprio gerente.
                const r = dadosSaida.get(c.id)?.responsavel
                return r && r !== c.gerente?.nome && r !== c.responsavel ? (
                  <span className="block text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                    Resp.: {r}
                  </span>
                ) : null
              }}
              colunasExtras={[
                { header: 'Entrada', render: (c) => <span className="whitespace-nowrap">{formatarData(dadosSaida.get(c.id)?.dataEntrada)}</span> },
                { header: 'Motivo', ocultar: '2xl', render: (c) => <span className="text-xs">{dadosSaida.get(c.id)?.motivo || '—'}</span> },
                {
                  header: 'Risco na entrada',
                  alinhamento: 'right',
                  render: (c) => {
                    const e = dadosSaida.get(c.id)?.riscoNaEntrada ?? 0
                    return e > 0 ? formatarMoeda(e) : '—'
                  },
                },
                {
                  header: '% redução',
                  alinhamento: 'right',
                  render: (c) => {
                    const entrada = dadosSaida.get(c.id)?.riscoNaEntrada ?? 0
                    const atualv = c.snapshotAtual?.riscoCliente ?? 0
                    return entrada > 0 ? formatarPercentual(((entrada - atualv) / entrada) * 100) : '—'
                  },
                },
                { header: 'Checklist', render: (c) => <ResumoChecklistBadge clienteId={c.id} semanaRef={filtros.semanaRef ?? c.snapshotAtual?.semanaRef ?? null} /> },
              ]}
            />
          </Painel>
        </>
      )}

      {!erro && !carregando && aba === 'iasr' && indicadoresIasr && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard titulo="Saídas realizadas" valor={String(indicadoresIasr.saidasRealizadas)} formatoVariacao="numero" />
            <KpiCard titulo="Saídas acompanhadas" valor={String(indicadoresIasr.saidasAcompanhadas)} formatoVariacao="numero" />
            <KpiCard titulo="Com eventos posteriores" valor={String(indicadoresIasr.comEventosPosteriores)} formatoVariacao="numero" destaque="atencao" />
            <KpiCard titulo="% de assertividade" valor={formatarPercentual(indicadoresIasr.percAssertividade)} formatoVariacao="numero" destaque={indicadoresIasr.percAssertividade >= 70 ? 'normal' : 'critico'} />
            <KpiCard
              titulo="Tempo médio decisão → evento"
              valor={indicadoresIasr.tempoMedioDiasDecisaoEvento !== null ? `${indicadoresIasr.tempoMedioDiasDecisaoEvento} dias` : '—'}
              formatoVariacao="numero"
            />
          </div>
          <Painel titulo="Motivos que mais anteciparam problemas">
            {indicadoresIasr.motivosQueMaisAntecipam.length === 0 ? (
              <p className="py-6 text-center text-sm text-[color:var(--cor-texto-secundario)]">Nenhum evento posterior registrado até o momento.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--cor-borda)' }}>
                {indicadoresIasr.motivosQueMaisAntecipam.map((m) => (
                  <li key={m.motivo} className="flex items-center justify-between py-2 text-sm">
                    <span>{m.motivo}</span>
                    <span className="font-semibold" style={{ color: 'var(--cor-critico)' }}>
                      {m.ocorrencias} caso(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Painel>
          <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
            O Índice de Assertividade de Saída de Risco (IASR) acompanha cada cliente/grupo por 12 meses após a decisão de saída, mesmo com exposição zero, registrando
            eventos de crédito relevantes ocorridos depois — para medir se a decisão foi antecipadamente correta.
          </p>
        </div>
      )}
    </div>
  )
}
