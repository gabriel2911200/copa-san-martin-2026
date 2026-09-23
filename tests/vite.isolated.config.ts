import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config.ts'

// No .env files from the project; browser requests can only target a fake local API.
export default mergeConfig(base, defineConfig({
  envDir: false,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:59999'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-tests-only'),
  },
}))
