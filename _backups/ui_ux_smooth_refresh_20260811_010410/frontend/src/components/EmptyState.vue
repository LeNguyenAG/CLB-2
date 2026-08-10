<script setup>
import { Inbox } from '@lucide/vue'
defineProps({ title:{type:String,default:'Chưa có dữ liệu'}, message:{type:String,default:'Dữ liệu sẽ xuất hiện tại đây khi được cập nhật.'} })
</script>
<template><div class="empty"><Inbox :size="38" style="opacity:.55;margin:auto auto 12px"/><h3>{{ title }}</h3><p>{{ message }}</p><div style="margin-top:14px"><slot/></div></div></template>
