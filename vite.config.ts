import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { randomUUID } from 'node:crypto'

const version = randomUUID()
const versionDocument = JSON.stringify({ version })

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  plugins: [react(), tailwindcss(), {
    name: 'deployment-version',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: versionDocument }) },
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(versionDocument)
      })
    },
  }],
})
