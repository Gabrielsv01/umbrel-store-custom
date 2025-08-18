import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'public/index.html',
        dashboard: 'public/dashboard.html'
      }
    }
  }
});