import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const mod = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/setup/',
  esbuild: { jsx: 'automatic' },
  define: {
    __VOICEMESH_COMPOSER_VERSION__: JSON.stringify(lock.packages['node_modules/@voicemesh/composer'].version),
    __VOICE_MOD_VERSION__: JSON.stringify(mod.version),
  },
  build: { outDir: fileURLToPath(new URL('../dist-setup', import.meta.url)), emptyOutDir: true },
})
