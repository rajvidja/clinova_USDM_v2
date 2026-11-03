/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 900: '#0b1a33', 800: '#12264a', 700: '#1b3563', 600: '#25467f' },
        brand: { 50: '#ecfbf8', 100: '#d0f5ee', 500: '#14a38b', 600: '#0f8a75', 700: '#0c6f5e' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
