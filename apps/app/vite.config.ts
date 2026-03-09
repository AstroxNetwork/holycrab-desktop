import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  envDir: path.resolve(__dirname, '../..'),
  envPrefix: ['VITE_', 'HOLYCRAB_'],
  plugins: [tailwindcss(), TanStackRouterVite(), react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ui': path.resolve(__dirname, '../../packages/ui'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
})
