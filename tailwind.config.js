/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#fbfaf7',
          card: '#ffffff',
          sunk: '#f3f1ec',
        },
        ink: {
          DEFAULT: '#1c1b18',
          soft: '#57534e',
          faint: '#a8a29e',
        },
        accent: {
          DEFAULT: '#0f766e',
          soft: '#ccfbf1',
          ink: '#134e4a',
        },
      },
      fontFamily: {
        quran: ['"Amiri Quran"', '"Scheherazade New"', 'serif'],
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
