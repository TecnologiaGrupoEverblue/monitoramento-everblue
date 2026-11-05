import { Children, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Grade que se ajusta à largura disponível e equilibra as linhas: com 5 cartões
 * e espaço para 4, monta 3 + 2 (os da última linha crescem para ocupar a
 * largura), em vez de 4 + 1 com um cartão sozinho e um buraco ao lado.
 */
export function GradeEquilibrada({ children, larguraMinima = 250, espaco = 6 }: { children: ReactNode; larguraMinima?: number; espaco?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => setLargura(e.contentRect.width))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const itens = Children.toArray(children).filter(Boolean)
  const cabem = Math.max(1, Math.floor((largura + espaco) / (larguraMinima + espaco)))
  const linhas = Math.ceil(itens.length / cabem)
  const porLinha = Math.max(1, Math.ceil(itens.length / Math.max(1, linhas)))
  const base = `calc((100% - ${(porLinha - 1) * espaco}px) / ${porLinha})`
  return (
    <div ref={ref} className="flex flex-wrap" style={{ gap: espaco }}>
      {itens.map((item, i) => (
        <div key={i} className="flex min-w-0" style={{ flex: `1 1 ${base}`, maxWidth: largura ? undefined : '100%' }}>
          {item}
        </div>
      ))}
    </div>
  )
}
