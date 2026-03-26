/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        vs: {
          bg: '#080A10',
          card: '#111620',
          card2: '#161D2A',
          border: '#1E2738',
          borderLight: '#283448',
          text: '#E4E7EE',
          soft: '#94A0B8',
          dim: '#5A6A82',
          blue: '#4E94F8',
          green: '#38D89A',
          red: '#F25C5C',
          amber: '#E8AA30',
          violet: '#9B7AF5',
          rose: '#E070A0',
          orange: '#E88A3A',
          cyan: '#38C8D8',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        mono: ['"DM Mono"', 'monospace'],
        sans: ['Inter', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
