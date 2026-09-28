<script setup lang="ts">
import { release } from '../release'
</script>

<template>
  <section data-testid="route">
    <h2>Checkout</h2>
    <p>This chunk was built for release <strong data-testid="release">{{ release }}</strong>.</p>
  </section>
</template>
