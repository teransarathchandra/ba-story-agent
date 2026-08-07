import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

function copySchemaPlugin() {
  return {
    name: 'copy-schema-sql',
    buildStart() {
      const src = resolve(__dirname, '../src/store/schema.sql')
      const destDir = resolve(__dirname, 'out/main')
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }
      copyFileSync(src, resolve(destDir, 'schema.sql'))
    },
    writeBundle() {
      const src = resolve(__dirname, '../src/store/schema.sql')
      const destDir = resolve(__dirname, 'out/main')
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }
      copyFileSync(src, resolve(destDir, 'schema.sql'))
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          'electron',
          'better-sqlite3',
          'node-llama-cpp',
        ],
      },
    },
    plugins: [externalizeDepsPlugin(), copySchemaPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
      },
    },
    plugins: [react()],
  },
})
