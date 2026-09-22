import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/api/ui/v0/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
