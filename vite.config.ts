import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const ROOT = path.dirname(new URL(import.meta.url).pathname)
const DATA_DIR = path.join(ROOT, 'data')

/**
 * Serve the generated data/ shards at /data in dev, and copy them into
 * dist/data at build time — mirroring the deployed layout where the data
 * branch is copied alongside the built app.
 */
function dataShards(): Plugin {
  return {
    name: 'sandstorm-data-shards',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0] ?? ''
        const file = path.join(DATA_DIR, rel)
        if (!file.startsWith(DATA_DIR + path.sep)) return next()
        if (existsSync(file) && statSync(file).isFile()) {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-cache')
          createReadStream(file).pipe(res)
        } else {
          next()
        }
      })
    },
    closeBundle() {
      if (existsSync(DATA_DIR)) {
        cpSync(DATA_DIR, path.join(ROOT, 'dist', 'data'), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), dataShards()],
})
