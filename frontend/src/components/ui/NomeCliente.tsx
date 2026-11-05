import { formatarDocumento } from '@monitoramento/dominio'

/** Nome do cliente sempre acompanhado do CPF/CNPJ (padrão das listas). */
export function NomeCliente({ nome, documento, className = '' }: { nome: string | null | undefined; documento?: string | null; className?: string }) {
  return (
    <span className={`flex min-w-0 flex-col ${className}`}>
      <span className="break-words font-medium" style={{ color: 'var(--cor-primaria)' }}>
        {nome ?? '—'}
      </span>
      {documento && (
        <span className="numeros-tabulares text-[11px] font-normal" style={{ color: 'var(--cor-texto-secundario)' }}>
          {formatarDocumento(documento)}
        </span>
      )}
    </span>
  )
}
