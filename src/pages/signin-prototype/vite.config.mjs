import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repository = fileURLToPath(new URL('../../..', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../public', import.meta.url)),
  envDir: false,
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5175, strictPort: true, fs: { allow: [repository] } },
})
