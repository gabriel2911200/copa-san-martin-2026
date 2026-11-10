import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config.ts'

// No .env files from the project; browser requests can only target a fake local API.
export default mergeConfig(base, defineConfig({
  envDir: false,
  // Disposable databases and extracted tools are not application sources.
  server: { watch: { ignored: ['**/.tools/**', '**/test-results/**', '**/.tmp-sql-check/**'] } },
  optimizeDeps: { entries: ['index.html'] },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:59999'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-tests-only'),
  },
}))
