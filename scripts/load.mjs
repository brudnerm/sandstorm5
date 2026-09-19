/**
 * Load check: what each Trophy Room wing actually costs to open.
 *
 * Point it at a production preview rather than the dev server, because the
 * dev server ships unminified modules and no compression, so its numbers
 * describe nothing anyone will experience.
 *
 * The thing being checked is that each wing fetches only the shards it needs.
 * The landing page should not pull the transaction log; the records wing
 * should not pull the curated content.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/load.mjs --base http://localhost:4173
 */
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { launchChrome, evaluate, loadPage, sleep } from './chrome.mjs'

/**
 * What a shard costs over the wire.
 *
 * `vite preview` serves uncompressed, so its transfer sizes are not what
 * anyone experiences: GitHub Pages compresses. This reads the built file and
 * measures it the way it will actually be sent.
 */
function compressedSize(name) {
  const file = path.join('dist', 'data', name)
  if (!existsSync(file)) return null
  return gzipSync(readFileSync(file)).length
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const base = flag('base', 'http://localhost:4173')
const league = flag('league', 'kp')
const width = Number(flag('width', 390))
const routes = flag('routes', [
  'trophy', 'trophy/champions', 'trophy/records', 'trophy/owners',
  'trophy/rivalries', 'trophy/shame', 'trophy/archive', 'trophy/museum',
].join(',')).split(',')

const MEASURE = `(() => {
  const entries = performance.getEntriesByType('resource')
  const data = entries.filter(e => e.name.includes('/data/'))
  const sum = list => list.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0)
  return {
    shards: data.map(e => ({
      name: e.name.split('/').slice(-2).join('/'),
      bytes: e.transferSize || e.encodedBodySize || 0,
      ms: Math.round(e.duration),
    })).sort((a, b) => b.bytes - a.bytes),
    dataBytes: sum(data),
    totalBytes: sum(entries),
    requests: entries.length,
    domContentLoaded: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? 0),
  }
})()`

const chrome = await launchChrome({ port: 9336, profile: '/tmp/sandstorm-load-profile' })
const kb = n => `${(n / 1024).toFixed(0)} KB`
const rows = []
try {
  for (const route of routes) {
    await loadPage(chrome.send, { url: `${base}/#/${league}/${route}`, width, height: 844, theme: 'dark', scale: 1 })
    // Give the wing's own fetches time to land.
    await sleep(1200)
    const m = await evaluate(chrome.send, MEASURE)
    const compressed = m.shards.reduce((total, s) => {
      const name = s.name.replace(/^.*\/data\//, '')
      return total + (compressedSize(s.name.includes('manifest') ? 'manifest.json' : `kp/trophy/${name.split('/').pop()}`) ?? 0)
    }, 0)
    rows.push({ route, ...m, compressed })
    console.log(
      `${route.padEnd(22)} data ${kb(m.dataBytes).padStart(8)} raw, ${kb(compressed).padStart(7)} compressed  ` +
      m.shards.map(s => s.name.split('/').pop()).join(', '),
    )
  }
} finally {
  chrome.close()
}

const worst = rows.reduce((a, b) => (b.compressed > a.compressed ? b : a))
const appBytes = rows[0] ? rows[0].totalBytes - rows[0].dataBytes : 0
console.log(`\nHeaviest wing: ${worst.route} at ${kb(worst.compressed)} of data, compressed.`)
console.log(`The app itself is about ${kb(appBytes)} raw on top, and is cached after the first visit.`)
console.log('Raw figures come from the preview server, which does not compress; GitHub Pages does.')
