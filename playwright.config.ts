import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', channel: 'msedge', viewport: { width: 390, height: 844 } },
})
