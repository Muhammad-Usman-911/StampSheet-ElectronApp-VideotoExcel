import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Strict Content-Security-Policy for the packaged app only (the dev server needs inline scripts for hot reload).
const csp = {
  name: 'csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:">`),
};

// The renderer UI lives in ui/ and is built into ui-dist/, which Electron loads from disk.
export default defineConfig({
  root: path.resolve(__dirname, 'ui'),
  base: './',
  plugins: [react(), tailwindcss(), csp],
  resolve: { alias: { '@': path.resolve(__dirname, 'ui/src') } },
  build: { outDir: path.resolve(__dirname, 'ui-dist'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5173, strictPort: true },
});
