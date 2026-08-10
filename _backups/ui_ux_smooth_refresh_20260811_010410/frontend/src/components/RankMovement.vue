<script setup>
import { computed } from 'vue'
import { ArrowUp, ArrowDown, Minus, Sparkles } from '@lucide/vue'
import { movement } from '../utils'
const props = defineProps({ change: [Number, String], previous: [Number, String] })
const info = computed(() => movement(props.change))
</script>
<template>
  <span class="movement" :class="info.type">
    <Sparkles v-if="previous == null && change == null" :size="14" />
    <ArrowUp v-else-if="info.type === 'up'" :size="14" />
    <ArrowDown v-else-if="info.type === 'down'" :size="14" />
    <Minus v-else :size="14" />
    <span>{{ previous == null && change == null ? 'Mới' : info.value || 0 }}</span>
  </span>
</template>
<style scoped>.movement{display:inline-flex;align-items:center;gap:4px;font-weight:800;font-size:12px}.up{color:var(--green)}.down{color:var(--red)}.same{color:var(--muted)}</style>
