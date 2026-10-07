import { useMemo, useState } from 'react'
import { ErroApi } from '../../api/cliente'
import type { RestritivoSemanal, TipoRestritivo } from '../../models/types'
import { restritivoRepository } from '../../repositories'
import { compararRestritivos, formatarData, formatarMoeda, TIPOS_RESTRITIVO } from '../../utils/formatters'
import { Painel } from '../ui/Card'
import { Modal } from '../ui/Modal'

type Rascunho = Record<TipoRestritivo, { quantidade: string; valor: string }>

function agruparPorSemana(lista: RestritivoSemanal[]): { semanaRef: string; linhas: RestritivoSemanal[] }[] {
  const mapa = new Map<string, RestritivoSemanal[]>()
  for (const r of lista) mapa.set(r.semanaRef, [...(mapa.get(r.semanaRef) ?? []), r])
  return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([semanaRef, linhas]) => ({ semanaRef, linhas }))
}

/** Quadro restritivo estruturado: quantidade e valor por tipo, semana a
 * semana, com a comparação que o comitê lê ("Pefin 13 → 15"). */
export default function PainelRestritivos({
  clienteId,
  semanaRef,
  restritivos,
  podeEditar,
  aoAtualizar,
}: {
  clienteId: string
  semanaRef: string | null
  restritivos: RestritivoSemanal[]
  podeEditar: boolean
  aoAtualizar: (lista: RestritivoSemanal[]) => void
}) {
  const semanas = useMemo(() => agruparPorSemana(restritivos), [restritivos])
  const [editando, setEditando] = useState(false)
  const atual = semanas.find((s) => s.semanaRef === semanaRef) ?? semanas[0] ?? null
  const anterior = atual ? (semanas.find((s) => s.semanaRef < atual.semanaRef) ?? null) : null
  const variacoes = atual ? compararRestritivos(atual.linhas, anterior?.linhas ?? null) : []

  return (
    <Painel
      titulo="Evolução do quadro restritivo"
      className="lg:col-span-2"
      acao={
        podeEditar && semanaRef ? (
          <button type="button" onClick={() => setEditando(true)} className="botao-secundario px-2.5 py-1 text-xs">
            Lançar / corrigir ({formatarData(semanaRef)})
          </button>
        ) : undefined
      }
    >
      {!atual ? (
        <p className="py-4 text-center text-sm" style={{ color: 'var(--cor-texto-secundario)' }}>
          Sem restritivos estruturados. Lance por tipo (Pefin, Refin, protesto…) ou envie as colunas na importação semanal.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs" style={{ color: 'var(--cor-texto-secundario)' }}>
            Posição de {formatarData(atual.semanaRef)}
            {anterior ? ` comparada a ${formatarData(anterior.semanaRef)}` : ' (sem posição anterior para comparar)'}
          </p>
          {/* Três colunas que cabem em 360 px: anterior → atual na mesma célula. */}
          <table className="w-full text-sm">
            <thead className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
              <tr>
                <th className="py-1 text-left">Tipo</th>
                <th className="py-1 text-right">Quantidade</th>
                <th className="py-1 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {variacoes.map((v) => (
                <tr key={v.tipo} className="border-t align-top" style={{ borderColor: 'var(--cor-borda)', color: v.piorou ? 'var(--cor-critico)' : undefined }}>
                  <td className="py-1 pr-2 font-medium">
                    {v.label}
                    {v.piorou && <span className="block text-[10px] font-bold">▲ piorou</span>}
                  </td>
                  <td className="numeros-tabulares py-1 text-right">
                    {anterior ? `${v.quantidadeAnterior} → ` : ''}
                    {v.quantidadeAtual}
                  </td>
                  <td className="numeros-tabulares py-1 pl-2 text-right">
                    {anterior && <span className="block text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>{formatarMoeda(v.valorAnterior)} →</span>}
                    {formatarMoeda(v.valorAtual)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
            Última gravação: {atual.linhas[0]?.registradoPor} · {atual.linhas[0]?.origem === 'IMPORTACAO' ? 'importação semanal' : 'lançamento manual'}
          </p>
        </>
      )}
      {editando && semanaRef && (
        <ModalRestritivos
          clienteId={clienteId}
          semanaRef={semanaRef}
          inicial={semanas.find((s) => s.semanaRef === semanaRef)?.linhas ?? []}
          aoFechar={(lista) => {
            setEditando(false)
            if (lista) aoAtualizar(lista)
          }}
        />
      )}
    </Painel>
  )
}

function ModalRestritivos({
  clienteId,
  semanaRef,
  inicial,
  aoFechar,
}: {
  clienteId: string
  semanaRef: string
  inicial: RestritivoSemanal[]
  aoFechar: (lista: RestritivoSemanal[] | null) => void
}) {
  const [rascunho, setRascunho] = useState<Rascunho>(
    () =>
      Object.fromEntries(
        TIPOS_RESTRITIVO.map((t) => {
          const r = inicial.find((x) => x.tipo === t.tipo)
          return [t.tipo, { quantidade: r ? String(r.quantidade) : '', valor: r ? String(r.valor).replace('.', ',') : '' }]
        }),
      ) as Rascunho,
  )
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'aviso'; texto: string } | null>(null)

  // Digitação brasileira: com vírgula, 1.234,56; sem vírgula, "10.000" e
  // "1.234.567" são milhares; "1234.5" é decimal. Texto inválido vira NaN e é recusado.
  const numero = (t: string) => {
    const v = t.trim().replace(/[R$\s]/g, '')
    if (v === '') return null
    if (v.includes(',')) return Number(v.replace(/\./g, '').replace(',', '.'))
    if (/^\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, ''))
    return Number(v)
  }
  const [gravado, setGravado] = useState<RestritivoSemanal[] | null>(null)

  async function salvar() {
    const linhas = []
    for (const t of TIPOS_RESTRITIVO) {
      const q = numero(rascunho[t.tipo].quantidade)
      const v = numero(rascunho[t.tipo].valor)
      if (q === null && v === null) continue
      if ((q !== null && (!Number.isInteger(q) || q < 0)) || (v !== null && (!Number.isFinite(v) || v < 0))) {
        setMensagem({ tipo: 'erro', texto: `${t.label}: informe quantidade inteira e valor em reais, sem texto.` })
        return
      }
      linhas.push({ tipo: t.tipo, quantidade: q ?? 0, valor: v ?? 0 })
    }
    setSalvando(true)
    try {
      const r = await restritivoRepository.gravar(clienteId, semanaRef, linhas)
      if (r.pioras.length === 0) {
        aoFechar(r.restritivos)
        return
      }
      // Piora: o modal fica aberto mostrando o que piorou e o alerta gerado.
      setMensagem({ tipo: 'aviso', texto: `Gravado. Piora frente à semana anterior${r.alertaGerado ? ' — alerta gerado' : ''}: ${r.pioras.join('; ')}` })
      setGravado(r.restritivos)
      setSalvando(false)
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível gravar.' })
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo="Quadro restritivo"
      subtitulo={`Posição de ${formatarData(semanaRef)} — tipos em branco não são gravados`}
      aoFechar={() => aoFechar(gravado)}
      rodape={
        gravado ? (
          <button type="button" className="botao-primario" onClick={() => aoFechar(gravado)}>
            Fechar
          </button>
        ) : (
          <>
            <button type="button" className="botao-secundario" onClick={() => aoFechar(null)} disabled={salvando}>
              Cancelar
            </button>
            <button type="button" className="botao-primario" onClick={salvar} disabled={salvando}>
              {salvando ? 'Gravando…' : 'Gravar'}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-2">
        {mensagem && (
          <p
            role={mensagem.tipo === 'erro' ? 'alert' : 'status'}
            className="border-l-2 p-2 text-xs"
            data-mensagem-restritivos
            style={{
              borderColor: mensagem.tipo === 'erro' ? 'var(--cor-critico)' : 'var(--cor-atencao)',
              backgroundColor: mensagem.tipo === 'erro' ? 'var(--cor-critico-fundo)' : 'var(--cor-atencao-fundo)',
            }}
          >
            {mensagem.texto}
          </p>
        )}
        {TIPOS_RESTRITIVO.map((t) => (
          <div key={t.tipo} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_7rem_10rem]">
            <span className="text-sm font-medium">{t.label}</span>
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                Quantidade
              </span>
              <input
                disabled={Boolean(gravado)}
                className="campo"
                inputMode="numeric"
                value={rascunho[t.tipo].quantidade}
                onChange={(e) => setRascunho((r) => ({ ...r, [t.tipo]: { ...r[t.tipo], quantidade: e.target.value } }))}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px]" style={{ color: 'var(--cor-texto-secundario)' }}>
                Valor (R$)
              </span>
              <input
                disabled={Boolean(gravado)}
                className="campo"
                inputMode="decimal"
                value={rascunho[t.tipo].valor}
                onChange={(e) => setRascunho((r) => ({ ...r, [t.tipo]: { ...r[t.tipo], valor: e.target.value } }))}
              />
            </label>
          </div>
        ))}
      </div>
    </Modal>
  )
}
