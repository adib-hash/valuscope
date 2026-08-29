/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CSS-variable-backed colors — auto-switch between light and dark themes
        vs: {
          bg:          'rgb(var(--vs-bg)          / <alpha-value>)',
          card:        'rgb(var(--vs-card)        / <alpha-value>)',
          card2:       'rgb(var(--vs-card2)       / <alpha-value>)',
          border:      'rgb(var(--vs-border)      / <alpha-value>)',
          borderLight: 'rgb(var(--vs-borderLight) / <alpha-value>)',
          text:        'rgb(var(--vs-text)        / <alpha-value>)',
          soft:        'rgb(var(--vs-soft)        / <alpha-value>)',
          dim:         'rgb(var(--vs-dim)         / <alpha-value>)',
          // Accent colors — each has its own light and dark value in index.css,
          // tuned so every one clears WCAG AA on its theme's surfaces.
          blue:   'rgb(var(--vs-blue)   / <alpha-value>)',
          green:  'rgb(var(--vs-green)  / <alpha-value>)',
          red:    'rgb(var(--vs-red)    / <alpha-value>)',
          amber:  'rgb(var(--vs-amber)  / <alpha-value>)',
          violet: 'rgb(var(--vs-violet) / <alpha-value>)',
          rose:   'rgb(var(--vs-rose)   / <alpha-value>)',
          orange: 'rgb(var(--vs-orange) / <alpha-value>)',
          cyan:   'rgb(var(--vs-cyan)   / <alpha-value>)',
        },
      },
      // The type scale. Dense-terminal on purpose: tables stay at 11px, but
      // nothing sits below 10px and secondary text reads at 12px. During
      // migration the default Tailwind sizes keep working; when the sweep is
      // done, only these seven should appear in src/.
      fontSize: {
        micro:   ['10px', { lineHeight: '1.35' }], // mono uppercase labels, badges, footnotes
        dense:   ['11px', { lineHeight: '1.45' }], // table cells — density is the point
        label:   ['12px', { lineHeight: '1.5'  }], // buttons, nav, links, secondary text
        body:    ['13px', { lineHeight: '1.55' }], // chip values, prices, settings rows
        prose:   ['15px', { lineHeight: '1.65' }], // reading text, serif card titles
        title:   ['22px', { lineHeight: '1.25' }], // logo, modal titles, big stat values
        display: ['28px', { lineHeight: '1.15' }], // page headings
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        mono:    ['"DM Mono"', 'monospace'],
        sans:    ['Inter', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
