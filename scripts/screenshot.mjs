/**
 * Deterministic page screenshots, for design review and for the record.
 *
 * Drives headless Chrome over the DevTools protocol using Node's built-in
 * fetch and WebSocket, so it adds no dependencies. Control over the theme is
 * the point: the app stores its light/dark choice in localStorage, which no
 * Chrome command-line flag can set, so the script sets it directly before the
 * page paints and reloads.
 *
 *   node scripts/screenshot.mjs --out docs/trophy-room/screenshots \
 *     --url 'http://localhost:5173/#/kp/trophy' \
 *     --name trophy-landing --width 1200 --height 900 --theme dark [--full]
 *
 * Repeat --theme and --size to capture a matrix in one Chrome session.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333

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
const themes = flags('theme').length ? flags('theme') : ['light']
const sizes = flags('size').length
  ? flags('size').map(s => s.split('x').map(Number))
  : [[Number(flag('width', 1200)), Number(flag('height', 900))]]

if (!url) {
  console.error('--url is required')
  process.exit(1)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  '--no-first-run',
  '--user-data-dir=/tmp/sandstorm-shot-profile',
  'about:blank',
], { stdio: 'ignore' })

let ws
try {
  // Wait for the debugging endpoint to answer.
  let target
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find(t => t.type === 'page')
      if (target) break
    } catch { /* not up yet */ }
    await sleep(250)
  }
  if (!target) throw new Error('Chrome never opened its debugging port')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('could not attach to Chrome'))
  })

  let nextId = 1
  const pending = new Map()
  ws.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  }
  const send = (method, params = {}) => {
    const id = nextId++
    ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }

  await send('Page.enable')
  await send('Runtime.enable')
  mkdirSync(out, { recursive: true })

  for (const [width, height] of sizes) {
    for (const theme of themes) {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 2, mobile: width < 768,
      })
      // Load the real URL, seed the stored theme, then RELOAD. A second
      // navigate would be a same-document hash change and would not re-run
      // the pre-paint theme script in index.html, so the page would keep
      // whatever the OS preference gave it the first time.
      await send('Page.navigate', { url })
      await sleep(1200)
      await send('Runtime.evaluate', {
        expression: `localStorage.setItem('ss5-theme', ${JSON.stringify(theme)})`,
      })
      await send('Page.reload', { ignoreCache: false })
      await sleep(1800)
      // Settle: fonts, the data fetch, and the tab-strip scroll effect.
      await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
      await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' })
      await sleep(500)

      const { result } = await send('Runtime.evaluate', {
        expression: `({t: document.documentElement.dataset.theme, h: document.documentElement.scrollHeight})`,
        returnByValue: true,
      })
      if (result.value.t !== theme) {
        throw new Error(`theme did not apply: wanted ${theme}, page is ${result.value.t}`)
      }

      if (full) {
        await send('Emulation.setDeviceMetricsOverride', {
          width, height: Math.min(result.value.h, 4000), deviceScaleFactor: 2, mobile: width < 768,
        })
        await sleep(400)
      }

      const shot = await send('Page.captureScreenshot', { format: 'png' })
      const file = path.join(out, `${name}-${width}x${height}-${theme}.png`)
      writeFileSync(file, Buffer.from(shot.data, 'base64'))
      console.log(`wrote ${file}`)
    }
  }
} finally {
  ws?.close()
  chrome.kill()
}
