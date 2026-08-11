<script setup>
import BaseModal from './BaseModal.vue'
defineProps({ open:Boolean, title:{type:String,default:'Xác nhận thao tác'}, message:String, confirmText:{type:String,default:'Xác nhận'}, danger:Boolean, busy:Boolean })
defineEmits(['close','confirm'])
</script>
<template><BaseModal :open="open" :title="title" width="470px" @close="$emit('close')"><p>{{ message }}</p><template #footer><button class="btn" @click="$emit('close')">Hủy</button><button class="btn" :class="danger?'btn-danger':'btn-primary'" :disabled="busy" @click="$emit('confirm')">{{ busy?'Đang xử lý...':confirmText }}</button></template></BaseModal></template>
