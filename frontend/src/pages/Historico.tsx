import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Painel } from '../components/ui/Card'
import { GravidadeBadge } from '../components/ui/Badges'
import { useFiltros } from '../contexts/FiltrosContext'
import { Carregando, ErroCarga } from '../components/ui/EstadoCarga'
import { consultas } from '../consultas'
import { formatarDataHora, STATUS_LABEL } from '../utils/formatters'
import { formatarDocumento } from '@monitoramento/dominio'

type LinhaTempo = { tipo: 'evento' | 'alerta'; data: string; clienteId: string; descricao: string; gravidade?: string }

export default function Historico() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const navigate = useNavigate()
  const qClientes = useQuery({ ...consultas.clientesEnriquecidos(filtros), enabled: !carregandoFiltros })
  const qEventos = useQuery(consultas.eventosRecentes(300))
  const qAlertas = useQuery(consultas.alertas())
  const clientesPorId = useMemo(() => new Map((qClientes.data ?? []).map((c) => [c.id, c])), [qClientes.data])
  const eventos = useMemo(() => (qEventos.data ?? []).filter((e) => clientesPorId.has(e.clienteId)), [qEventos.data, clientesPorId])
  const alertas = useMemo(() => (qAlertas.data ?? []).filter((a) => clientesPorId.has(a.clienteId)), [qAlertas.data, clientesPorId])
  const carregando = qClientes.isPending || qEventos.isPending || qAlertas.isPending
  const erro = qClientes.error ?? qEventos.error ?? qAlertas.error

  const [tipo, setTipo] = useState<'todos' | 'evento' | 'alerta'>('todos')
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(50)

  const todasAsLinhas = useMemo<LinhaTempo[]>(() => {
    const doEventos: LinhaTempo[] = eventos.map((e) => ({
      tipo: 'evento',
      data: e.data,
      clienteId: e.clienteId,
      descricao:
        e.tipo === 'MUDANCA_STATUS'
          ? `Status alterado de ${STATUS_LABEL[e.valorAnterior ?? ''] ?? e.valorAnterior} para ${STATUS_LABEL[e.valorNovo ?? ''] ?? e.valorNovo} — ${e.justificativa}`
          : e.justificativa,
    }))
    const doAlertas: LinhaTempo[] = alertas.map((a) => ({ tipo: 'alerta', data: a.data, clienteId: a.clienteId, descricao: `${a.tipo}: ${a.descricao}`, gravidade: a.gravidade }))
    return [...doEventos, ...doAlertas].sort((a, b) => b.data.localeCompare(a.data))
  }, [eventos, alertas])
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return todasAsLinhas.filter(
      (l) => (tipo === 'todos' || l.tipo === tipo) && (!termo || (clientesPorId.get(l.clienteId)?.nome ?? '').toLowerCase().includes(termo) || l.descricao.toLowerCase().includes(termo)),
    )
  }, [todasAsLinhas, tipo, busca, clientesPorId])
  const linhaDoTempo = filtradas.slice(0, limite)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
          Histórico
        </h1>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Linha do tempo de eventos e alertas — nada aqui é apagado ou sobrescrito, apenas acumulado.
        </p>
      </div>

      <Painel>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-1" role="group" aria-label="Tipo">
            {(
              [
                ['todos', 'Tudo'],
                ['evento', 'Eventos'],
                ['alerta', 'Alertas'],
              ] as const
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                aria-pressed={tipo === v}
                onClick={() => {
                  setTipo(v)
                  setLimite(50)
                }}
                className={`${tipo === v ? 'botao-primario' : 'botao-secundario'} min-h-[40px] px-3 text-xs`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            className="campo min-w-0 sm:ml-auto sm:max-w-xs"
            placeholder="Buscar cliente ou texto"
            aria-label="Buscar no histórico"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value)
              setLimite(50)
            }}
          />
        </div>
        {erro ? (
          <ErroCarga erro={erro} aoTentarDeNovo={() => void Promise.all([qClientes.refetch(), qEventos.refetch(), qAlertas.refetch()])} />
        ) : carregando ? (
          <Carregando />
        ) : linhaDoTempo.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            Nenhum evento para este recorte.
          </p>
        ) : (
          <>
            <ul className="divide-y" style={{ borderColor: 'var(--cor-borda)' }}>
              {linhaDoTempo.map((item, i) => (
                <li key={`${item.data}-${i}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 py-2.5 text-left hover:bg-[var(--cor-fundo-recuado)] sm:flex-row sm:items-start sm:gap-3"
                    onClick={() => navigate(`/clientes/${item.clienteId}`)}
                  >
                    <span className="flex shrink-0 items-center gap-2 sm:w-52">
                      <span className="numeros-tabulares text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                        {formatarDataHora(item.data)}
                      </span>
                      {item.gravidade ? <GravidadeBadge gravidade={item.gravidade} /> : <span className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>Evento</span>}
                    </span>
                    <span className="min-w-0 text-sm break-words">
                      <strong style={{ color: 'var(--cor-primaria)' }}>{clientesPorId.get(item.clienteId)?.nome ?? '—'}</strong>
                      <span className="numeros-tabulares ml-1 text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                        {formatarDocumento(clientesPorId.get(item.clienteId)?.cnpj)}
                      </span>{' '}
                      — {item.descricao}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
              <span>
                {linhaDoTempo.length} de {filtradas.length}
              </span>
              {filtradas.length > linhaDoTempo.length && (
                <button type="button" className="botao-secundario min-h-[40px] px-3 text-xs" onClick={() => setLimite((l) => l + 50)}>
                  Mostrar mais 50
                </button>
              )}
            </div>
          </>
        )}
      </Painel>
    </div>
  )
}
