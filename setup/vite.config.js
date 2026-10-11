import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/setup/',
  esbuild: { jsx: 'automatic' },
  build: { outDir: fileURLToPath(new URL('../dist-setup', import.meta.url)), emptyOutDir: true },
})
