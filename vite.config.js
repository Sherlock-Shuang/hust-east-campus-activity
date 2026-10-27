import { defineConfig } from 'vite';
export default defineConfig({base:'./',build:{target:'es2022',chunkSizeWarningLimit:850,rollupOptions:{input:{campus:'index.html',admin:'admin.html'}}},server:{host:'127.0.0.1'}});
