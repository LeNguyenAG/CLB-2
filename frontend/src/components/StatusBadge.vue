<script setup>
import { computed } from 'vue'
import { statusName } from '../utils'
const props = defineProps({ status: String })
const color = computed(() => {
  const s = props.status || ''
  if (['APPROVED','ACTIVE','FINISHED','COMPLETED','VERIFIED','ACCEPTED'].includes(s)) return 'green'
  if (['REJECTED','CANCELLED','SUSPENDED','DISQUALIFIED','TERMINATED'].includes(s)) return 'red'
  if (['PENDING','REGISTERED','REGISTRATION','SENT','DRAFT','COMPLETED_PENDING_CLOSE'].includes(s)) return 'yellow'
  return 'blue'
})
</script>
<template><span class="badge" :class="color">{{ statusName(status) }}</span></template>
