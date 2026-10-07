import { useEffect, useState } from 'react'
import { Painel } from '../components/ui/Card'
import type { Carteira, ConfiguracaoAlerta, Gerente, GrupoEconomico, Plataforma, RegraClassificacao } from '../models/types'
import { cadastrosRepository, configRepository } from '../repositories'
import { useSessao } from '../contexts/SessaoContext'
import { useFiltros } from '../contexts/FiltrosContext'
import { ErroApi } from '../api/cliente'

export default function CadastrosConfiguracoes() {
  const ehAdmin = useSessao().pode('admin')
  const [grupos, setGrupos] = useState<GrupoEconomico[]>([])
  const [gerentes, setGerentes] = useState<Gerente[]>([])
  const [plataformas, setPlataformas] = useState<Plataforma[]>([])
  const [configs, setConfigs] = useState<ConfiguracaoAlerta[]>([])
  const [regras, setRegras] = useState<RegraClassificacao[]>([])
  const [carteiras, setCarteiras] = useState<Carteira[]>([])
  const { recarregarDados } = useFiltros()
  const [erro, setErro] = useState<{ chave: string; texto: string } | null>(null)
  // Muda quando uma gravação falha: recria os campos com o valor do servidor.
  const [versaoCampos, setVersaoCampos] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)

  async function carregar() {
    const [g, ge, p, c, r, ca] = await Promise.all([
      cadastrosRepository.listarGrupos(),
      cadastrosRepository.listarGerentes(),
      cadastrosRepository.listarPlataformas(),
      configRepository.listarConfiguracoesAlerta(),
      configRepository.listarRegras(),
      cadastrosRepository.listarCarteiras(),
    ])
    setRegras(r)
    setCarteiras(ca)
    setGrupos(g)
    setGerentes(ge)
    setPlataformas(p)
    setConfigs(c)
    setCarregando(false)
  }

  useEffect(() => {
    carregar()
  }, [])

  /** Toda gravação passa por aqui: erro do servidor (ex.: limiar incoerente)
   * aparece na tela e o campo volta ao valor gravado — nada falha em silêncio. */
  async function gravar(chave: string, acao: () => Promise<void>, aplicar: () => void) {
    setSalvando(chave)
    setErro(null)
    try {
      await acao()
      aplicar()
    } catch (e) {
      setErro({ chave, texto: e instanceof ErroApi ? e.message : 'Não foi possível gravar a alteração.' })
      setVersaoCampos((v) => v + 1)
    } finally {
      setSalvando(null)
    }
  }

  const atualizarLimiar = (id: string, limiar: number) =>
    gravar(id, () => configRepository.atualizarConfiguracaoAlerta(id, { limiar }), () => setConfigs((atual) => atual.map((c) => (c.id === id ? { ...c, limiar } : c))))

  const alternarAtivo = (id: string, ativo: boolean) =>
    gravar(id, () => configRepository.atualizarConfiguracaoAlerta(id, { ativo }), () => setConfigs((atual) => atual.map((c) => (c.id === id ? { ...c, ativo } : c))))

  const atualizarRegra = (chave: string, valor: number) => {
    if (!Number.isFinite(valor) || valor < 0) {
      setErro({ chave, texto: 'Informe um número maior ou igual a zero.' })
      setVersaoCampos((v) => v + 1)
      return
    }
    return gravar(chave, () => configRepository.atualizarRegra(chave, valor), () => setRegras((atual) => atual.map((r) => (r.chave === chave ? { ...r, valor } : r))))
  }

  const alternarApartada = (id: string, apartada: boolean) =>
    gravar(
      id,
      () => cadastrosRepository.definirCarteiraApartada(id, apartada),
      () => {
        setCarteiras((atual) => atual.map((c) => (c.id === id ? { ...c, apartada } : c)))
        recarregarDados()
      },
    )

  const gruposRegra = [...new Set(regras.map((r) => r.grupo))]

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
                        key={`${c.id}-${c.limiar}-${versaoCampos}`}
                        aria-label={`Limiar: ${c.descricao}`}
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
                    <ErroCampo erro={erro} chave={c.id} />
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

      <Painel titulo="Regras da classificação semanal e avisos de qualidade da importação">
        <p className="mb-3 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
          Prioridade, enquadramento, criticidade e alertas de cada cliente são calculados na confirmação da importação com estes limiares
          (valores iniciais iguais às regras da base do comitê). Uma mudança vale para as próximas importações — classificações já gravadas
          não são refeitas.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {gruposRegra.map((grupo) => (
            <div key={grupo} className="border p-3" style={{ borderColor: 'var(--cor-borda)' }}>
              <p className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--cor-texto-secundario)' }}>
                {grupo}
              </p>
              <div className="flex flex-col gap-2">
                {regras
                  .filter((r) => r.grupo === grupo)
                  .map((r) => (
                    <label key={r.chave} className="flex flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <span className="min-w-0">{r.descricao}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <input
                          key={`${r.chave}-${r.valor}-${versaoCampos}`}
                          disabled={!ehAdmin}
                          type="number"
                          min={0}
                          step="any"
                          defaultValue={r.valor}
                          onBlur={(e) => Number(e.target.value) !== r.valor && atualizarRegra(r.chave, Number(e.target.value))}
                          className="w-32 rounded-md border px-2 py-1 text-right text-sm"
                          style={{ borderColor: 'var(--cor-borda)' }}
                        />
                        <span className="w-8 text-xs text-gray-500">{r.unidade}</span>
                        {salvando === r.chave && <span className="text-xs text-gray-400">salvando…</span>}
                      </span>
                      <ErroCampo erro={erro} chave={r.chave} />
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </Painel>

      <Painel titulo={`Carteiras (${carteiras.length})`}>
        <p className="mb-2 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
          Carteira apartada é acompanhada no sistema, mas fica fora do dashboard, da ata, da pauta e do painel da diretoria — a não ser que seja
          escolhida no filtro de carteira. Carteiras novas entram pela coluna “Carteira” da importação.
        </p>
        <ul className="text-sm">
          {carteiras.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-1.5 first:border-t-0" style={{ borderColor: 'var(--cor-borda)' }}>
              <span>{c.nome}</span>
              <label className="alvo-toque flex items-center gap-2 text-xs">
                <input type="checkbox" disabled={!ehAdmin} checked={c.apartada} onChange={(e) => alternarApartada(c.id, e.target.checked)} /> apartada
              </label>
              <ErroCampo erro={erro} chave={c.id} />
            </li>
          ))}
        </ul>
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

/** Erro de gravação junto do campo que falhou (anunciado a leitores de tela). */
function ErroCampo({ erro, chave }: { erro: { chave: string; texto: string } | null; chave: string }) {
  if (!erro || erro.chave !== chave) return null
  return (
    <p role="alert" className="mt-1 w-full basis-full text-xs font-medium" style={{ color: 'var(--cor-critico)' }}>
      {erro.texto}
    </p>
  )
}
