import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import RoomView from './views/RoomView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/room/:code', name: 'room', component: RoomView, props: true },
  ],
});
