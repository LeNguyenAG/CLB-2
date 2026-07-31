<script setup>
defineProps({ compact: Boolean })
</script>
<template>
  <RouterLink to="/" class="brand" :class="{ compact }">
    <span class="brand-mark">
      <span class="ball">⚽</span>
    </span>
    <span v-if="!compact" class="brand-copy">
      <strong>FOOTBALL RANK</strong>
      <small>MANAGEMENT SYSTEM</small>
    </span>
  </RouterLink>
</template>
<style scoped>
.brand{display:flex;align-items:center;gap:11px}.brand-mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,#1b72ff,#5e49f5);box-shadow:0 12px 30px rgba(57,130,255,.3);position:relative;overflow:hidden}.brand-mark:after{content:'';position:absolute;inset:-50%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);transform:rotate(24deg);animation:shine 4s infinite}.ball{font-size:24px;position:relative;z-index:1}.brand-copy{display:flex;flex-direction:column;line-height:1}.brand-copy strong{font:800 15px Manrope;letter-spacing:.02em}.brand-copy small{font-size:8px;letter-spacing:.15em;color:var(--muted);margin-top:6px}.compact .brand-mark{width:40px;height:40px}@keyframes shine{0%,70%{transform:translateX(-80%) rotate(24deg)}100%{transform:translateX(80%) rotate(24deg)}}
</style>
