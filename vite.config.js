import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // /api routes are Vercel serverless functions; use `vercel dev` for local testing
  },
});
