import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, Search, Upload } from 'lucide-react'
import {
  FINALIDADES_ARQUIVO,
  SITUACOES_ARQUIVO,
  formatarBytes,
  type ArquivoResumo,
  type FiltroArquivos,
  type FinalidadeArquivo,
  type PaginaArquivos,
  type SituacaoArquivo,
  type TotaisArquivos,
} from '@monitoramento/dominio'
import { DetalheArquivo } from '../components/arquivos/DetalheArquivo'
import { EnvioArquivo } from '../components/arquivos/EnvioArquivo'
import { COR_SITUACAO, ROTULO_FINALIDADE, ROTULO_SITUACAO } from '../components/arquivos/rotulos'
import { useSessao } from '../contexts/SessaoContext'
import { arquivoRepository } from '../repositories'

const POR_PAGINA = 25
const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

function Situacao({ s }: { s: SituacaoArquivo }) {
  const cor = COR_SITUACAO[s]
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: cor.texto, background: cor.fundo }}>
      {ROTULO_SITUACAO[s]}
    </span>
  )
}

/**
 * Central de Arquivos — todo arquivo que entrou ou saiu do Monitoramento
 * (importados, processados, exportados e anexos), com o ciclo de vida completo.
 */
export default function CentralArquivos() {
  const { pode } = useSessao()
  const [filtro, setFiltro] = useState<FiltroArquivos>({ pagina: 1, porPagina: POR_PAGINA })
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState<PaginaArquivos | null>(null)
  const [totais, setTotais] = useState<TotaisArquivos | null>(null)
  const [categorias, setCategorias] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)

  const recarregar = useCallback(() => {
    setErro(null)
    Promise.all([arquivoRepository.listar(filtro), arquivoRepository.totais(), arquivoRepository.categorias()])
      .then(([p, t, c]) => {
        setPagina(p)
        setTotais(t)
        setCategorias(c)
      })
      .catch(() => setErro('Não foi possível carregar os arquivos.'))
  }, [filtro])

  useEffect(recarregar, [recarregar])

  // Busca com pequena espera: não dispara a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setFiltro((f) => (f.busca === (busca.trim() || undefined) ? f : { ...f, busca: busca.trim() || undefined, pagina: 1 })), 350)
    return () => clearTimeout(t)
  }, [busca])

  const mudar = (parcial: Partial<FiltroArquivos>) => setFiltro((f) => ({ ...f, ...parcial, pagina: 1 }))
  const totalPaginas = pagina ? Math.max(1, Math.ceil(pagina.total / pagina.porPagina)) : 1

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
            Central de Arquivos
          </h1>
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            Todos os arquivos importados, processados, exportados e anexos — com versões, trilha e ciclo de vida completo.
          </p>
        </div>
        {pode('analista') && (
          <button type="button" className="botao-primario min-h-11 self-start sm:self-auto" onClick={() => setEnviando(true)}>
            <Upload className="h-4 w-4" /> Enviar arquivo
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FINALIDADES_ARQUIVO.map((f) => {
          const t = totais?.porFinalidade[f]
          const ativo = filtro.finalidade === f
          return (
            <button
              key={f}
              type="button"
              aria-pressed={ativo}
              onClick={() => mudar({ finalidade: ativo ? undefined : f })}
              className="cartao-vidro min-h-11 p-3 text-left transition-colors hover:bg-white/5"
              style={ativo ? { borderColor: 'var(--cor-acao)' } : undefined}
            >
              <p className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                {ROTULO_FINALIDADE[f]}s
              </p>
              <p className="numeros-tabulares text-xl font-semibold">{t ? t.quantidade.toLocaleString('pt-BR') : '—'}</p>
              <p className="text-xs" style={{ color: 'var(--cor-texto-terciario)' }}>
                {t ? formatarBytes(t.bytes) : ''}
              </p>
            </button>
          )
        })}
      </div>

      <div className="cartao-vidro grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative flex flex-col gap-1 text-xs sm:col-span-2 lg:col-span-1">
          <span style={{ color: 'var(--cor-texto-secundario)' }}>Buscar</span>
          <Search className="pointer-events-none absolute bottom-3 left-2.5 h-4 w-4" style={{ color: 'var(--cor-texto-terciario)' }} />
          <input type="search" className="min-h-11 !pl-8" placeholder="Nome ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--cor-texto-secundario)' }}>Finalidade</span>
          <select className="min-h-11" value={filtro.finalidade ?? ''} onChange={(e) => mudar({ finalidade: (e.target.value || undefined) as FinalidadeArquivo | undefined })}>
            <option value="">Todas</option>
            {FINALIDADES_ARQUIVO.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FINALIDADE[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--cor-texto-secundario)' }}>Situação</span>
          <select className="min-h-11" value={filtro.situacao ?? ''} onChange={(e) => mudar({ situacao: (e.target.value || undefined) as SituacaoArquivo | undefined })}>
            <option value="">Em uso (ativos e arquivados)</option>
            {SITUACOES_ARQUIVO.map((s) => (
              <option key={s} value={s}>
                {ROTULO_SITUACAO[s]}
                {totais ? ` (${totais.porSituacao[s]})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--cor-texto-secundario)' }}>Categoria</span>
          <select className="min-h-11" value={filtro.categoria ?? ''} onChange={(e) => mudar({ categoria: e.target.value || undefined })}>
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {erro && (
        <p role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ color: 'var(--cor-critico)', background: 'var(--cor-critico-fundo)' }}>
          {erro}
        </p>
      )}

      {!pagina ? (
        <p className="py-10 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }} role="status">
          Carregando…
        </p>
      ) : pagina.itens.length === 0 ? (
        <div className="cartao-vidro flex flex-col items-center gap-2 py-12 text-center">
          <FileText className="h-8 w-8" style={{ color: 'var(--cor-texto-terciario)' }} />
          <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            Nenhum arquivo encontrado com estes filtros.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop e tablet largo: tabela. */}
          <div className="cartao-vidro hidden overflow-hidden md:block">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                  <th className="w-[38%] px-3 py-2 font-medium">Arquivo</th>
                  <th className="px-3 py-2 font-medium">Finalidade</th>
                  <th className="hidden px-3 py-2 font-medium lg:table-cell">Categoria</th>
                  <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                  <th className="hidden px-3 py-2 font-medium lg:table-cell">Enviado</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pagina.itens.map((a) => (
                  <Linha key={a.id} arquivo={a} aoAbrir={() => setAberto(a.id)} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular e tablet estreito: cartões. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {pagina.itens.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setAberto(a.id)} className="cartao-vidro flex w-full flex-col gap-1 p-3 text-left">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-all font-medium">{a.nomeOriginal}</span>
                    <Situacao s={a.situacao} />
                  </span>
                  <span className="text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                    {ROTULO_FINALIDADE[a.finalidade]} · {a.categoria} · v{a.versaoAtual} · {formatarBytes(a.tamanhoBytes)}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--cor-texto-terciario)' }}>
                    {a.criadoPorNome ?? '—'} · {data(a.criadoEm)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Paginação">
            <span style={{ color: 'var(--cor-texto-secundario)' }}>
              {pagina.total.toLocaleString('pt-BR')} arquivo(s) · página {pagina.pagina} de {totalPaginas}
            </span>
            <span className="flex gap-2">
              <button type="button" className="botao-secundario min-h-11 min-w-11" aria-label="Página anterior" disabled={pagina.pagina <= 1} onClick={() => setFiltro((f) => ({ ...f, pagina: (f.pagina ?? 1) - 1 }))}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className="botao-secundario min-h-11 min-w-11" aria-label="Próxima página" disabled={pagina.pagina >= totalPaginas} onClick={() => setFiltro((f) => ({ ...f, pagina: (f.pagina ?? 1) + 1 }))}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          </nav>
        </>
      )}

      {enviando && (
        <EnvioArquivo
          categorias={categorias}
          aoFechar={() => setEnviando(false)}
          aoConcluir={(a) => {
            setEnviando(false)
            recarregar()
            setAberto(a.id)
          }}
        />
      )}
      {aberto && <DetalheArquivo arquivoId={aberto} categorias={categorias} aoAlterar={recarregar} aoFechar={() => setAberto(null)} />}
    </div>
  )
}

function Linha({ arquivo: a, aoAbrir }: { arquivo: ArquivoResumo; aoAbrir: () => void }) {
  return (
    <tr className="border-t align-top hover:bg-white/5" style={{ borderColor: 'var(--cor-borda)' }}>
      <td className="px-3 py-2">
        <button type="button" onClick={aoAbrir} className="block w-full text-left">
          <span className="block truncate font-medium" title={a.nomeOriginal}>
            {a.nomeOriginal}
          </span>
          <span className="block truncate text-xs" style={{ color: 'var(--cor-texto-terciario)' }}>
            {a.descricao ?? `versão ${a.versaoAtual}`}
          </span>
        </button>
      </td>
      <td className="px-3 py-2">{ROTULO_FINALIDADE[a.finalidade]}</td>
      <td className="hidden truncate px-3 py-2 lg:table-cell">{a.categoria}</td>
      <td className="numeros-tabulares px-3 py-2 text-right">{formatarBytes(a.tamanhoBytes)}</td>
      <td className="hidden px-3 py-2 text-xs lg:table-cell">
        <span className="block truncate">{a.criadoPorNome ?? '—'}</span>
        <span style={{ color: 'var(--cor-texto-terciario)' }}>{data(a.criadoEm)}</span>
      </td>
      <td className="px-3 py-2">
        <Situacao s={a.situacao} />
      </td>
      <td className="px-3 py-2">
        <span className="flex justify-end gap-1">
          {a.situacao !== 'EXPURGADO' && (
            <a className="botao-secundario min-h-11 min-w-11 !px-2" href={arquivoRepository.urlConteudo(a.id)} aria-label={`Baixar ${a.nomeOriginal}`}>
              <Download className="h-4 w-4" />
            </a>
          )}
          <button type="button" className="botao-secundario min-h-11 !px-2 text-xs" onClick={aoAbrir}>
            Abrir
          </button>
        </span>
      </td>
    </tr>
  )
}
