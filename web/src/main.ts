import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { unlockAudio } from './utils/sound';
import './style.css';

// 浏览器自动播放策略：首次交互时解锁音频
window.addEventListener('pointerdown', unlockAudio, { once: true });

createApp(App).use(createPinia()).use(router).mount('#app');
