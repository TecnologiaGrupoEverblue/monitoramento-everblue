import { useState } from 'react'
import { FileDown } from 'lucide-react'
import type { FiltrosGlobais } from '@monitoramento/dominio'
import { ErroApi } from '../../api/cliente'
import { useSessao } from '../../contexts/SessaoContext'
import { arquivoRepository, exportacaoRepository } from '../../repositories'

/**
 * Exporta com os filtros atuais. O servidor gera o arquivo, GUARDA no MinIO
 * (Central de Arquivos, finalidade "exportado") e o navegador baixa.
 */
export function BotaoExportar({ chave, filtros, rotulo = 'Exportar CSV' }: { chave: 'carteira' | 'planos-de-acao'; filtros: Partial<FiltrosGlobais>; rotulo?: string }) {
  const { pode } = useSessao()
  const [estado, setEstado] = useState<'livre' | 'gerando' | 'ok' | 'erro'>('livre')
  const [mensagem, setMensagem] = useState('')
  if (!pode('analista')) return null

  async function exportar() {
    setEstado('gerando')
    try {
      const arquivo = await exportacaoRepository.exportar(chave, filtros)
      window.location.assign(arquivoRepository.urlConteudo(arquivo.id))
      setEstado('ok')
      setMensagem('Exportado e guardado na Central de Arquivos.')
    } catch (e) {
      setEstado('erro')
      setMensagem(e instanceof ErroApi ? e.message : 'Não foi possível exportar.')
    }
  }

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
