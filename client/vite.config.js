import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/embed/',
  server: {
    port: 5173,
    proxy:{
      '/api': 'htps://localhost:3000',
      '/socket.io': {
        target: 'https://localhost:3000',
        ws: true,
      }
    }
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
})
