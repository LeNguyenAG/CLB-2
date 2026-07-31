<script setup>
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
const props=defineProps({page:{type:Number,default:1},limit:{type:Number,default:20},total:{type:Number,default:0}});const emit=defineEmits(['change']);const pages=computed(()=>Math.max(1,Math.ceil(props.total/props.limit)))
</script>
<template><div class="pagination"><span class="muted">{{ total }} bản ghi · Trang {{ page }}/{{ pages }}</span><button class="btn btn-sm btn-icon" :disabled="page<=1" @click="emit('change',page-1)"><ChevronLeft :size="16"/></button><button class="btn btn-sm btn-icon" :disabled="page>=pages" @click="emit('change',page+1)"><ChevronRight :size="16"/></button></div></template>
