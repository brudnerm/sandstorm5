/**
 * WCAG AA contrast audit for the Trophy Room, run against the real page in
 * both themes at a phone width.
 *
 * Measuring computed colour is harder than it looks, and two artifacts bit
 * this audit before it was trustworthy:
 *
 *   - `color-mix()` computes to `color(srgb r g b / a)` with 0-1 floats, not
 *     0-255. Read naively, a near-white chip measures as near-black.
 *   - A translucent background has to be composited over what is behind it.
 *     Taking its colour at face value reports a highlight as its own accent.
 *
 * Both are handled below, so a failure here is a real failure.
 *
 *   node scripts/contrast.mjs --base http://localhost:5173
 */
import { launchChrome, evaluate, loadPage } from './chrome.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const base = flag('base', 'http://localhost:5173')
const league = flag('league', 'kp')
const routes = (flag('routes', 'trophy,trophy/champions,trophy/shame,trophy/style')).split(',')
const width = Number(flag('width', 390))
const height = Number(flag('height', 844))

const AUDIT = `(() => {
  const lum = (r, g, b) => {
    const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
  }
  const parse = s => {
    if (!s) return null
    const nums = (s.match(/-?\\d*\\.?\\d+(?:e-?\\d+)?/g) || []).map(Number)
    if (nums.length < 3) return null
    const scale = /^color\\(/.test(s.trim()) ? 255 : 1
    return [nums[0] * scale, nums[1] * scale, nums[2] * scale, nums.length > 3 ? nums[3] : 1]
  }
  const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)) }
  const effectiveBg = el => {
    const layers = []
    let n = el
    while (n) {
      const c = getComputedStyle(n)
      const bi = c.backgroundImage
      if (bi && bi !== 'none') {
        const m = bi.match(/(?:rgba?|color)\\([^)]+\\)/)
        if (m) { const p = parse(m[0]); if (p && p[3] > 0) layers.push(p) }
      }
      const bc = parse(c.backgroundColor)
      if (bc && bc[3] > 0) layers.push(bc)
      n = n.parentElement
    }
    let baseColor = [255, 255, 255]
    for (let i = layers.length - 1; i >= 0; i--) baseColor = over(layers[i], baseColor)
    return baseColor
  }
  const ratio = (f, b) => {
    const L1 = lum(...f), L2 = lum(...b)
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
  }
  const failures = []
  let checked = 0
  for (const el of document.querySelectorAll('.trophy *')) {
    if (!el.firstChild || el.firstChild.nodeType !== Node.TEXT_NODE) continue
    if (!(el.textContent || '').trim()) continue
    const c = getComputedStyle(el)
    if (c.visibility === 'hidden' || c.display === 'none' || Number(c.opacity) === 0) continue
    const fgRaw = parse(c.color)
    if (!fgRaw) continue
    const bg = effectiveBg(el)
    const fg = over(fgRaw, bg)
    const size = parseFloat(c.fontSize)
    const large = size >= 24 || (size >= 18.66 && parseInt(c.fontWeight) >= 700)
    const need = large ? 3 : 4.5
    const r = ratio(fg, bg)
    checked++
    if (r < need) {
      failures.push({
        selector: el.className || el.tagName,
        text: (el.textContent || '').trim().slice(0, 30),
        size, ratio: Math.round(r * 100) / 100, need,
      })
    }
  }
  return { checked, failures }
})()`

const chrome = await launchChrome({ port: 9334, profile: '/tmp/sandstorm-contrast-profile' })
let failed = 0
let total = 0
try {
  for (const theme of ['light', 'dark']) {
    for (const route of routes) {
      const url = `${base}/#/${league}/${route}`
      await loadPage(chrome.send, { url, width, height, theme, scale: 1 })
      const { checked, failures } = await evaluate(chrome.send, AUDIT)
      total += checked
      failed += failures.length
      const label = `${route} (${theme})`.padEnd(34)
      if (failures.length === 0) {
        console.log(`PASS  ${label} ${checked} text nodes`)
      } else {
        console.log(`FAIL  ${label} ${failures.length} of ${checked}`)
        for (const f of failures.slice(0, 8)) {
          console.log(`        ${f.ratio}:1 (needs ${f.need}) ${f.size}px  ${f.selector}  "${f.text}"`)
        }
      }
    }
  }
} finally {
  chrome.close()
}
console.log(`\n${total} text nodes checked, ${failed} below WCAG AA.`)
process.exit(failed > 0 ? 1 : 0)
