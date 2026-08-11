<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import ToastHost from './components/ToastHost.vue'
import ConnectionBanner from './components/ConnectionBanner.vue'
import AmbientEffects from './components/AmbientEffects.vue'
import { api } from './services/api'

const backendOnline = ref(true)
const checking = ref(false)
let timer

async function checkBackend() {
  checking.value = true
  try {
    const { data } = await api.health()
    backendOnline.value = data?.api === 'OK' && data?.database === 'OK'
  } catch {
    backendOnline.value = false
  } finally {
    checking.value = false
  }
}

onMounted(() => {
  checkBackend()
  timer = window.setInterval(checkBackend, 30000)
})
onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <AmbientEffects />
  <ConnectionBanner v-if="!backendOnline" :checking="checking" @retry="checkBackend" />
  <RouterView v-slot="{ Component, route }">
    <Transition name="route-motion" mode="out-in">
      <component :is="Component" :key="route.matched[0]?.path || route.path" />
    </Transition>
  </RouterView>
  <ToastHost />
</template>
