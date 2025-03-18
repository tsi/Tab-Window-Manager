import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        popup: 'popup.html',
        background: 'background.js'
      }
    }
  }
});