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
    // 允许局域网访问（手机扫码入局需从同一 Wi-Fi 访问 Vite 前端）
    host: true,
    proxy: {
      // 后端原生监听带前缀的路径，原样转发即可
      '/texas-holdem/api': {
        target: 'http://localhost:3000',
      },
      '/texas-holdem/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
