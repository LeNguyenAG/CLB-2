<script setup>
import { ServerOff, RefreshCw } from '@lucide/vue'
defineProps({ checking:Boolean });defineEmits(['retry'])
</script>
<template><div class="connection-banner"><ServerOff :size="18"/><span>Frontend chưa kết nối được Backend/MySQL tại cổng 3000.</span><button class="btn btn-sm" :disabled="checking" @click="$emit('retry')"><RefreshCw :size="14" :class="{spin:checking}"/>Thử lại</button></div></template>
<style scoped>.connection-banner{position:fixed;left:50%;transform:translateX(-50%);top:10px;z-index:4000;display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid rgba(255,93,115,.35);background:rgba(58,9,20,.94);color:#ffd7dd;border-radius:12px;box-shadow:var(--shadow);font-size:13px}.spin{animation:spin .8s linear infinite}@media(max-width:650px){.connection-banner{width:calc(100% - 20px);justify-content:center;flex-wrap:wrap}}</style>
