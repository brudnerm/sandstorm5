/**
 * Structural accessibility audit for the Trophy Room, run against the real
 * page in both themes.
 *
 * Contrast has its own script. This covers the things contrast cannot see:
 * heading order, accessible names, keyboard reachability, visible focus,
 * table semantics and tap-target size.
 *
 *   node scripts/a11y.mjs [--base http://localhost:5173] [--width 390]
 */
import { launchChrome, evaluate, loadPage, sleep } from './chrome.mjs'

/**
 * Whether keyboard focus is actually visible.
 *
 * `element.focus()` does not set :focus-visible in Chrome — the browser only
 * applies it when the focus came from the keyboard — so testing it that way
 * reports a missing focus ring on a page that has one. This drives real Tab
 * presses until focus lands inside the Trophy Room, then reads the outline.
 */
async function checkKeyboardFocus(send) {
  for (let i = 0; i < 40; i++) {
    for (const type of ['rawKeyDown', 'char', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type, windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab', text: '\t',
      })
    }
    const state = await evaluate(send, `(() => {
      const el = document.activeElement
      if (!el || !el.closest('.trophy')) return { inside: false }
      const s = getComputedStyle(el)
      return {
        inside: true,
        label: (el.textContent || '').trim().slice(0, 30),
        outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
        ring: !!s.boxShadow && s.boxShadow !== 'none',
      }
    })()`)
    if (state.inside) {
      return state.outline || state.ring
        ? null
        : `no visible focus ring on "${state.label}" after tabbing to it`
    }
    await sleep(10)
  }
  return null
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const base = flag('base', 'http://localhost:5173')
const league = flag('league', 'kp')
const width = Number(flag('width', 390))
const height = Number(flag('height', 844))
const routes = flag('routes', [
  'trophy', 'trophy/champions', 'trophy/records', 'trophy/owners',
  'trophy/owners/swan', 'trophy/rivalries', 'trophy/shame', 'trophy/archive',
  'trophy/museum', 'trophy/style',
].join(',')).split(',')

const AUDIT = `(() => {
  const issues = []
  const add = (rule, detail) => issues.push({ rule, detail })
  const root = document.querySelector('.trophy') || document.body
  const text = el => (el.textContent || '').trim().slice(0, 40)

  // --- one h1, and no skipped levels
  const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  const h1s = headings.filter(h => h.tagName === 'H1')
  if (h1s.length !== 1) add('one-h1', h1s.length + ' h1 elements')
  let previous = 1
  for (const h of headings) {
    const level = Number(h.tagName[1])
    if (level > previous + 1) add('heading-order', 'jumped from h' + previous + ' to h' + level + ' at "' + text(h) + '"')
    previous = level
  }

  // --- accessible names on everything interactive
  const interactive = [...root.querySelectorAll('a[href], button, [tabindex]')]
  for (const el of interactive) {
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
    if (!name) add('accessible-name', el.tagName + '.' + (el.className || '') + ' has no accessible name')
    const tabindex = el.getAttribute('tabindex')
    if (tabindex !== null && Number(tabindex) > 0) add('positive-tabindex', 'tabindex=' + tabindex)
  }

  // --- tap targets: WCAG 2.2 asks for 24x24 CSS pixels, except for a target
  // sitting inside a sentence, where the line height constrains it. That
  // exception is real and is applied here rather than padded around.
  const isInlineInText = el => {
    const parent = el.parentElement
    if (!parent) return false
    const otherText = [...parent.childNodes]
      .filter(n => n !== el)
      .map(n => (n.textContent || '').trim())
      .join('')
    return otherText.length > 0
  }
  for (const el of interactive) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (isInlineInText(el)) continue
    if (r.height < 24 || r.width < 24) {
      add('tap-target', text(el) + ' is ' + Math.round(r.width) + 'x' + Math.round(r.height))
    }
  }

  // --- table semantics
  for (const table of root.querySelectorAll('table')) {
    if (!table.querySelector('caption')) add('table-caption', 'a table has no caption')
    const headerCells = [...table.querySelectorAll('th')]
    if (headerCells.length === 0) add('table-headers', 'a table has no header cells')
    for (const th of headerCells) {
      if (!th.getAttribute('scope')) add('th-scope', 'a th has no scope: "' + text(th) + '"')
    }
  }

  // --- graphics need a name
  for (const svg of root.querySelectorAll('svg')) {
    const labelled = svg.getAttribute('aria-label') || svg.querySelector('title')
    const hidden = svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-hidden="true"]')
    if (!labelled && !hidden) add('svg-name', 'an svg is neither labelled nor hidden')
  }

  // --- nothing should overflow the viewport sideways
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    add('horizontal-overflow', document.documentElement.scrollWidth + 'px wide in a ' + window.innerWidth + 'px viewport')
  }

  return { issues, counts: { headings: headings.length, interactive: interactive.length, tables: root.querySelectorAll('table').length } }
})()`

const chrome = await launchChrome({ port: 9335, profile: '/tmp/sandstorm-a11y-profile' })
let total = 0
let failed = 0
try {
  for (const theme of ['light', 'dark']) {
    for (const route of routes) {
      const url = `${base}/#/${league}/${route}`
      await loadPage(chrome.send, { url, width, height, theme, scale: 1 })
      const { issues, counts } = await evaluate(chrome.send, AUDIT)
      const focusProblem = await checkKeyboardFocus(chrome.send)
      if (focusProblem) issues.push({ rule: 'focus-visible', detail: focusProblem })
      total += counts.interactive + counts.headings + counts.tables
      failed += issues.length
      const label = `${route} (${theme})`.padEnd(30)
      if (issues.length === 0) {
        console.log(`PASS  ${label} ${counts.headings} headings, ${counts.interactive} controls, ${counts.tables} tables`)
      } else {
        console.log(`FAIL  ${label} ${issues.length} issue(s)`)
        const seen = new Set()
        for (const issue of issues) {
          const key = issue.rule + issue.detail
          if (seen.has(key)) continue
          seen.add(key)
          console.log(`        ${issue.rule}: ${issue.detail}`)
        }
      }
    }
  }
} finally {
  chrome.close()
}
console.log(`\n${total} elements examined at ${width}px, ${failed} issue(s).`)
process.exit(failed > 0 ? 1 : 0)
