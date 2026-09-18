/**
 * Minimal headless-Chrome driver over the DevTools protocol, using Node's
 * built-in fetch and WebSocket so neither of the scripts that need it adds a
 * dependency.
 *
 * Shared by screenshot.mjs and contrast.mjs. Both need the same awkward bit:
 * the app stores its light/dark choice in localStorage, which no Chrome flag
 * can set, so a page has to be loaded once, seeded, and reloaded before it
 * renders in the theme you asked for.
 */
import { spawn } from 'node:child_process'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function launchChrome({ port = 9333, profile = '/tmp/sandstorm-shot-profile' } = {}) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let target
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find(t => t.type === 'page')
      if (target) break
    } catch { /* not up yet */ }
    await sleep(250)
  }
  if (!target) {
    chrome.kill()
    throw new Error('Chrome never opened its debugging port')
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
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

  return {
    send,
    close() { ws.close(); chrome.kill() },
  }
}

/** Evaluate an expression in the page and return its value. */
export async function evaluate(send, expression) {
  const { result } = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  })
  return result.value
}

/**
 * Load `url` at a given viewport in a given stored theme, and fail loudly if
 * the theme that rendered is not the one asked for.
 */
export async function loadPage(send, { url, width, height, theme, scale = 2 }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: width < 768,
  })
  // A second navigate to the same document would only change the hash and
  // would not re-run the pre-paint theme script, so seed and reload instead.
  await send('Page.navigate', { url })
  await sleep(1200)
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('ss5-theme', ${JSON.stringify(theme)})`,
  })
  await send('Page.reload', { ignoreCache: false })
  await sleep(1800)
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' })
  await sleep(500)

  const state = await evaluate(send, `({
    theme: document.documentElement.dataset.theme,
    height: document.documentElement.scrollHeight,
  })`)
  if (state.theme !== theme) {
    throw new Error(`theme did not apply at ${url}: wanted ${theme}, page is ${state.theme}`)
  }
  return state
}
