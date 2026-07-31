<script setup>
import { CheckCircle2, AlertTriangle, Info, X } from '@lucide/vue'
import { uiStore } from '../stores/ui'
</script>
<template><Teleport to="body"><div class="toast-stack"><TransitionGroup name="slide-up"><div v-for="toast in uiStore.state.toasts" :key="toast.id" class="toast glass" :class="toast.type"><CheckCircle2 v-if="toast.type==='success'" :size="19"/><AlertTriangle v-else-if="toast.type==='error'" :size="19"/><Info v-else :size="19"/><span>{{ toast.message }}</span><button @click="uiStore.dismiss(toast.id)"><X :size="15"/></button></div></TransitionGroup></div></Teleport></template>
<style scoped>.toast-stack{position:fixed;right:18px;top:18px;z-index:3000;display:grid;gap:10px;width:min(390px,calc(100vw - 36px))}.toast{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:13px 14px;border-left:3px solid var(--primary)}.toast.success{border-left-color:var(--green)}.toast.error{border-left-color:var(--red)}.toast.info{border-left-color:var(--cyan)}.toast button{border:0;background:transparent;color:var(--muted);padding:4px;display:grid;place-items:center}</style>
