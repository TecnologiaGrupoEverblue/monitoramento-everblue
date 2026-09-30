import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import BotaoModoRevisao from '../components/BotaoModoRevisao'
import ClientesTabela from '../components/ClientesTabela'
import ResumoChecklistBadge from '../components/ResumoChecklistBadge'
import { KpiCard, Painel } from '../components/ui/Card'
import { useFiltros } from '../contexts/FiltrosContext'
import type { ClienteEnriquecido, Juridico as JuridicoTipo } from '../models/types'
import { clienteRepository, juridicoRepository } from '../repositories'
import { formatarData, formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '../utils/formatters'

export default function Juridico() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const [clientes, setClientes] = useState<ClienteEnriquecido[]>([])
  const [dadosJuridico, setDadosJuridico] = useState<Map<string, JuridicoTipo>>(new Map())
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(() => {
    setCarregando(true)
    return Promise.all([clienteRepository.listarEnriquecidos({ ...filtros, status: 'JURIDICO' }), juridicoRepository.listarTodos()]).then(([lista, juridico]) => {
      setClientes(lista)
      setDadosJuridico(new Map(juridico.map((j) => [j.clienteId, j])))
      setCarregando(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros])

  useEffect(() => {
    if (carregandoFiltros) return
    carregar()
  }, [carregandoFiltros, carregar])

  const riscoEnviado = clientes.reduce((s, c) => s + (c.snapshotAtual?.vencidoOficial ?? 0), 0)
  const valorRecuperado = clientes.reduce((s, c) => s + (dadosJuridico.get(c.id)?.valorRecuperado ?? 0), 0)
  const saldo = clientes.reduce((s, c) => s + (dadosJuridico.get(c.id)?.saldo ?? 0), 0)
  const percRecuperado = riscoEnviado > 0 ? (valorRecuperado / riscoEnviado) * 100 : 0

  const dadosGrafico = clientes.map((c) => ({
    nome: c.nome.split(' ').slice(0, 2).join(' '),
    'Enviado ao jurídico': dadosJuridico.get(c.id)?.saldo ?? 0,
    'Valor recuperado': dadosJuridico.get(c.id)?.valorRecuperado ?? 0,
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            Jurídico
          </h1>
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            {clientes.length} cliente(s) em cobrança judicial/extrajudicial
          </p>
        </div>
        <BotaoModoRevisao clientes={clientes} statusAtual="JURIDICO" aoConcluir={carregar} />
      </div>

      {carregando ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard titulo="Vencido enviado ao jurídico" valor={formatarMoeda(riscoEnviado)} formatoVariacao="numero" destaque="critico" />
            <KpiCard titulo="Valor recuperado" valor={formatarMoeda(valorRecuperado)} formatoVariacao="numero" destaque="normal" />
            <KpiCard titulo="Saldo em aberto" valor={formatarMoeda(saldo)} formatoVariacao="numero" destaque="critico" />
            <KpiCard titulo="% recuperado" valor={formatarPercentual(percRecuperado)} formatoVariacao="numero" />
          </div>

          <Painel titulo="Recuperação: risco enviado ao jurídico x valor recuperado">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dadosGrafico} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cor-grade)" />
                <XAxis dataKey="nome" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis tickFormatter={(v) => formatarMoedaCompacta(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatarMoedaCompacta(Number(v))} />
                <Legend />
                <Bar dataKey="Enviado ao jurídico" fill="var(--cor-critico)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Valor recuperado" fill="var(--cor-normal)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Painel>

          <Painel>
            <ClientesTabela
              clientes={clientes}
              mostrarStatus={false}
              colunasExtras={[
                { header: 'Envio ao jurídico', render: (c) => formatarData(dadosJuridico.get(c.id)?.dataEnvio) },
                { header: 'Motivo', render: (c) => <span className="text-xs">{dadosJuridico.get(c.id)?.motivo}</span> },
                { header: 'Medida adotada', render: (c) => <span className="text-xs">{dadosJuridico.get(c.id)?.medidaAdotada}</span> },
                { header: 'Responsável jurídico', render: (c) => dadosJuridico.get(c.id)?.responsavelJuridico },
                { header: 'Recuperado', alinhamento: 'right', render: (c) => formatarMoeda(dadosJuridico.get(c.id)?.valorRecuperado ?? 0) },
                { header: 'Saldo', alinhamento: 'right', render: (c) => formatarMoeda(dadosJuridico.get(c.id)?.saldo ?? 0) },
                { header: 'Próximo passo', render: (c) => <span className="text-xs">{dadosJuridico.get(c.id)?.proximoPasso}</span> },
                { header: 'Prazo', render: (c) => formatarData(dadosJuridico.get(c.id)?.prazo) },
                { header: 'Checklist', render: (c) => <ResumoChecklistBadge clienteId={c.id} semanaRef={filtros.semanaRef ?? c.snapshotAtual?.semanaRef ?? null} /> },
              ]}
            />
          </Painel>
        </>
      )}
    </div>
  )
}
