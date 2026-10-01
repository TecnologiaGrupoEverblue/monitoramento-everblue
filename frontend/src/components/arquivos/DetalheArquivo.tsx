import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Download, Eye, FileUp, History, RotateCcw, Save, Trash2, TriangleAlert } from 'lucide-react'
import { formatarBytes, type ArquivoResumo, type EventoArquivo, type VersaoArquivo } from '@monitoramento/dominio'
import { ErroApi } from '../../api/cliente'
import { useSessao } from '../../contexts/SessaoContext'
import { arquivoRepository } from '../../repositories'
import { Modal } from '../ui/Modal'
import { EnvioArquivo } from './EnvioArquivo'
import { COR_SITUACAO, ROTULO_EVENTO, ROTULO_FINALIDADE, ROTULO_SITUACAO } from './rotulos'

const VISUALIZAVEIS = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

type Aba = 'dados' | 'versoes' | 'trilha'
type Confirmacao = { tipo: 'excluir' | 'expurgar' } | null

/** Ficha do arquivo: dados, versões, trilha e todas as ações do ciclo de vida. */
export function DetalheArquivo({ arquivoId, categorias, aoAlterar, aoFechar }: { arquivoId: string; categorias: string[]; aoAlterar: () => void; aoFechar: () => void }) {
  const { pode } = useSessao()
  const [arquivo, setArquivo] = useState<ArquivoResumo | null>(null)
  const [versoes, setVersoes] = useState<VersaoArquivo[]>([])
  const [eventos, setEventos] = useState<EventoArquivo[]>([])
  const [aba, setAba] = useState<Aba>('dados')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [enviandoVersao, setEnviandoVersao] = useState(false)
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null)
  const [motivo, setMotivo] = useState('')
  const [edicao, setEdicao] = useState({ descricao: '', categoria: '', retencaoAte: '', tags: '' })

  const carregar = useCallback(async () => {
    const [a, v, e] = await Promise.all([arquivoRepository.obter(arquivoId), arquivoRepository.versoes(arquivoId), arquivoRepository.eventos(arquivoId)])
    setArquivo(a)
    setVersoes(v)
    setEventos(e)
    setEdicao({
      descricao: a.descricao ?? '',
      categoria: a.categoria,
      retencaoAte: a.retencaoAte ?? '',
      tags: Object.entries(a.tags).map(([k, val]) => `${k}=${val}`).join('\n'),
    })
  }, [arquivoId])

  useEffect(() => {
    carregar().catch(() => setErro('Não foi possível carregar o arquivo.'))
  }, [carregar])

  async function executar(acao: () => Promise<unknown>, mensagem: string) {
    setErro(null)
    setAviso(null)
    setOcupado(true)
    try {
      await acao()
      await carregar()
      setAviso(mensagem)
      aoAlterar()
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível concluir a operação.')
    } finally {
      setOcupado(false)
    }
  }

  function salvarDados() {
    const tags: Record<string, string> = {}
    for (const linha of edicao.tags.split('\n')) {
      const [k, ...resto] = linha.split('=')
      if (k?.trim()) tags[k.trim()] = resto.join('=').trim()
    }
    return executar(
      () => arquivoRepository.atualizar(arquivoId, { descricao: edicao.descricao.trim() || null, categoria: edicao.categoria.trim() || 'geral', retencaoAte: edicao.retencaoAte || null, tags }),
      'Dados do arquivo salvos.',
    )
  }

  if (!arquivo) {
    return (
      <Modal titulo="Arquivo" aoFechar={aoFechar}>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }} role="status">
          {erro ?? 'Carregando…'}
        </p>
      </Modal>
    )
  }

  const emUso = arquivo.situacao === 'ATIVO' || arquivo.situacao === 'ARQUIVADO'
  const expurgado = arquivo.situacao === 'EXPURGADO'
  const editavel = pode('analista') && !expurgado
  const cor = COR_SITUACAO[arquivo.situacao]

  return (
    <>
      <Modal
        titulo={arquivo.nomeOriginal}
        largura="max-w-3xl"
        aoFechar={aoFechar}
        subtitulo={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: cor.texto, background: cor.fundo }}>
              {ROTULO_SITUACAO[arquivo.situacao]}
            </span>
            <span>{ROTULO_FINALIDADE[arquivo.finalidade]}</span>·<span>{arquivo.categoria}</span>·<span>versão {arquivo.versaoAtual}</span>·<span>{formatarBytes(arquivo.tamanhoBytes)}</span>
          </span>
        }
        rodape={
          <>
            {!expurgado && (
              <a className="botao-secundario" href={arquivoRepository.urlConteudo(arquivo.id)}>
                <Download className="h-4 w-4" /> Baixar
              </a>
            )}
            {!expurgado && VISUALIZAVEIS.has(arquivo.mime) && (
              <a className="botao-secundario" href={arquivoRepository.urlConteudo(arquivo.id, undefined, true)} target="_blank" rel="noopener">
                <Eye className="h-4 w-4" /> Visualizar
              </a>
            )}
            {editavel && emUso && (
              <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => setEnviandoVersao(true)}>
                <FileUp className="h-4 w-4" /> Nova versão
              </button>
            )}
            {editavel && arquivo.situacao === 'ATIVO' && (
              <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => executar(() => arquivoRepository.arquivar(arquivo.id), 'Arquivo arquivado.')}>
                <Archive className="h-4 w-4" /> Arquivar
              </button>
            )}
            {editavel && (arquivo.situacao === 'ARQUIVADO' || arquivo.situacao === 'EXCLUIDO') && (
              <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => executar(() => arquivoRepository.reativar(arquivo.id), 'Arquivo reativado.')}>
                <ArchiveRestore className="h-4 w-4" /> Reativar
              </button>
            )}
            {editavel && emUso && (
              <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => setConfirmacao({ tipo: 'excluir' })}>
                <Trash2 className="h-4 w-4" /> Excluir
              </button>
            )}
            {pode('admin') && !expurgado && (
              <button type="button" className="botao-secundario" style={{ color: 'var(--cor-critico)' }} disabled={ocupado} onClick={() => setConfirmacao({ tipo: 'expurgar' })}>
                <TriangleAlert className="h-4 w-4" /> Expurgar
              </button>
            )}
          </>
        }
      >
        <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist">
          {(
            [
              ['dados', 'Dados'],
              ['versoes', `Versões (${versoes.length})`],
              ['trilha', 'Trilha'],
            ] as [Aba, string][]
          ).map(([chave, rotulo]) => (
            <button
              key={chave}
              type="button"
              role="tab"
              aria-selected={aba === chave}
              onClick={() => setAba(chave)}
              className="min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-medium"
              style={aba === chave ? { background: 'var(--cor-acao)', color: '#fff' } : { color: 'var(--cor-texto-secundario)' }}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {aviso && (
          <p role="status" className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ color: 'var(--cor-normal)', background: 'var(--cor-normal-fundo)' }}>
            {aviso}
          </p>
        )}
        {erro && (
          <p role="alert" className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ color: 'var(--cor-critico)', background: 'var(--cor-critico-fundo)' }}>
            {erro}
          </p>
        )}

        {aba === 'dados' && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {[
                ['Enviado por', `${arquivo.criadoPorNome ?? '—'} em ${dataHora(arquivo.criadoEm)}`],
                ['Última alteração', dataHora(arquivo.atualizadoEm)],
                ['Tipo real', arquivo.mime],
                ['SHA-256', arquivo.sha256],
                ['Vínculo', arquivo.recursoTipo ? `${arquivo.recursoTipo} ${arquivo.recursoId}` : '—'],
                ['Exclusão', arquivo.excluidoEm ? `${dataHora(arquivo.excluidoEm)} — ${arquivo.motivoExclusao ?? ''}` : '—'],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="min-w-0">
                  <dt className="text-xs" style={{ color: 'var(--cor-texto-terciario)' }}>
                    {rotulo}
                  </dt>
                  <dd className={`break-all ${rotulo === 'SHA-256' ? 'font-mono text-xs' : ''}`}>{valor}</dd>
                </div>
              ))}
            </dl>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span style={{ color: 'var(--cor-texto-secundario)' }}>Descrição</span>
                <textarea rows={2} maxLength={2000} value={edicao.descricao} disabled={!editavel} onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: 'var(--cor-texto-secundario)' }}>Categoria</span>
                <input list="categorias-detalhe" maxLength={80} value={edicao.categoria} disabled={!editavel} onChange={(e) => setEdicao({ ...edicao, categoria: e.target.value })} />
                <datalist id="categorias-detalhe">
                  {categorias.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: 'var(--cor-texto-secundario)' }}>Reter até (bloqueia o expurgo)</span>
                <input type="date" value={edicao.retencaoAte} disabled={!editavel} onChange={(e) => setEdicao({ ...edicao, retencaoAte: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span style={{ color: 'var(--cor-texto-secundario)' }}>Etiquetas (uma por linha, no formato chave=valor)</span>
                <textarea rows={3} className="font-mono text-xs" value={edicao.tags} disabled={!editavel} onChange={(e) => setEdicao({ ...edicao, tags: e.target.value })} />
              </label>
            </div>
            {editavel && (
              <div className="flex justify-end">
                <button type="button" className="botao-primario" disabled={ocupado} onClick={salvarDados}>
                  <Save className="h-4 w-4" /> Salvar dados
                </button>
              </div>
            )}
          </div>
        )}

        {aba === 'versoes' && (
          <ul className="flex flex-col gap-2">
            {versoes.map((v) => (
              <li key={v.numero} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--cor-borda)' }}>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    Versão {v.numero} {v.numero === arquivo.versaoAtual && <span style={{ color: 'var(--cor-destaque)' }}>· atual</span>}
                  </p>
                  <p className="break-all" style={{ color: 'var(--cor-texto-secundario)' }}>
                    {v.nomeOriginal} · {formatarBytes(v.tamanhoBytes)} · {v.criadoPorNome ?? '—'} em {dataHora(v.criadoEm)}
                  </p>
                  {v.comentario && <p className="mt-1 text-xs">{v.comentario}</p>}
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  {!expurgado && (
                    <a className="botao-secundario" href={arquivoRepository.urlConteudo(arquivo.id, v.numero)} aria-label={`Baixar versão ${v.numero}`}>
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                  {editavel && emUso && v.numero !== arquivo.versaoAtual && (
                    <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => executar(() => arquivoRepository.restaurarVersao(arquivo.id, v.numero), `Versão ${v.numero} restaurada como versão atual.`)}>
                      <RotateCcw className="h-4 w-4" /> Restaurar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {aba === 'trilha' && (
          <ol className="flex flex-col gap-2">
            {eventos.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <History className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--cor-texto-terciario)' }} />
                <div className="min-w-0">
                  <p>
                    <strong>{ROTULO_EVENTO[e.acao] ?? e.acao}</strong>
                    {e.versao ? ` · versão ${e.versao}` : ''}
                  </p>
                  <p className="break-words text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                    {e.atorNome ?? 'Sistema'} · {dataHora(e.criadoEm)}
                    {typeof e.detalhes.motivo === 'string' ? ` · ${e.detalhes.motivo}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Modal>

      {enviandoVersao && (
        <EnvioArquivo
          categorias={categorias}
          novaVersaoDe={arquivo}
          aoFechar={() => setEnviandoVersao(false)}
          aoConcluir={async () => {
            setEnviandoVersao(false)
            await carregar()
            setAviso('Nova versão enviada.')
            aoAlterar()
          }}
        />
      )}

      {confirmacao && (
        <Modal
          titulo={confirmacao.tipo === 'excluir' ? 'Excluir arquivo' : 'Expurgar definitivamente'}
          largura="max-w-lg"
          aoFechar={() => setConfirmacao(null)}
          rodape={
            <>
              <button type="button" className="botao-secundario" onClick={() => setConfirmacao(null)}>
                Voltar
              </button>
              <button
                type="button"
                className="botao-primario"
                style={confirmacao.tipo === 'expurgar' ? { background: 'var(--cor-critico)' } : undefined}
                disabled={motivo.trim().length < 5 || ocupado}
                onClick={async () => {
                  const tipo = confirmacao.tipo
                  setConfirmacao(null)
                  await executar(
                    () => (tipo === 'excluir' ? arquivoRepository.excluir(arquivo.id, motivo.trim()) : arquivoRepository.expurgar(arquivo.id, motivo.trim())),
                    tipo === 'excluir' ? 'Arquivo excluído. Ele pode ser reativado a qualquer momento.' : 'Conteúdo expurgado do MinIO. Os dados e a trilha continuam registrados.',
                  )
                  setMotivo('')
                }}
              >
                {confirmacao.tipo === 'excluir' ? 'Excluir' : 'Expurgar'}
              </button>
            </>
          }
        >
          <p className="mb-3 text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
            {confirmacao.tipo === 'excluir'
              ? 'O arquivo sai das listas, mas o conteúdo continua guardado e pode ser reativado.'
              : `Todas as ${versoes.length} versão(ões) serão apagadas do MinIO de forma IRREVERSÍVEL. Ficam apenas os dados e a trilha.`}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span>Motivo (obrigatório)</span>
            <textarea rows={3} maxLength={500} value={motivo} autoFocus onChange={(e) => setMotivo(e.target.value)} />
          </label>
        </Modal>
      )}
    </>
  )
}
