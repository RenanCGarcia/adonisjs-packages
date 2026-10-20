import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The console calls the playground's routes on its own origin, so the browser never needs CORS.
const playground = process.env.PLAYGROUND_URL ?? 'http://localhost:3333'
const proxy = { '/inbox': playground, '/api': playground }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  preview: { proxy },
})
