/*
 * WCAG contrast audit for the theme tokens, both light and dark.
 *
 * Exists because palette.css is designed to be swapped: a rebrand that only
 * looks right in dark mode, or that passes against the page but fails against
 * the slightly-darker card surface, is easy to ship by eye. Run this after
 * changing any colour.
 *
 *   npm run check:contrast
 *
 * The values below mirror palette.css / theme.css. Keep them in step -- this
 * reads no CSS, deliberately, so it stays dependency-free.
 */

const N = {
  0: '#0b0b0c',
  50: '#17181b',
  100: '#232529',
  200: '#34373d',
  300: '#4b4f57',
  400: '#71757e',
  500: '#9598a1',
  600: '#b8bac1',
  700: '#d4d6da',
  800: '#e7e8ea',
  900: '#f4f4f5',
  1000: '#ffffff',
}

const ACCENT = '#ffd400'
const ACCENT_DEEP = '#856800'
const DANGER = '#e10600'
const DANGER_DEEP = '#b00500'
const DANGER_LIGHT = '#ff4d47'

const themes = {
  light: {
    bg: N[1000],
    surface: N[900],
    'surface-raised': N[1000],
    edge: N[600],
    fg: N[0],
    'fg-muted': N[300],
    'fg-subtle': N[400],
    accent: ACCENT,
    'accent-fg': N[0],
    'accent-text': ACCENT_DEEP,
    danger: DANGER,
    'danger-fg': N[1000],
    'danger-text': DANGER_DEEP,
  },
  dark: {
    bg: N[0],
    surface: N[50],
    'surface-raised': N[100],
    edge: N[200],
    fg: N[900],
    'fg-muted': N[600],
    'fg-subtle': N[400],
    accent: ACCENT,
    'accent-fg': N[0],
    'accent-text': ACCENT,
    danger: DANGER,
    'danger-fg': N[1000],
    'danger-text': DANGER_LIGHT,
  },
}

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

/*
 * [foreground, background, label, minimum]
 *   4.5 -- WCAG AA for normal text
 *   3.0 -- AA for large/bold text
 *   1.5 -- local floor for decorative separators. Borders here only reinforce
 *          grouping that surface colour already conveys, so the 3:1 of SC 1.4.11
 *          (which governs boundaries carrying meaning on their own) is stricter
 *          than this case needs.
 */
const pairs = [
  ['fg', 'bg', 'body text on page', 4.5],
  ['fg', 'surface', 'body text on card', 4.5],
  ['fg-muted', 'bg', 'muted text on page', 4.5],
  ['fg-muted', 'surface', 'muted text on card', 4.5],
  ['fg-subtle', 'surface', 'subtle text on card', 3.0],
  ['accent-text', 'bg', 'accent text on page', 4.5],
  ['accent-text', 'surface', 'accent text on card', 4.5],
  ['accent-fg', 'accent', 'text on accent fill', 4.5],
  ['danger-fg', 'danger', 'text on danger fill', 3.0],
  ['danger-text', 'surface', 'danger text on card', 4.5],
  ['edge', 'bg', 'border against page', 1.5],
]

let failures = 0

for (const [name, tokens] of Object.entries(themes)) {
  console.log(`\n=== ${name} ===`)
  for (const [fg, bg, label, min] of pairs) {
    const value = ratio(tokens[fg], tokens[bg])
    const ok = value >= min
    if (!ok) failures++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${value.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`,
    )
  }
}

console.log(`\n${failures === 0 ? 'All pairs pass.' : `${failures} FAILING PAIR(S)`}`)
process.exit(failures === 0 ? 0 : 1)
