import { useState } from 'react'
import type { ClienteEnriquecido, StatusCliente } from '../models/types'
import { useSessao } from '../contexts/SessaoContext'
import ModoRevisao from './ModoRevisao'

/** Botão que abre o Modo de Revisão do Comitê para a lista de clientes da
 * tela atual (Monitoramento, Saída de Risco ou Jurídico). Ao encerrar,
 * avisa o chamador se decisões foram registradas para que a lista recarregue. */
export default function BotaoModoRevisao({
  clientes,
  statusAtual,
  aoConcluir,
}: {
  clientes: ClienteEnriquecido[]
  statusAtual: StatusCliente
  aoConcluir: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const { pode } = useSessao()
  // Registrar decisões exige perfil de analista; consulta segue liberada nas telas.
  if (!pode('analista')) return null

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        disabled={clientes.length === 0}
        className="botao-primario"
      >
        Iniciar Revisão do Comitê →
      </button>
      {aberto && (
        <ModoRevisao
          clientes={clientes}
          statusAtual={statusAtual}
          aoFechar={(houveDecisoes) => {
            setAberto(false)
            if (houveDecisoes) aoConcluir()
          }}
        />
      )}
    </>
  )
}
