<script setup>
import { ref, watch } from 'vue'
import { initials } from '../utils'
const props = defineProps({ src: String, name: String, round: Boolean, size: { type: Number, default: 42 } })
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>
<template>
  <div class="avatar" :class="{ round }" :style="{ width: `${size}px`, height: `${size}px`, minWidth: `${size}px` }">
    <img v-if="src && !failed" :src="src" :alt="name" @error="failed = true" />
    <span v-else>{{ initials(name) }}</span>
  </div>
</template>
<style scoped>.avatar{overflow:hidden}.avatar img{width:100%;height:100%;object-fit:cover}</style>
