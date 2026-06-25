import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}','./components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: { colors: { navy: { 950: '#060e1c', 900: '#091526', 800: '#0c1e35' } } } },
  plugins: [],
}
export default config
