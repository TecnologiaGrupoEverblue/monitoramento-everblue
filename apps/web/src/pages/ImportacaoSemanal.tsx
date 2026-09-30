import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { Painel } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badges'
import { useSessao } from '../contexts/SessaoContext'
import { useFiltros } from '../contexts/FiltrosContext'
import { ErroApi } from '../api/cliente'
import { comiteAtaRepository, importacaoRepository, type PreviewImportacao } from '../repositories'
import type { LinhaComErro } from '../models/types'
import { formatarMoeda, formatarPercentual } from '../utils/formatters'

type Etapa = { fase: 'ocioso' } | { fase: 'processando' } | { fase: 'preview' } | { fase: 'concluido' }

function CardResumo({ titulo, valor, cor }: { titulo: string; valor: string; cor?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--cor-borda)' }}>
      <p className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
        {titulo}
      </p>
      <p className="fonte-editorial numeros-tabulares text-lg font-semibold" style={{ color: cor ?? 'var(--cor-primaria)' }}>
        {valor}
      </p>
    </div>
  )
}

export default function ImportacaoSemanal() {
  const { usuario, pode } = useSessao()
  const { recarregarDados } = useFiltros()
  const inputRef = useRef<HTMLInputElement>(null)
  const [semanaRef, setSemanaRef] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [semanaRefCarregada, setSemanaRefCarregada] = useState(false)
  const [etapa, setEtapa] = useState<Etapa>({ fase: 'ocioso' })
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [colunasFaltando, setColunasFaltando] = useState<string[]>([])
  const [linhasComErro, setLinhasComErro] = useState<LinhaComErro[]>([])
  const [preview, setPreview] = useState<PreviewImportacao | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const podeImportar = pode('analista')

  if (!semanaRefCarregada) {
    setSemanaRefCarregada(true)
    comiteAtaRepository.proximoComitePlanejado().then((c) => {
      if (c) setSemanaRef(c.data)
    })
  }

  function aplicarPreview(preparado: PreviewImportacao) {
    setColunasFaltando(preparado.colunasFaltando)
    setLinhasComErro(preparado.linhasComErro)
    if (preparado.colunasFaltando.length > 0) {
      setPreview(null)
      setEtapa({ fase: 'ocioso' })
      return
    }
    setPreview(preparado)
    setEtapa({ fase: 'preview' })
  }

  async function selecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    setNomeArquivo(arquivo.name)
    setEtapa({ fase: 'processando' })
    setPreview(null)
    try {
      // O arquivo é validado e guardado no servidor (original no MinIO); a
      // prévia volta pronta — nada de negócio é gravado nesta etapa.
      aplicarPreview(await importacaoRepository.enviarArquivo(arquivo, semanaRef))
    } catch (erro) {
      setColunasFaltando([])
      const mensagem = erro instanceof ErroApi ? erro.message : 'Não foi possível ler o arquivo. Confira se é um .xlsx ou .csv válido, gerado a partir do modelo.'
      setLinhasComErro([{ linha: 0, erros: [mensagem] }])
      setEtapa({ fase: 'ocioso' })
    }
  }

  async function recalcularPreview(novaSemana: string) {
    setSemanaRef(novaSemana)
    if (!preview || !novaSemana) return
    aplicarPreview(await importacaoRepository.recalcularPreview(preview.importacaoId, novaSemana))
  }

  async function confirmar() {
    if (!preview) return
    setConfirmando(true)
    try {
      await importacaoRepository.confirmarImportacao(preview.importacaoId, semanaRef)
      setEtapa({ fase: 'concluido' })
      recarregarDados()
    } finally {
      setConfirmando(false)
    }
  }

  function reiniciar() {
    setEtapa({ fase: 'ocioso' })
    setNomeArquivo(null)
    setColunasFaltando([])
    setLinhasComErro([])
    setPreview(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="fonte-editorial text-2xl font-semibold" style={{ color: 'var(--cor-primaria)' }}>
          Importação Semanal
        </h1>
        <p className="text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Upload da posição semanal (.xlsx/.csv), validação, comparação com a semana anterior e geração automática de alertas — sem sobrescrever
          decisões manuais do comitê (planos de ação, pareceres do checklist, prioridade/criticidade/responsável).
        </p>
      </div>

      {etapa.fase === 'concluido' ? (
        <Painel>
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="text-4xl">✅</span>
            <p className="font-semibold" style={{ color: 'var(--cor-primaria)' }}>
              Importação concluída
            </p>
            <p className="max-w-md text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
              A posição de {formatarDataCurta(semanaRef)} foi salva como novo snapshot histórico. Os alertas gerados já aparecem em Clientes em
              Monitoramento / Saída de Risco / Jurídico e a pauta do próximo comitê já está preparada.
            </p>
            <button onClick={reiniciar} className="botao-primario mt-2">
              Importar outra posição
            </button>
          </div>
        </Painel>
      ) : (
        <>
          <Painel titulo="1. Selecionar arquivo e posição">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
                  Posição da carteira (semana de referência)
                </label>
                <input
                  type="date"
                  value={semanaRef}
                  onChange={(e) => recalcularPreview(e.target.value)}
                  className="campo"
                />
              </div>
              <div className="flex items-center gap-3">
                <a href="/modelos/modelo_importacao_semanal.xlsx" download className="text-xs font-medium underline" style={{ color: 'var(--cor-destaque)' }}>
                  Baixar planilha modelo
                </a>
                <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={selecionarArquivo} className="hidden" />
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={!podeImportar || etapa.fase === 'processando'}
                  title={podeImportar ? undefined : 'Seu perfil permite apenas consulta.'}
                  className="botao-primario"
                >
                  {etapa.fase === 'processando' ? 'Lendo…' : 'Selecionar arquivo'}
                </button>
              </div>
            </div>
            {nomeArquivo && (
              <p className="mt-2 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
                Arquivo: {nomeArquivo} · o original fica guardado no repositório de arquivos para auditoria.
              </p>
            )}
            {colunasFaltando.length > 0 && (
              <div className="mt-3 border-l-2 p-2.5 text-sm" style={{ borderColor: 'var(--cor-critico)', backgroundColor: 'var(--cor-critico-fundo)', color: 'var(--cor-critico)' }}>
                <p className="font-semibold">Arquivo fora do modelo — coluna(s) não encontrada(s):</p>
                <ul className="list-inside list-disc">
                  {colunasFaltando.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="mt-1">Baixe a planilha modelo acima e preencha por cima dela para garantir os cabeçalhos corretos.</p>
              </div>
            )}
          </Painel>

          {linhasComErro.length > 0 && (
            <Painel titulo={`Linhas com erro de validação (${linhasComErro.length})`}>
              <div className="flex flex-col gap-2">
                {linhasComErro.map((l) => (
                  <div key={l.linha} className="border-l-2 p-2 text-sm" style={{ borderColor: 'var(--cor-atencao)', backgroundColor: 'var(--cor-atencao-fundo)' }}>
                    <p className="font-semibold" style={{ color: 'var(--cor-atencao)' }}>
                      {l.linha > 0 ? `Linha ${l.linha}` : 'Arquivo'}
                    </p>
                    <ul className="list-inside list-disc text-xs" style={{ color: 'var(--cor-texto-primario)' }}>
                      {l.erros.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Painel>
          )}

          {preview && (
            <>
              <Painel titulo="2. Principais mudanças detectadas">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <CardResumo titulo="Clientes novos" valor={String(preview.totais.clientesNovos)} />
                  <CardResumo titulo="Clientes atualizados" valor={String(preview.totais.clientesAtualizados)} />
                  <CardResumo
                    titulo="Variação de risco"
                    valor={`${preview.totais.deltaRiscoTotal >= 0 ? '+' : '−'} ${formatarMoeda(Math.abs(preview.totais.deltaRiscoTotal))}`}
                    cor={preview.totais.deltaRiscoTotal >= 0 ? 'var(--cor-critico)' : 'var(--cor-normal)'}
                  />
                  <CardResumo titulo="Com aumento de vencido" valor={String(preview.totais.clientesComAumentoDeVencido)} cor={preview.totais.clientesComAumentoDeVencido > 0 ? 'var(--cor-atencao)' : undefined} />
                  <CardResumo titulo="Novos alertas" valor={String(preview.totais.totalNovosAlertas)} cor={preview.totais.totalNovosAlertas > 0 ? 'var(--cor-critico)' : undefined} />
                  <CardResumo titulo="Mudanças de status" valor={String(preview.totais.clientesComMudancaDeStatus)} />
                  <CardResumo titulo="Planos de ação já atrasados" valor={String(preview.totais.planosAtrasadosExistentes)} />
                  <CardResumo titulo="Linhas já importadas nesta semana" valor={String(preview.totais.linhasJaImportadas)} cor={preview.totais.linhasJaImportadas > 0 ? 'var(--cor-atencao)' : undefined} />
                </div>
              </Painel>

              <Painel titulo={`3. Conferir linha a linha (${preview.totais.linhasProntas} prontas para importar)`}>
                <div className="max-h-[420px] overflow-auto border" style={{ borderColor: 'var(--cor-borda)' }}>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-[var(--cor-superficie-solida)] text-[12px] font-medium" style={{ color: 'var(--cor-texto-secundario)', borderColor: 'var(--cor-borda-forte)' }}>
                      <tr>
                        <th className="px-2 py-2 text-left">Linha</th>
                        <th className="px-2 py-2 text-left">Cliente</th>
                        <th className="px-2 py-2 text-left">Status</th>
                        <th className="px-2 py-2 text-right">Risco</th>
                        <th className="px-2 py-2 text-right">Δ Risco</th>
                        <th className="px-2 py-2 text-right">% Vencido</th>
                        <th className="px-2 py-2 text-right">Alertas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.itens.map((item) => (
                        <tr
                          key={item.linha}
                          className="border-t"
                          style={{ borderColor: 'var(--cor-borda)', opacity: item.jaImportadoNestaSemana ? 0.5 : 1 }}
                        >
                          <td className="px-2 py-1.5">{item.linha}</td>
                          <td className="px-2 py-1.5 font-medium" style={{ color: 'var(--cor-primaria)' }}>
                            {item.nome}
                            {item.novo && (
                              <span className="ml-1.5 border-l-2 px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--cor-normal)', backgroundColor: 'var(--cor-normal-fundo)', borderColor: 'var(--cor-normal)' }}>
                                novo
                              </span>
                            )}
                            {item.jaImportadoNestaSemana && (
                              <span className="ml-1.5 border-l-2 px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--cor-atencao)', backgroundColor: 'var(--cor-atencao-fundo)', borderColor: 'var(--cor-atencao)' }}>
                                já importado nesta semana
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <StatusBadge status={item.statusNovo} />
                              {item.mudouStatus && item.statusAnterior && (
                                <span className="text-[10px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                                  (era {item.statusAnterior})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="numeros-tabulares px-2 py-1.5 text-right">{formatarMoeda(item.riscoNovo)}</td>
                          <td className="numeros-tabulares px-2 py-1.5 text-right" style={{ color: item.deltaRisco === null ? undefined : item.deltaRisco >= 0 ? 'var(--cor-critico)' : 'var(--cor-normal)' }}>
                            {item.deltaRisco === null ? '—' : `${item.deltaRisco >= 0 ? '+' : '−'} ${formatarMoeda(Math.abs(item.deltaRisco))}`}
                          </td>
                          <td className="numeros-tabulares px-2 py-1.5 text-right" style={{ color: item.aumentoVencido ? 'var(--cor-critico)' : undefined }}>
                            {formatarPercentual(item.percVencidoNovo)}
                          </td>
                          <td className="numeros-tabulares px-2 py-1.5 text-right">{item.alertasGerados.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Painel>

              <Painel titulo="4. Confirmar importação">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--cor-texto-secundario)' }}>
                      Responsável por esta importação
                    </span>
                    <span className="text-sm font-medium" style={{ color: 'var(--cor-texto-primario)' }}>
                      {usuario.nome} <span style={{ color: 'var(--cor-texto-secundario)' }}>· {usuario.email}</span>
                    </span>
                  </div>
                  <button
                    onClick={confirmar}
                    disabled={confirmando || !podeImportar || preview.totais.linhasProntas === 0}
                    className="botao-primario px-4 py-2 text-sm"
                  >
                    {confirmando ? 'Importando…' : `Confirmar importação de ${preview.totais.linhasProntas} cliente(s)`}
                  </button>
                </div>
              </Painel>
            </>
          )}
        </>
      )}
    </div>
  )
}

function formatarDataCurta(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR')
}
