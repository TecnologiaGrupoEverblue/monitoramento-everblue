import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import type { FiltrosGlobais } from '@monitoramento/dominio'
import { ErroApi } from '../../api/cliente'
import { useSessao } from '../../contexts/SessaoContext'
import { arquivoRepository, exportacaoRepository } from '../../repositories'
import { invalidar } from '../../consultas'

/**
 * Exporta com os filtros atuais. O servidor gera o arquivo, GUARDA no MinIO
 * (Central de Arquivos, finalidade "exportado") e o navegador baixa.
 */
export function BotaoExportar({ chave, filtros, rotulo = 'Exportar CSV' }: { chave: 'carteira' | 'planos-de-acao'; filtros: Partial<FiltrosGlobais>; rotulo?: string }) {
  const { pode } = useSessao()
  const clienteConsultas = useQueryClient()
  const exportacao = useMutation({
    mutationFn: () => exportacaoRepository.exportar(chave, filtros),
    onSuccess: (arquivo) => {
      window.location.assign(arquivoRepository.urlConteudo(arquivo.id))
      void invalidar(clienteConsultas, 'arquivos')
    },
  })
  if (!pode('analista')) return null
  const estado = exportacao.isPending ? 'gerando' : exportacao.isSuccess ? 'ok' : exportacao.isError ? 'erro' : 'livre'
  const mensagem = exportacao.isSuccess
    ? 'Exportado e guardado na Central de Arquivos.'
    : exportacao.error instanceof ErroApi
      ? exportacao.error.message
      : 'Não foi possível exportar.'
  const exportar = () => exportacao.mutate()

  return (
    <span className="flex flex-col items-start gap-1 sm:items-end">
      <button type="button" className="botao-secundario min-h-11" disabled={estado === 'gerando'} onClick={exportar}>
        <FileDown className="h-4 w-4" /> {estado === 'gerando' ? 'Gerando…' : rotulo}
      </button>
      {(estado === 'ok' || estado === 'erro') && (
        <span role="status" className="text-xs" style={{ color: estado === 'ok' ? 'var(--cor-normal)' : 'var(--cor-critico)' }}>
          {mensagem}
        </span>
      )}
    </span>
  )
}
