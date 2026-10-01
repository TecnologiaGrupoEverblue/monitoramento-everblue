import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { FINALIDADES_ARQUIVO, formatarBytes, type ArquivoResumo, type FinalidadeArquivo } from '@monitoramento/dominio'
import { ErroApi } from '../../api/cliente'
import { arquivoRepository } from '../../repositories'
import { Modal } from '../ui/Modal'
import { ROTULO_FINALIDADE } from './rotulos'

/**
 * Envio de arquivo novo ou de nova versão. Qualquer tipo e tamanho: o arquivo
 * vai em fluxo até o MinIO, com barra de progresso e opção de cancelar.
 */
export function EnvioArquivo({
  categorias,
  novaVersaoDe,
  aoConcluir,
  aoFechar,
}: {
  categorias: string[]
  /** Quando presente, envia uma NOVA VERSÃO deste arquivo. */
  novaVersaoDe?: ArquivoResumo
  aoConcluir: (arquivo: ArquivoResumo) => void
  aoFechar: () => void
}) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [finalidade, setFinalidade] = useState<FinalidadeArquivo>('anexo')
  const [categoria, setCategoria] = useState('')
  const [descricao, setDescricao] = useState('')
  const [retencaoAte, setRetencaoAte] = useState('')
  const [comentario, setComentario] = useState('')
  const [progresso, setProgresso] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const cancelamento = useRef<AbortController | null>(null)

  async function enviar() {
    if (!arquivo) return
    setErro(null)
    setProgresso(0)
    cancelamento.current = new AbortController()
    try {
      const r = novaVersaoDe
        ? await arquivoRepository.novaVersao(novaVersaoDe.id, arquivo, comentario, setProgresso, cancelamento.current.signal)
        : await arquivoRepository.enviar(
            arquivo,
            { finalidade, categoria: categoria.trim() || 'geral', descricao: descricao.trim() || undefined, retencaoAte: retencaoAte || undefined },
            setProgresso,
            cancelamento.current.signal,
          )
      aoConcluir(r)
    } catch (e) {
      setProgresso(null)
      if ((e as Error).name === 'AbortError') return
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível enviar o arquivo.')
    }
  }

  const enviando = progresso !== null
  const titulo = novaVersaoDe ? 'Enviar nova versão' : 'Enviar arquivo'

  return (
    <Modal
      titulo={titulo}
      subtitulo={novaVersaoDe ? `${novaVersaoDe.nomeOriginal} — a versão ${novaVersaoDe.versaoAtual} continua guardada no histórico` : 'Qualquer tipo de arquivo, de qualquer tamanho'}
      aoFechar={enviando ? () => cancelamento.current?.abort() : aoFechar}
      rodape={
        <>
          <button type="button" className="botao-secundario" onClick={enviando ? () => cancelamento.current?.abort() : aoFechar}>
            {enviando ? 'Cancelar envio' : 'Fechar'}
          </button>
          <button type="button" className="botao-primario" disabled={!arquivo || enviando} onClick={enviar}>
            <FileUp className="h-4 w-4" /> {enviando ? `Enviando ${Math.round((progresso ?? 0) * 100)}%` : 'Enviar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center"
          style={{ borderColor: 'var(--cor-borda-forte)' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) setArquivo(f)
          }}
        >
          <FileUp className="h-8 w-8" style={{ color: 'var(--cor-destaque)' }} />
          {arquivo ? (
            <span className="break-all text-sm">
              <strong>{arquivo.name}</strong> · {formatarBytes(arquivo.size)}
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
              Arraste o arquivo aqui ou toque para escolher
            </span>
          )}
          <input type="file" className="sr-only" disabled={enviando} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </label>

        {enviando && (
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progresso ?? 0) * 100)} className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${(progresso ?? 0) * 100}%`, background: 'var(--cor-acao)' }} />
          </div>
        )}

        {novaVersaoDe ? (
          <label className="flex flex-col gap-1 text-sm">
            <span style={{ color: 'var(--cor-texto-secundario)' }}>O que mudou nesta versão (opcional)</span>
            <textarea rows={2} maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} disabled={enviando} />
          </label>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--cor-texto-secundario)' }}>Finalidade</span>
              <select value={finalidade} onChange={(e) => setFinalidade(e.target.value as FinalidadeArquivo)} disabled={enviando}>
                {FINALIDADES_ARQUIVO.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO_FINALIDADE[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--cor-texto-secundario)' }}>Categoria</span>
              <input list="categorias-arquivo" value={categoria} maxLength={80} placeholder="ex.: contratos, extratos, atas" onChange={(e) => setCategoria(e.target.value)} disabled={enviando} />
              <datalist id="categorias-arquivo">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span style={{ color: 'var(--cor-texto-secundario)' }}>Descrição (opcional)</span>
              <textarea rows={2} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)} disabled={enviando} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--cor-texto-secundario)' }}>Reter até (opcional)</span>
              <input type="date" value={retencaoAte} onChange={(e) => setRetencaoAte(e.target.value)} disabled={enviando} />
            </label>
          </div>
        )}

        {erro && (
          <p role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ color: 'var(--cor-critico)', background: 'var(--cor-critico-fundo)' }}>
            {erro}
          </p>
        )}
      </div>
    </Modal>
  )
}
