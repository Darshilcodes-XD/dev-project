/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Manrope', 'sans-serif'],
      },
      colors: {
        ink: '#17233c',
        muted: '#75819a',
        line: '#e8ecf3',
        canvas: '#f7f8fc',
        brand: '#4f62d8',
      },
      boxShadow: {
        soft: '0 8px 28px rgba(27, 42, 79, 0.055)',
        panel: '0 3px 14px rgba(27, 42, 79, 0.045)',
      },
    },
  },
  plugins: [],
}
