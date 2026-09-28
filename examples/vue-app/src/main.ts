import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createSkewForge, installSkewRouterGuard } from '@skewforge/vue'
import App from './App.vue'
import Home from './routes/Home.vue'
import './index.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    // Lazy routes: one chunk each, re-hashed by every release.
    { path: '/catalog', component: () => import('./routes/Catalog.vue') },
    { path: '/product/:id', component: () => import('./routes/Product.vue') },
    { path: '/checkout', component: () => import('./routes/Checkout.vue') },
  ],
})

const skew = createSkewForge({ onMandatory: 'reload' })
// router.push() calls bypass link clicks; the guard turns them into full loads after a release.
installSkewRouterGuard(router, skew.client)

createApp(App).use(router).use(skew).mount('#app')
