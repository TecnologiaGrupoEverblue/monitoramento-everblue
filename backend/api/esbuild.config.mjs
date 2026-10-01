// Empacota a API num único arquivo por ponto de entrada. As dependências de
// node_modules ficam de fora (instaladas na imagem com `npm ci --omit=dev`);
// o pacote de domínio do monorepo entra no pacote, porque é código-fonte TS.
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pacote = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const externos = Object.keys(pacote.dependencies ?? {}).filter((nome) => !nome.startsWith('@monitoramento/'))

await build({
  entryPoints: ['src/principal.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...externos, ...externos.map((nome) => `${nome}/*`)],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
})
