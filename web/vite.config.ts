import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // Separa las librerías grandes en trozos propios: el principal baja de tamaño y los gráficos (Recharts) solo se descargan
    // al abrir una pestaña con gráficos; el navegador además cachea cada trozo por separado entre versiones.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'vendor-graficos', test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|es-toolkit|immer|redux|react-redux|reselect|@reduxjs|decimal\.js-light|internmap|eventemitter3|tiny-invariant|clsx)[\\/]/, priority: 20 },
            { name: 'vendor-iconos', test: /node_modules[\\/]lucide-react[\\/]/, priority: 20 },
            { name: 'vendor-zod', test: /node_modules[\\/]zod[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
})
