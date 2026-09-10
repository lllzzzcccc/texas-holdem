import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  // 应用统一挂在 /texas-holdem 前缀下（后端原生支持，本地与生产行为一致）
  base: '/texas-holdem/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 后端原生监听带前缀的路径，原样转发即可
      '/texas-holdem/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
