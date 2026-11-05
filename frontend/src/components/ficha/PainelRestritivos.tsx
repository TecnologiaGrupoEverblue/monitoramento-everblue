import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { esquemaRestritivos, lerValorBr } from '@monitoramento/dominio'
import { invalidar } from '../../consultas'
import { primeiraMensagem } from '../../utils/formulario'
import { ErroApi } from '../../api/cliente'
import type { RestritivoSemanal, TipoRestritivo } from '../../models/types'
import { restritivoRepository } from '../../repositories'
import { compararRestritivos, formatarData, formatarMoeda, TIPOS_RESTRITIVO } from '../../utils/formatters'
import { Painel } from '../ui/Card'
import { Modal } from '../ui/Modal'


/** Quadro digitado (padrão brasileiro) → linhas do PUT, com as regras da API
 * (dominio/esquemas). Tipo em branco não é gravado. */
const esquemaFormRestritivos = z
  .record(z.string(), z.object({ quantidade: z.string(), valor: z.string() }))
  .transform((r, ctx) => {
    const linhas: { tipo: string; quantidade: number; valor: number }[] = []
    for (const t of TIPOS_RESTRITIVO) {
      const e = r[t.tipo]
      const qVazio = !e?.quantidade.trim()
      const vVazio = !e?.valor.trim()
      if (qVazio && vVazio) continue
      const q = qVazio ? 0 : lerValorBr(e!.quantidade)
      const v = vVazio ? 0 : lerValorBr(e!.valor)
      if (q === null || v === null || !Number.isInteger(q) || q < 0 || v < 0) {
        ctx.addIssue({ code: 'custom', message: `${t.label}: informe quantidade inteira e valor em reais, sem texto.` })
        return z.NEVER
      }
      linhas.push({ tipo: t.tipo, quantidade: q, valor: v })
    }
    return linhas
  })
  .pipe(esquemaRestritivos.shape.linhas)
type Rascunho = z.input<typeof esquemaFormRestritivos>
type LinhasRestritivo = z.output<typeof esquemaFormRestritivos>

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
      className="xl:col-span-2"
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
  const clienteConsultas = useQueryClient()
  const { register, handleSubmit, formState } = useForm<Rascunho, unknown, LinhasRestritivo>({
    resolver: zodResolver(esquemaFormRestritivos),
    defaultValues: Object.fromEntries(
      TIPOS_RESTRITIVO.map((t) => {
        const r = inicial.find((x) => x.tipo === t.tipo)
        return [t.tipo, { quantidade: r ? String(r.quantidade) : '', valor: r ? String(r.valor).replace('.', ',') : '' }]
      }),
    ),
  })
  const [gravado, setGravado] = useState<RestritivoSemanal[] | null>(null)
  const gravar = useMutation({
    mutationFn: (linhas: LinhasRestritivo) => restritivoRepository.gravar(clienteId, semanaRef, linhas as (LinhasRestritivo[number] & { tipo: TipoRestritivo })[]),
    onSuccess: (r) => {
      void invalidar(clienteConsultas, 'carteira')
      if (r.pioras.length === 0) aoFechar(r.restritivos)
      // Piora: o modal fica aberto mostrando o que piorou e o alerta gerado.
      else setGravado(r.restritivos)
    },
  })
  const salvando = gravar.isPending
  const salvar = handleSubmit((linhas) => gravar.mutate(linhas))
  const erroForm = primeiraMensagem(formState.errors)
  const mensagem: { tipo: 'erro' | 'aviso'; texto: string } | null = erroForm
    ? { tipo: 'erro', texto: erroForm }
    : gravar.isError
      ? { tipo: 'erro', texto: gravar.error instanceof ErroApi ? gravar.error.message : 'Não foi possível gravar.' }
      : gravar.data && gravar.data.pioras.length > 0
        ? { tipo: 'aviso', texto: `Gravado. Piora frente à semana anterior${gravar.data.alertaGerado ? ' — alerta gerado' : ''}: ${gravar.data.pioras.join('; ')}` }
        : null

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
            <button type="button" className="botao-primario" onClick={() => void salvar()} disabled={salvando}>
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
                {...register(`${t.tipo}.quantidade`)}
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
                {...register(`${t.tipo}.valor`)}
              />
            </label>
          </div>
        ))}
      </div>
    </Modal>
  )
}
