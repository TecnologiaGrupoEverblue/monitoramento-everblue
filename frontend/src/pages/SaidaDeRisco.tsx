import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import BotaoModoRevisao from '../components/BotaoModoRevisao'
import ClientesTabela from '../components/ClientesTabela'
import ResumoChecklistBadge from '../components/ResumoChecklistBadge'
import { KpiCard, Painel } from '../components/ui/Card'
import { useFiltros } from '../contexts/FiltrosContext'
import type { ClienteEnriquecido, SaidaDeRisco as SaidaDeRiscoTipo } from '../models/types'
import { clienteRepository, iasrRepository, saidaDeRiscoRepository, type IndicadoresIASR } from '../repositories'
import { formatarData, formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '../utils/formatters'

export default function SaidaDeRisco() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const [aba, setAba] = useState<'clientes' | 'iasr'>('clientes')
  const [clientes, setClientes] = useState<ClienteEnriquecido[]>([])
  const [dadosSaida, setDadosSaida] = useState<Map<string, SaidaDeRiscoTipo>>(new Map())
  const [indicadoresIasr, setIndicadoresIasr] = useState<IndicadoresIASR | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(() => {
    setCarregando(true)
    return Promise.all([
      clienteRepository.listarEnriquecidos({ ...filtros, status: 'SAIDA_DE_RISCO' }),
      saidaDeRiscoRepository.listarTodos(),
      iasrRepository.calcularIndicadores(),
    ]).then(([lista, saidas, indicadores]) => {
      setClientes(lista)
      setDadosSaida(new Map(saidas.map((s) => [s.clienteId, s])))
      setIndicadoresIasr(indicadores)
      setCarregando(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros])

  useEffect(() => {
    if (carregandoFiltros) return
    carregar()
  }, [carregandoFiltros, carregar])

  const dadosGrafico = clientes
    .map((c) => {
      const sdr = dadosSaida.get(c.id)
      if (!sdr) return null
      return { nome: c.nome.split(' ').slice(0, 2).join(' '), 'Risco na entrada': sdr.riscoNaEntrada, 'Risco atual': c.snapshotAtual?.riscoCliente ?? 0 }
    })
    .filter(Boolean) as { nome: string; 'Risco na entrada': number; 'Risco atual': number }[]

  const totalEntrada = clientes.reduce((s, c) => s + (dadosSaida.get(c.id)?.riscoNaEntrada ?? 0), 0)
  const totalAtual = clientes.reduce((s, c) => s + (c.snapshotAtual?.riscoCliente ?? 0), 0)
  const percReducao = totalEntrada > 0 ? ((totalEntrada - totalAtual) / totalEntrada) * 100 : 0

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
        {aba === 'clientes' && <BotaoModoRevisao clientes={clientes} statusAtual="SAIDA_DE_RISCO" aoConcluir={carregar} />}
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

      {carregando && <p className="text-sm text-gray-500">Carregando…</p>}

      {!carregando && aba === 'clientes' && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard titulo="Risco na entrada (total)" valor={formatarMoeda(totalEntrada)} formatoVariacao="numero" />
            <KpiCard titulo="Risco atual (total)" valor={formatarMoeda(totalAtual)} formatoVariacao="numero" />
            <KpiCard titulo="% de redução da exposição" valor={formatarPercentual(percReducao)} formatoVariacao="numero" destaque="normal" />
          </div>

          <Painel titulo="Risco na entrada x Risco atual — velocidade de desmobilização">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dadosGrafico} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
                <XAxis dataKey="nome" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis tickFormatter={(v) => formatarMoedaCompacta(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatarMoedaCompacta(Number(v))} />
                <Legend />
                <Bar dataKey="Risco na entrada" fill="var(--cor-inativo)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Risco atual" fill="var(--cor-saida)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Painel>

          <Painel>
            <ClientesTabela
              clientes={clientes}
              mostrarStatus={false}
              colunasExtras={[
                { header: 'Data de entrada', render: (c) => formatarData(dadosSaida.get(c.id)?.dataEntrada) },
                { header: 'Motivo', render: (c) => <span className="text-xs">{dadosSaida.get(c.id)?.motivo}</span> },
                { header: 'Risco na entrada', alinhamento: 'right', render: (c) => formatarMoeda(dadosSaida.get(c.id)?.riscoNaEntrada ?? 0) },
                {
                  header: '% redução',
                  alinhamento: 'right',
                  render: (c) => {
                    const entrada = dadosSaida.get(c.id)?.riscoNaEntrada ?? 0
                    const atualv = c.snapshotAtual?.riscoCliente ?? 0
                    return formatarPercentual(entrada > 0 ? ((entrada - atualv) / entrada) * 100 : 0)
                  },
                },
                { header: 'Responsável', render: (c) => dadosSaida.get(c.id)?.responsavel ?? c.responsavel },
                { header: 'Checklist', render: (c) => <ResumoChecklistBadge clienteId={c.id} semanaRef={filtros.semanaRef ?? c.snapshotAtual?.semanaRef ?? null} /> },
              ]}
            />
          </Painel>
        </>
      )}

      {!carregando && aba === 'iasr' && indicadoresIasr && (
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
              <p className="py-6 text-center text-sm text-gray-400">Nenhum evento posterior registrado até o momento.</p>
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
