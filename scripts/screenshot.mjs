/**
 * Deterministic page screenshots, for design review and for the record.
 *
 * Drives headless Chrome through scripts/chrome.mjs. Control over the theme
 * is the point: the app stores its light/dark choice in localStorage, which
 * no Chrome command-line flag can set, so the page is seeded and reloaded,
 * and the capture fails loudly if the wrong theme rendered.
 *
 *   node scripts/screenshot.mjs --out docs/trophy-room/screenshots \
 *     --url 'http://localhost:5173/#/kp/trophy' \
 *     --name trophy-landing --width 1200 --height 900 --theme dark [--full]
 *
 * Repeat --theme and --size to capture a matrix in one Chrome session.
 * --eval runs a snippet in the page after it loads and before the capture,
 * for pages whose interesting state lives in the component rather than the
 * URL (a selected category, an expanded table).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchChrome, loadPage, sleep } from './chrome.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const flags = name => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []))

const url = flag('url')
const out = flag('out', 'screenshots')
const name = flag('name', 'shot')
const full = args.includes('--full')
const evalSnippet = flag('eval')
const themes = flags('theme').length ? flags('theme') : ['light']
const sizes = flags('size').length
  ? flags('size').map(s => s.split('x').map(Number))
  : [[Number(flag('width', 1200)), Number(flag('height', 900))]]

if (!url) {
  console.error('--url is required')
  process.exit(1)
}

const chrome = await launchChrome()
try {
  mkdirSync(out, { recursive: true })
  for (const [width, height] of sizes) {
    for (const theme of themes) {
      const state = await loadPage(chrome.send, { url, width, height, theme })
      if (evalSnippet) {
        const { result } = await chrome.send('Runtime.evaluate', {
          expression: `(async () => { ${evalSnippet} })()`,
          awaitPromise: true, returnByValue: true,
        })
        if (result?.subtype === 'error') throw new Error(`--eval failed: ${result.description}`)
        await sleep(600)
      }
      if (full) {
        await chrome.send('Emulation.setDeviceMetricsOverride', {
          width, height: Math.min(state.height, 4000), deviceScaleFactor: 2, mobile: width < 768,
        })
        await sleep(400)
      }
      const shot = await chrome.send('Page.captureScreenshot', { format: 'png' })
      const file = path.join(out, `${name}-${width}x${height}-${theme}.png`)
      writeFileSync(file, Buffer.from(shot.data, 'base64'))
      console.log(`wrote ${file}`)
    }
  }
} finally {
  chrome.close()
}
