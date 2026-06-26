import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const resolveGitSha = () => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'local'
  }
}

const appBuildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || resolveGitSha()
const appBuildTime = new Date().toISOString()

const buildVersionPlugin = (): Plugin => ({
  name: 'app-build-version',
  writeBundle(outputOptions) {
    const outDir = outputOptions.dir || 'dist'
    const outputPath = resolve(process.cwd(), outDir, 'version.json')

    mkdirSync(resolve(process.cwd(), outDir), { recursive: true })
    writeFileSync(
      outputPath,
      JSON.stringify(
        {
          buildId: appBuildId,
          buildTime: appBuildTime
        },
        null,
        2
      )
    )
  }
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), buildVersionPlugin()],
  define: {
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
    __APP_BUILD_TIME__: JSON.stringify(appBuildTime)
  },
  server: {
    port: 5175,
    host: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          maps: ['@vis.gl/react-google-maps'],
          charts: ['recharts'],
          dnd: ['@hello-pangea/dnd']
        }
      }
    }
  }
})
