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
          // Accent colors — identical in dark and light modes
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
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        mono:    ['"DM Mono"', 'monospace'],
        sans:    ['Inter', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
