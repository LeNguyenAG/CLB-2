<script setup>
import { computed } from 'vue'
import { mascotFor } from '../data/clubMascots'

const props = defineProps({
  mascotKey: { type: String, default: '' },
  size: { type: Number, default: 48 },
  animated: { type: Boolean, default: false },
  fallbackName: { type: String, default: 'CLB' },
})
const mascot = computed(() => mascotFor(props.mascotKey))
const initials = computed(() => String(props.fallbackName || 'CLB').split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase())
</script>

<template>
  <span class="club-mascot" :class="[mascotKey, { animated }]" :style="{ width: `${size}px`, height: `${size}px`, '--mascot-color': mascot?.color || '#6594d8' }">
    <img v-if="mascot" :src="`/mascots/${mascot.key}.webp`" :alt="mascot.name" />
    <b v-else>{{ initials }}</b>
    <i v-if="mascot && animated" aria-hidden="true" />
  </span>
</template>

<style scoped>
.club-mascot{position:relative;isolation:isolate;display:inline-grid;flex:0 0 auto;place-items:center;overflow:visible;border-radius:16px;background:linear-gradient(145deg,color-mix(in srgb,var(--mascot-color) 22%,#091426),#07101f);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--mascot-color) 38%,transparent),0 5px 15px rgba(0,0,0,.28)}
.club-mascot img{position:relative;z-index:2;width:100%;height:100%;border-radius:inherit;object-fit:cover}.club-mascot>b{color:#dceaff;font-size:11px}.club-mascot i{position:absolute;z-index:1;inset:-9%;border:1px solid color-mix(in srgb,var(--mascot-color) 60%,transparent);border-radius:45%;filter:drop-shadow(0 0 5px var(--mascot-color));opacity:.62;animation:mascot-pulse 2.3s ease-in-out infinite}
.club-mascot.dragon-ascendant.animated i{inset:-18%;border-width:2px;border-style:dashed;border-radius:48% 52% 45% 55%;animation:dragon-rise 3s linear infinite}.club-mascot.golden-buffalo.animated{animation:golden-gleam 2.1s ease-in-out infinite}.club-mascot.fire-phoenix.animated i,.club-mascot.thunder-wolf.animated i{animation-duration:1.3s}
.club-mascot.neon-raptor.animated,.club-mascot.storm-champion.animated{animation:neon-charge 1.35s ease-in-out infinite}.club-mascot.celestial-sword.animated i,.club-mascot.crowned-grail.animated i{inset:-14%;border-color:#ffe07a;animation:treasure-orbit 2.8s linear infinite}.club-mascot.lunar-fairy.animated i,.club-mascot.nine-tail-fox.animated i{animation-duration:1.75s;filter:drop-shadow(0 0 8px var(--mascot-color))}.club-mascot.iron-rhino.animated,.club-mascot.glacial-golem.animated{animation:bastion-breathe 2.6s ease-in-out infinite}
@keyframes mascot-pulse{50%{opacity:1;transform:scale(1.08)}}@keyframes dragon-rise{to{transform:rotate(360deg) scale(1.06)}}@keyframes golden-gleam{50%{filter:brightness(1.18) drop-shadow(0 0 9px #ffd65a)}}
@keyframes neon-charge{50%{filter:brightness(1.16) saturate(1.18) drop-shadow(0 0 8px var(--mascot-color));transform:translateY(-1px)}}@keyframes treasure-orbit{to{transform:rotate(360deg)}}@keyframes bastion-breathe{50%{filter:contrast(1.08) drop-shadow(0 0 6px var(--mascot-color));transform:scale(1.025)}}
@media(prefers-reduced-motion:reduce){.club-mascot,.club-mascot i{animation:none!important}}
</style>
