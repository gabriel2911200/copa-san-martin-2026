import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig(base, {
  use: { ...base.use, baseURL: 'http://127.0.0.1:5175' },
  webServer: [{
    command: 'node tests/local-read-api.mjs',
    url: 'http://127.0.0.1:59999/health', reuseExistingServer: false,
  }, {
    command: 'node node_modules/vite/bin/vite.js --config tests/vite.isolated.config.ts --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175', reuseExistingServer: false,
  }],
})
