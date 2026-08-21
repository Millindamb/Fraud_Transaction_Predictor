/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0E1726',
        slate1: '#5A6B7C',
        paper: '#EEF1F5',
        surface: '#FFFFFF',
        line: '#D8DFE7',
        rules: '#16794F',
        ml: '#5B4BD6',
        band: {
          low: '#16794F',
          medium: '#B26B00',
          high: '#D2601A',
          critical: '#B4231B',
        },
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(14,23,38,0.06), 0 1px 12px rgba(14,23,38,0.04)',
      },
      borderRadius: { card: '10px' },
    },
  },
  plugins: [],
};
