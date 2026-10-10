/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography'
import defaultTheme from 'tailwindcss/defaultTheme'

// Kept from the Tailwind 3 setup and loaded with @config (src/index.css).
export default {
  theme: {
    extend: {
      colors: {
        espresso: '#6b3e26',
      },
      fontFamily: {
        display: ['"Outfit Variable"', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [typography],
}
