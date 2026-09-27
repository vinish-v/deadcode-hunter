import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths for VS Code webview compatibility
  server: {
    port: 5173,
    host: true
  }
})
