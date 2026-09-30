import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Painel } from '../components/ui/Card'
import { GravidadeBadge } from '../components/ui/Badges'
import { useFiltros } from '../contexts/FiltrosContext'
import type { Alerta, Cliente, EventoHistorico } from '../models/types'
import { alertaRepository, clienteRepository, eventoRepository } from '../repositories'
import { formatarDataHora, STATUS_LABEL } from '../utils/formatters'

type LinhaTempo = { tipo: 'evento' | 'alerta'; data: string; clienteId: string; descricao: string; gravidade?: string }

export default function Historico() {
  const { filtros, carregando: carregandoFiltros } = useFiltros()
  const navigate = useNavigate()
  const [eventos, setEventos] = useState<EventoHistorico[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [clientesPorId, setClientesPorId] = useState<Map<string, Cliente>>(new Map())
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (carregandoFiltros) return
    let ativo = true
    setCarregando(true)
    Promise.all([clienteRepository.listarEnriquecidos(filtros), eventoRepository.recentes(300), alertaRepository.listarTodos()]).then(([clientes, ev, al]) => {
      if (!ativo) return
      const ids = new Set(clientes.map((c) => c.id))
      setClientesPorId(new Map(clientes.map((c) => [c.id, c])))
      setEventos(ev.filter((e) => ids.has(e.clienteId)))
      setAlertas(al.filter((a) => ids.has(a.clienteId)))
      setCarregando(false)
    })
    return () => {
      ativo = false
    }
  }, [filtros, carregandoFiltros])

  const linhaDoTempo = useMemo<LinhaTempo[]>(() => {
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
    return [...doEventos, ...doAlertas].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 200)
  }, [eventos, alertas])

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
        {carregando ? (
          <p className="p-6 text-sm text-gray-500">Carregando…</p>
        ) : linhaDoTempo.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">Nenhum evento para este recorte.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--cor-borda)' }}>
            {linhaDoTempo.map((item, i) => (
              <li
                key={i}
                className="flex cursor-pointer items-start gap-3 py-2.5 hover:bg-[var(--cor-fundo-recuado)]"
                onClick={() => navigate(`/clientes/${item.clienteId}`)}
              >
                <span className="mt-0.5 w-36 shrink-0 text-xs text-gray-500">{formatarDataHora(item.data)}</span>
                {item.gravidade && <GravidadeBadge gravidade={item.gravidade} />}
                <span className="text-sm">
                  <strong style={{ color: 'var(--cor-primaria)' }}>{clientesPorId.get(item.clienteId)?.nome ?? '—'}</strong> — {item.descricao}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Painel>
    </div>
  )
}
