import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/main.tsx',
        'src/types/**',
      ],
      // Baseline thresholds: measured coverage is ~2.8% statements / 2.8%
      // branches / 1.8% functions / 2.9% lines (7 test files, utils only).
      // Ratchet these up as tests are added for stores, pages and a11y utils.
      thresholds: {
        statements: 2.5,
        branches: 2.5,
        functions: 1.5,
        lines: 2.5,
      },
    },
  },
})
