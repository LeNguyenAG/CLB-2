<script setup>
import { onMounted, onUnmounted, watch } from 'vue'
import { X } from '@lucide/vue'
const props = defineProps({ open: Boolean, title: String, width: { type: String, default: '680px' } })
const emit = defineEmits(['close'])
function onKey(event){ if(event.key === 'Escape' && props.open) emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
watch(() => props.open, (open) => document.body.classList.toggle('modal-open', open), { immediate: true })
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  document.body.classList.remove('modal-open')
})
</script>
<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="modal-backdrop" @mousedown.self="$emit('close')">
        <Transition name="slide-up" appear>
          <section class="modal glass" :style="{ maxWidth: width }" role="dialog" aria-modal="true" :aria-label="title">
            <header><h3>{{ title }}</h3><button class="btn btn-icon btn-ghost" aria-label="Đóng cửa sổ" @click="$emit('close')"><X :size="20"/></button></header>
            <div class="modal-body"><slot /></div>
            <footer v-if="$slots.footer"><slot name="footer" /></footer>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
<style scoped>.modal-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(2,7,14,.72);backdrop-filter:blur(8px);display:grid;place-items:center;padding:18px}.modal{width:100%;max-height:92dvh;overflow:auto;overscroll-behavior:contain}.modal header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--panel-solid);z-index:2}.modal header h3{font-size:21px}.modal-body{padding:20px}.modal footer{padding:15px 20px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px;position:sticky;bottom:0;background:var(--panel-solid)}@media(max-width:600px){.modal-backdrop{padding:0;place-items:end center}.modal{max-width:none!important;max-height:94dvh;border-radius:20px 20px 0 0}.modal header{padding:14px 16px}.modal header h3{font-size:18px}.modal-body{padding:16px}.modal footer{padding:12px 16px;flex-wrap:wrap}.modal footer :deep(.btn){flex:1}}</style>
