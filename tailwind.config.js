/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'teal': {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
        'cyan': {
          400: '#22d3ee',
          500: '#06b6d4',
        },
        'emerald': {
          400: '#34d399',
          500: '#10b981',
        }
      },
    },
  },
  plugins: [],
}

