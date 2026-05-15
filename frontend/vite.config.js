import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const certDir = path.resolve(process.cwd(), 'certs')
const certPath = path.join(certDir, 'localhost.pem')
const keyPath = path.join(certDir, 'localhost-key.pem')
const httpsConfig = fs.existsSync(certPath) && fs.existsSync(keyPath)
  ? {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    https: httpsConfig,
    allowedHosts: ['.local', 'shortcuts-reynolds-smoke-eyes.trycloudflare.com'],
  },
  preview: {
    host: '0.0.0.0',
    https: httpsConfig,
  },
})
