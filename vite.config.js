import { defineConfig } from 'vite';
export default defineConfig({base:'./',define:{__CAMPUS_BUILD__:JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA||process.env.CAMPUS_BUILD_ID||'local')},build:{target:'es2022',chunkSizeWarningLimit:850,rollupOptions:{input:{campus:'index.html',admin:'admin.html',c118:'c118.html'}}},server:{host:'127.0.0.1'}});
