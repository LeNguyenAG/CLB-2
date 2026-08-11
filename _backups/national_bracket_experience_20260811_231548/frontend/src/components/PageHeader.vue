<script setup>
defineProps({ eyebrow: String, title: String, description: String })
</script>
<template>
  <div class="page-header">
    <div>
      <div v-if="eyebrow" class="eyebrow">{{ eyebrow }}</div>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="page-actions"><slot /></div>
  </div>
</template>
<style scoped>.page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:24px}.page-header>div:first-child{min-width:0}.page-header h1{font-size:clamp(28px,4vw,46px);margin:7px 0 8px;overflow-wrap:anywhere}.page-header p{max-width:760px}.page-actions{display:flex;gap:10px;flex-wrap:wrap}@media(max-width:760px){.page-header{align-items:flex-start;flex-direction:column;margin-bottom:20px}.page-actions{width:100%}.page-actions :deep(.btn){flex:1}}@media(max-width:480px){.page-header h1{font-size:28px;line-height:1.12}.page-header p{font-size:13px;line-height:1.55}}</style>
