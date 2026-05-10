import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0f1117', soft: '#171a23', mute: '#1f2330' },
        border: { DEFAULT: '#262a36' },
        fg: { DEFAULT: '#e5e7ee', mute: '#9ba3b4' },
        accent: { DEFAULT: '#5b9dff', hover: '#7aafff' }
      },
      fontFamily: {
        mono: ['Cascadia Code', 'Yu Gothic Mono', 'MS Gothic', 'monospace']
      }
    }
  },
  plugins: []
} satisfies Config
