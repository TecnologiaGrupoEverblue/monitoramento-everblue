import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { esquemaValorRegra } from '@monitoramento/dominio'
import { Painel } from '../components/ui/Card'
import { TabelaResponsiva } from '../components/ui/TabelaResponsiva'
import { Carregando, ErroCarga } from '../components/ui/EstadoCarga'
import { cadastrosRepository, configRepository } from '../repositories'
import { consultas, invalidar } from '../consultas'
import { useSessao } from '../contexts/SessaoContext'
import { ErroApi } from '../api/cliente'

/** Mesmo limite numérico que a API aplica (dominio/esquemas). */
const esquemaNumeroCampo = z.object({ valor: z.coerce.number({ message: 'Informe um número.' }).pipe(esquemaValorRegra.shape.valor) })
type CampoNumero = z.input<typeof esquemaNumeroCampo>

/** Campo numérico que grava ao sair (onBlur), validado pelo esquema
 * compartilhado; erro do servidor aparece no campo e o valor volta ao gravado. */
function CampoNumericoGravado({
  valor,
  rotulo,
  desabilitado,
  className,
  aoGravar,
}: {
  valor: number
  rotulo: string
  desabilitado: boolean
  className: string
  aoGravar: (n: number) => Promise<void>
}) {
  const [erroServidor, setErroServidor] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const { register, handleSubmit, formState, reset } = useForm<CampoNumero>({ resolver: zodResolver(esquemaNumeroCampo), values: { valor } })
  const enviar = handleSubmit(async ({ valor: novo }) => {
    const n = Number(novo)
    if (n === valor) return
    setSalvando(true)
    setErroServidor(null)
    try {
      await aoGravar(n)
    } catch (e) {
      setErroServidor(e instanceof ErroApi ? e.message : 'Não foi possível gravar a alteração.')
      reset({ valor })
    } finally {
      setSalvando(false)
    }
  })
  const erro = formState.errors.valor?.message ?? erroServidor
  return (
    <>
      <input
        aria-label={rotulo}
        aria-invalid={Boolean(erro)}
        disabled={desabilitado}
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        {...register('valor', { onBlur: () => void enviar() })}
        className={className}
        style={{ borderColor: 'var(--cor-borda)' }}
      />
      {salvando && <span className="text-xs text-[color:var(--cor-texto-secundario)]">salvando…</span>}
      {erro && (
        <p role="alert" className="mt-1 w-full basis-full text-xs font-medium" style={{ color: 'var(--cor-critico)' }}>
          {erro}
        </p>
      )}
    </>
  )
}

export default function CadastrosConfiguracoes() {
  const ehAdmin = useSessao().pode('admin')
  const clienteConsultas = useQueryClient()
  const qGrupos = useQuery(consultas.grupos())
  const qGerentes = useQuery(consultas.gerentes())
  const qPlataformas = useQuery(consultas.plataformas())
  const qConfigs = useQuery(consultas.configuracoesAlerta())
  const qRegras = useQuery(consultas.regras())
  const qCarteiras = useQuery(consultas.carteiras())
  const todas = [qGrupos, qGerentes, qPlataformas, qConfigs, qRegras, qCarteiras]
  const grupos = qGrupos.data ?? []
  const gerentes = qGerentes.data ?? []
  const plataformas = qPlataformas.data ?? []
  const configs = qConfigs.data ?? []
  const regras = qRegras.data ?? []
  const carteiras = qCarteiras.data ?? []
  const [erro, setErro] = useState<{ chave: string; texto: string } | null>(null)

  /** Liga/desliga (checkbox): erro do servidor aparece junto do item. */
  const alternar = useMutation({
    mutationFn: async (p: { chave: string; acao: () => Promise<void>; grupos: ('config' | 'carteira')[] }) => {
      await p.acao()
      return p
    },
    onMutate: () => setErro(null),
    onSuccess: (p) => invalidar(clienteConsultas, ...p.grupos),
    onError: (e, p) => setErro({ chave: p.chave, texto: e instanceof ErroApi ? e.message : 'Não foi possível gravar a alteração.' }),
  })
  const alternarAtivo = (id: string, ativo: boolean) => alternar.mutate({ chave: id, acao: () => configRepository.atualizarConfiguracaoAlerta(id, { ativo }), grupos: ['config'] })
  const alternarApartada = (id: string, apartada: boolean) =>
    alternar.mutate({ chave: id, acao: () => cadastrosRepository.definirCarteiraApartada(id, apartada), grupos: ['config', 'carteira'] })
  const gravarLimiar = async (id: string, limiar: number) => {
    await configRepository.atualizarConfiguracaoAlerta(id, { limiar })
    await invalidar(clienteConsultas, 'config')
  }
  const gravarRegra = async (chave: string, valor: number) => {
    await configRepository.atualizarRegra(chave, valor)
    await invalidar(clienteConsultas, 'config')
  }

  const gruposRegra = [...new Set(regras.map((r) => r.grupo))]

  const erroCarga = todas.find((q) => q.error)?.error
  if (erroCarga) return <ErroCarga erro={erroCarga} aoTentarDeNovo={() => void Promise.all(todas.map((q) => q.refetch()))} />
  if (todas.some((q) => q.isPending)) return <Carregando />

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
          Parâmetros
        </h1>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Regras e limiares de alerta são configuráveis aqui — nunca fixos no código do sistema.
        </p>
      </div>


      <Painel titulo="Limiares de alerta">
          <TabelaResponsiva<(typeof configs)[number]>
            rotulo="Limiares de alerta"
            linhas={configs}
            chave={(c) => c.id}
            colunas={[
              { chave: 'alerta', titulo: 'Alerta', principal: true, classe: 'min-w-[180px]', render: (c) => c.descricao },
              {
                chave: 'limiar',
                titulo: 'Limiar',
                render: (c) => (
                  <>
                    <span className="flex items-center gap-1">
                      <CampoNumericoGravado
                        valor={c.limiar}
                        rotulo={`Limiar: ${c.descricao}`}
                        desabilitado={!ehAdmin}
                        className="w-24 rounded-md border px-2 py-1 text-sm"
                        aoGravar={(n) => gravarLimiar(c.id, n)}
                      />
                      <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                        {c.unidade}
                      </span>
                    </span>
                    <ErroCampo erro={erro} chave={c.id} />
                  </>
                ),
              },
              { chave: 'gravidade', titulo: 'Gravidade sugerida', classe: 'text-xs font-semibold', render: (c) => c.gravidadeSugerida },
              {
                chave: 'ativo',
                titulo: 'Ativo',
                render: (c) => (
                  <label className="inline-flex min-h-[40px] items-center gap-2 text-xs">
                    <input type="checkbox" className="h-4 w-4" disabled={!ehAdmin} checked={c.ativo} onChange={(e) => alternarAtivo(c.id, e.target.checked)} aria-label={`Ativo: ${c.descricao}`} />
                    <span className="md:sr-only">{c.ativo ? 'Ligado' : 'Desligado'}</span>
                  </label>
                ),
              },
            ]}
          />
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
                        <CampoNumericoGravado
                          valor={r.valor}
                          rotulo={r.descricao}
                          desabilitado={!ehAdmin}
                          className="w-32 rounded-md border px-2 py-1 text-right text-sm"
                          aoGravar={(n) => gravarRegra(r.chave, n)}
                        />
                        <span className="w-8 text-xs text-[color:var(--cor-texto-secundario)]">{r.unidade}</span>
                      </span>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
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
