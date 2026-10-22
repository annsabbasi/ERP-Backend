import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // VITE_* variables come from the workspace .env
  envDir: '../..',
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
