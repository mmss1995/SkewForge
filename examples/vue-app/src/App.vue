<script setup lang="ts">
import { useSkew } from '@skewforge/vue'

const { state, reload } = useSkew()
</script>

<template>
  <div class="shell">
    <div v-if="state.updateAvailable" class="update-banner" role="status">
      <span>A new version of the shop is live — it loads on your next click.</span>
      <button type="button" @click="reload">Update now</button>
    </div>
    <header>
      <h1>Skew Shop <small class="muted">Vue</small></h1>
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/catalog">Catalog</RouterLink>
        <RouterLink to="/product/42">Product</RouterLink>
        <RouterLink to="/checkout">Checkout</RouterLink>
      </nav>
      <p class="badge" data-testid="badge">
        running <code>{{ state.running ?? 'dev' }}</code>
        <template v-if="state.current && state.current !== state.running"> · live <code>{{ state.current }}</code></template>
        · <span :class="['dot', `dot-${state.connection}`]" /> {{ state.connection }}
      </p>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
