import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  // 生产环境通过 https://域名/texas-holdem/ 访问（Nginx 剥离前缀反代到 Node）
  base: '/texas-holdem/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/texas-holdem/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        rewrite: (p) => p.replace(/^\/texas-holdem/, ''),
      },
    },
  },
});
