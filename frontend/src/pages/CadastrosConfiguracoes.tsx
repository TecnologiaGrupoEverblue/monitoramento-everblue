import { useEffect, useState } from 'react'
import { Painel } from '../components/ui/Card'
import type { ConfiguracaoAlerta, Gerente, GrupoEconomico, Plataforma } from '../models/types'
import { cadastrosRepository, configRepository } from '../repositories'
import { useSessao } from '../contexts/SessaoContext'

export default function CadastrosConfiguracoes() {
  const ehAdmin = useSessao().pode('admin')
  const [grupos, setGrupos] = useState<GrupoEconomico[]>([])
  const [gerentes, setGerentes] = useState<Gerente[]>([])
  const [plataformas, setPlataformas] = useState<Plataforma[]>([])
  const [configs, setConfigs] = useState<ConfiguracaoAlerta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)

  async function carregar() {
    const [g, ge, p, c] = await Promise.all([
      cadastrosRepository.listarGrupos(),
      cadastrosRepository.listarGerentes(),
      cadastrosRepository.listarPlataformas(),
      configRepository.listarConfiguracoesAlerta(),
    ])
    setGrupos(g)
    setGerentes(ge)
    setPlataformas(p)
    setConfigs(c)
    setCarregando(false)
  }

  useEffect(() => {
    carregar()
  }, [])

  async function atualizarLimiar(id: string, limiar: number) {
    setSalvando(id)
    await configRepository.atualizarConfiguracaoAlerta(id, { limiar })
    setConfigs((atual) => atual.map((c) => (c.id === id ? { ...c, limiar } : c)))
    setSalvando(null)
  }

  async function alternarAtivo(id: string, ativo: boolean) {
    await configRepository.atualizarConfiguracaoAlerta(id, { ativo })
    setConfigs((atual) => atual.map((c) => (c.id === id ? { ...c, ativo } : c)))
  }

  if (carregando) return <p className="text-sm text-gray-500">Carregando…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
          Cadastros e Configurações
        </h1>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Regras e limiares de alerta são configuráveis aqui — nunca fixos no código do sistema.
        </p>
      </div>

      <Painel titulo="Limiares de alerta">
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--cor-borda)' }}>
          <table className="w-full text-sm">
            <thead className="border-b text-[12.5px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
              <tr>
                <th className="px-3 py-2 text-left">Alerta</th>
                <th className="px-3 py-2 text-left">Limiar</th>
                <th className="px-3 py-2 text-left">Gravidade sugerida</th>
                <th className="px-3 py-2 text-left">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--cor-borda)' }}>
                  <td className="px-3 py-2">{c.descricao}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        disabled={!ehAdmin}
                        type="number"
                        defaultValue={c.limiar}
                        onBlur={(e) => atualizarLimiar(c.id, Number(e.target.value))}
                        className="w-24 rounded-md border px-2 py-1 text-sm"
                        style={{ borderColor: 'var(--cor-borda)' }}
                      />
                      <span className="text-xs text-gray-500">{c.unidade}</span>
                      {salvando === c.id && <span className="text-xs text-gray-400">salvando…</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold">{c.gravidadeSugerida}</td>
                  <td className="px-3 py-2">
                    <input type="checkbox" disabled={!ehAdmin} checked={c.ativo} onChange={(e) => alternarAtivo(c.id, e.target.checked)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Painel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Painel titulo={`Grupos econômicos (${grupos.length})`}>
          <ul className="max-h-64 overflow-y-auto text-sm">
            {grupos.map((g) => (
              <li key={g.id} className="border-t py-1.5 first:border-t-0" style={{ borderColor: 'var(--cor-borda)' }}>
                {g.nome}
              </li>
            ))}
          </ul>
        </Painel>
        <Painel titulo={`Gerentes (${gerentes.length})`}>
          <ul className="text-sm">
            {gerentes.map((g) => (
              <li key={g.id} className="border-t py-1.5 first:border-t-0" style={{ borderColor: 'var(--cor-borda)' }}>
                {g.nome}
              </li>
            ))}
          </ul>
        </Painel>
        <Painel titulo={`Plataformas comerciais (${plataformas.length})`}>
          <ul className="text-sm">
            {plataformas.map((p) => (
              <li key={p.id} className="border-t py-1.5 first:border-t-0" style={{ borderColor: 'var(--cor-borda)' }}>
                {p.nome}
              </li>
            ))}
          </ul>
        </Painel>
      </div>
    </div>
  )
}
