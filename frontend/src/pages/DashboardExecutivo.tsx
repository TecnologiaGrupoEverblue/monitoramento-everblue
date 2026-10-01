import { useEffect, useState } from 'react'
import GraficoBarrasDimensao, { type ItemDimensao } from '../components/charts/GraficoBarrasDimensao'
import GraficoEntradasSaidas from '../components/charts/GraficoEntradasSaidas'
import GraficoLinhaSerie from '../components/charts/GraficoLinhaSerie'
import GraficoPizza from '../components/charts/GraficoPizza'
import { KpiCard, NumeroHero, Painel } from '../components/ui/Card'
import { useDrillDown } from '../contexts/DrillDownContext'
import { useFiltros } from '../contexts/FiltrosContext'
import { criticidadeCor } from '../theme/colors'
import { dashboardRepository, type KPIsDashboard } from '../repositories'
import { formatarData, formatarMoeda, formatarPercentual, formatarVariacao } from '../utils/formatters'

type Dimensao = 'status' | 'gerenteId' | 'plataformaId' | 'setor' | 'grupoEconomicoId' | 'produto'

export default function DashboardExecutivo() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const { abrir } = useDrillDown()

  const [kpis, setKpis] = useState<KPIsDashboard | null>(null)
  const [serieRisco, setSerieRisco] = useState<{ semana: string; risco: number; vencido: number }[]>([])
  const [porStatus, setPorStatus] = useState<ItemDimensao[]>([])
  const [porGerente, setPorGerente] = useState<ItemDimensao[]>([])
  const [porPlataforma, setPorPlataforma] = useState<ItemDimensao[]>([])
  const [porProduto, setPorProduto] = useState<ItemDimensao[]>([])
  const [porSetor, setPorSetor] = useState<ItemDimensao[]>([])
  const [porGrupo, setPorGrupo] = useState<ItemDimensao[]>([])
  const [porCriticidade, setPorCriticidade] = useState<{ criticidade: string; qtd: number; clienteIds: string[] }[]>([])
  const [entradasSaidas, setEntradasSaidas] = useState<{ semana: string; entradas: number; saidas: number }[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (carregandoFiltros) return
    let ativo = true
    setCarregando(true)
    Promise.all([
      dashboardRepository.obterKPIs(filtros),
      dashboardRepository.serieEvolucaoSemanal(filtros),
      dashboardRepository.riscoPorDimensao(filtros, 'status'),
      dashboardRepository.riscoPorDimensao(filtros, 'gerenteId'),
      dashboardRepository.riscoPorDimensao(filtros, 'plataformaId'),
      dashboardRepository.riscoPorDimensao(filtros, 'produto'),
      dashboardRepository.riscoPorDimensao(filtros, 'setor'),
      dashboardRepository.riscoPorDimensao(filtros, 'grupoEconomicoId'),
      dashboardRepository.clientesPorCriticidade(filtros),
      dashboardRepository.evolucaoEntradasSaidasMonitoramento(filtros),
    ]).then(([k, serie, status, gerente, plataforma, produto, setor, grupo, criticidade, entSai]) => {
      if (!ativo) return
      setKpis(k)
      setSerieRisco(serie)
      setPorStatus(status)
      setPorGerente(gerente)
      setPorPlataforma(plataforma)
      setPorProduto(produto)
      setPorSetor(setor)
      setPorGrupo(grupo)
      setPorCriticidade(criticidade)
      setEntradasSaidas(entSai)
      setCarregando(false)
    })
    return () => {
      ativo = false
    }
  }, [filtros, carregandoFiltros])

  function abrirPorDimensao(dimensao: Dimensao) {
    return (item: ItemDimensao) => abrir(`${rotuloDimensao(dimensao)}: ${item.label}`, item.clienteIds)
  }

  async function abrirSemana(semana: string) {
    const todos = await dashboardRepository.riscoPorDimensao({ ...filtros, semanaRef: semana }, 'status')
    const ids = Array.from(new Set(todos.flatMap((i) => i.clienteIds)))
    abrir(`Posição de ${formatarData(semana)}`, ids)
  }

  if (carregando || !kpis) {
    return <p className="text-sm text-gray-500">Carregando dashboard…</p>
  }

  const { atual, anterior } = kpis

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
          Dashboard Executivo
        </h1>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Posição em {formatarData(kpis.semanaRef)} · comparado a {formatarData(kpis.semanaAnterior)}
          {kpis.semanaMesAnterior && ` e a ${formatarData(kpis.semanaMesAnterior)} (mês anterior)`}
        </p>
      </div>

      <div className="fundo-glow p-5">
        <NumeroHero
          titulo="Risco total EverBlue"
          valor={formatarMoeda(atual.risco)}
          variacao={formatarVariacao(atual.risco, anterior.risco)}
          contexto="vs. semana anterior"
          onClick={() => abrir('Risco total EverBlue', porStatus.flatMap((s) => s.clienteIds))}
          escuro
        />
      </div>
      <div className="border bg-[var(--cor-superficie-solida)] p-5" style={{ borderColor: 'var(--cor-borda)' }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <KpiCard titulo="Vencido oficial" valor={formatarMoeda(atual.vencido)} valorAnterior={{ atual: atual.vencido, anterior: anterior.vencido }} destaque="critico" />
          <KpiCard titulo="% Vencido" valor={formatarPercentual(atual.percVencido)} formatoVariacao="percentual" destaque="critico" />
          <KpiCard titulo="Clientes/unidades expostas" valor={String(atual.qtdClientes)} formatoVariacao="numero" />
          <KpiCard
            titulo="Risco em Monitoramento"
            valor={formatarMoeda(atual.riscoMonitoramento)}
            valorAnterior={{ atual: atual.riscoMonitoramento, anterior: anterior.riscoMonitoramento }}
            destaque="atencao"
            onClick={() => abrir('Risco em Monitoramento', porStatus.find((s) => s.chave === 'MONITORAMENTO')?.clienteIds ?? [])}
          />
          <KpiCard
            titulo="Risco em Saída de Risco"
            valor={formatarMoeda(atual.riscoSaidaDeRisco)}
            valorAnterior={{ atual: atual.riscoSaidaDeRisco, anterior: anterior.riscoSaidaDeRisco }}
            onClick={() => abrir('Risco em Saída de Risco', porStatus.find((s) => s.chave === 'SAIDA_DE_RISCO')?.clienteIds ?? [])}
          />
          <KpiCard
            titulo="Risco no Jurídico"
            valor={formatarMoeda(atual.riscoJuridico)}
            valorAnterior={{ atual: atual.riscoJuridico, anterior: anterior.riscoJuridico }}
            destaque="critico"
            onClick={() => abrir('Risco no Jurídico', porStatus.find((s) => s.chave === 'JURIDICO')?.clienteIds ?? [])}
          />
          <KpiCard
            titulo="Clientes críticos"
            valor={String(atual.qtdCriticos)}
            formatoVariacao="numero"
            destaque="critico"
            onClick={() => abrir('Clientes críticos', porCriticidade.find((c) => c.criticidade === 'CRITICA')?.clienteIds ?? [])}
          />
          <KpiCard
            titulo="Clientes em atenção"
            valor={String(atual.qtdAtencao)}
            formatoVariacao="numero"
            destaque="atencao"
            onClick={() => abrir('Clientes em atenção', porCriticidade.find((c) => c.criticidade === 'ATENCAO')?.clienteIds ?? [])}
          />
          <KpiCard titulo="Risco crítico" valor={formatarMoeda(atual.riscoCritico)} valorAnterior={{ atual: atual.riscoCritico, anterior: anterior.riscoCritico }} destaque="critico" />
          <KpiCard titulo="Risco em atenção" valor={formatarMoeda(atual.riscoAtencao)} valorAnterior={{ atual: atual.riscoAtencao, anterior: anterior.riscoAtencao }} destaque="atencao" />
          <KpiCard titulo="Limite global" valor={formatarMoeda(atual.limiteGlobal)} formatoVariacao="numero" />
          <KpiCard titulo="Limite consumido" valor={formatarPercentual(atual.percLimiteConsumido)} formatoVariacao="numero" destaque={atual.percLimiteConsumido >= 90 ? 'critico' : 'normal'} />
          <KpiCard titulo="Tranche consumida" valor={formatarPercentual(atual.percTrancheConsumida)} formatoVariacao="numero" destaque={atual.percTrancheConsumida >= 90 ? 'critico' : 'normal'} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Painel titulo="Evolução semanal do risco — clique num ponto para ver os clientes">
          <GraficoLinhaSerie dados={serieRisco} chaveValor="risco" cor="var(--cor-primaria)" onClickPonto={abrirSemana} />
        </Painel>
        <Painel titulo="Evolução do vencido">
          <GraficoLinhaSerie dados={serieRisco} chaveValor="vencido" cor="var(--cor-critico)" onClickPonto={abrirSemana} />
        </Painel>

        <Painel titulo="Risco por status">
          <GraficoBarrasDimensao dados={porStatus} onClickBarra={abrirPorDimensao('status')} />
        </Painel>
        <Painel titulo="Clientes por criticidade">
          <GraficoPizza
            dados={porCriticidade.map((c) => ({ chave: c.criticidade, label: c.criticidade === 'NORMAL' ? 'Normal' : c.criticidade === 'ATENCAO' ? 'Atenção' : 'Crítica', valor: c.qtd }))}
            cores={{ NORMAL: criticidadeCor.NORMAL.texto, ATENCAO: criticidadeCor.ATENCAO.texto, CRITICA: criticidadeCor.CRITICA.texto }}
            onClickFatia={(chave) => abrir('Clientes por criticidade', porCriticidade.find((c) => c.criticidade === chave)?.clienteIds ?? [])}
          />
        </Painel>

        <Painel titulo="Risco por gerente">
          <GraficoBarrasDimensao dados={porGerente} onClickBarra={abrirPorDimensao('gerenteId')} />
        </Painel>
        <Painel titulo="Risco por plataforma comercial">
          <GraficoBarrasDimensao dados={porPlataforma} onClickBarra={abrirPorDimensao('plataformaId')} />
        </Painel>

        <Painel titulo="Risco por produto">
          <GraficoBarrasDimensao dados={porProduto} onClickBarra={abrirPorDimensao('produto')} />
        </Painel>
        <Painel titulo="Risco por setor">
          <GraficoBarrasDimensao dados={porSetor} onClickBarra={abrirPorDimensao('setor')} />
        </Painel>

        <Painel titulo="Risco por grupo econômico (top 10)" className="lg:col-span-2">
          <GraficoBarrasDimensao dados={porGrupo} onClickBarra={abrirPorDimensao('grupoEconomicoId')} limite={10} />
        </Painel>

        <Painel titulo="Evolução de entradas e saídas de Monitoramento" className="lg:col-span-2">
          <GraficoEntradasSaidas dados={entradasSaidas} />
        </Painel>
      </div>
    </div>
  )
}

function rotuloDimensao(d: Dimensao): string {
  const labels: Record<Dimensao, string> = {
    status: 'Status',
    gerenteId: 'Gerente',
    plataformaId: 'Plataforma',
    setor: 'Setor',
    grupoEconomicoId: 'Grupo econômico',
    produto: 'Produto',
  }
  return labels[d]
}
