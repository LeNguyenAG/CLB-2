<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Palette, X, Sun, Moon, Monitor, Sparkles, RotateCcw, Check, Gauge, MousePointer2 } from '@lucide/vue'
import { uiStore } from '../stores/ui'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const customColor = ref(uiStore.state.customAccent)

const themeOptions = [
  { id: 'dark', label: 'Tối', icon: Moon },
  { id: 'light', label: 'Sáng', icon: Sun },
  { id: 'system', label: 'Theo máy', icon: Monitor },
]
const backdrops = [
  { id: 'aurora', label: 'Cực quang nhẹ', description: 'Một lớp màu chuyển động chậm, ít tốn tài nguyên.' },
  { id: 'stadium', label: 'Đèn sân nhẹ', description: 'Hai dải sáng mờ, không dùng hiệu ứng theo chuột.' },
  { id: 'carbon', label: 'Carbon', description: 'Nền kỹ thuật gần như tĩnh.' },
  { id: 'minimal', label: 'Tối giản', description: 'Tắt toàn bộ nền động.' },
]
const glassOptions = [
  { id: 'soft', label: 'Nhẹ' },
  { id: 'standard', label: 'Vừa' },
  { id: 'strong', label: 'Đậm' },
]
const selectedMotion = computed(() => uiStore.motionProfiles.find((item) => item.id === uiStore.state.motion) || uiStore.motionProfiles[2])
const smoothnessScore = computed(() => selectedMotion.value.strength)

function close() { emit('close') }
function applyCustom(value) {
  customColor.value = value
  uiStore.setAccent('custom', value)
}
function onKeydown(event) {
  if (event.key === 'Escape' && props.open) close()
}
watch(() => props.open, (open) => {
  if (open) customColor.value = uiStore.state.customAccent
  if (typeof document !== 'undefined') document.body.classList.toggle('appearance-studio-open', open)
})
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.classList.remove('appearance-studio-open')
})
</script>

<template>
  <Transition name="studio-fade">
    <div v-if="open" class="studio-shell" role="dialog" aria-modal="true" aria-label="Tùy biến giao diện">
      <button type="button" class="studio-overlay" aria-label="Đóng bảng giao diện" @click="close"></button>
      <aside class="appearance-studio">
        <header class="studio-head">
          <div class="studio-title">
            <span class="studio-icon"><Palette :size="21" /></span>
            <div>
              <span class="eyebrow">Giao diện nhẹ</span>
              <h2>Màu sắc & độ mượt</h2>
            </div>
          </div>
          <button type="button" class="btn btn-icon btn-ghost" aria-label="Đóng" @click="close"><X :size="20" /></button>
        </header>

        <div class="studio-scroll">
          <section class="performance-hero">
            <div class="performance-score"><b>{{ smoothnessScore }}</b><small>ĐỘ MƯỢT</small></div>
            <div>
              <span class="eyebrow"><Gauge :size="14" />{{ selectedMotion.short }}</span>
              <h3>{{ selectedMotion.label }}</h3>
              <p>{{ selectedMotion.description }}</p>
              <small class="device-note">{{ selectedMotion.recommendation }}</small>
            </div>
          </section>

          <section class="studio-section">
            <div class="studio-label"><span>Độ mượt</span><small>Chỉ còn 3 mức rõ ràng, không có chế độ nặng.</small></div>
            <div class="motion-list">
              <button
                v-for="profile in uiStore.motionProfiles"
                :key="profile.id"
                type="button"
                class="motion-option"
                :class="{ active: uiStore.state.motion === profile.id }"
                @click="uiStore.setMotion(profile.id)"
              >
                <span><b>{{ profile.label }}</b><small>{{ profile.description }}</small></span>
                <span class="motion-right"><em>{{ profile.strength }}%</em><Check v-if="uiStore.state.motion === profile.id" :size="16" /></span>
              </button>
            </div>
          </section>

          <section class="studio-section">
            <div class="studio-label"><span>Chế độ hiển thị</span><small>Sáng, tối hoặc theo Windows.</small></div>
            <div class="segmented three">
              <button v-for="item in themeOptions" :key="item.id" type="button" :class="{ active: uiStore.state.themeMode === item.id }" @click="uiStore.setTheme(item.id)">
                <component :is="item.icon" :size="16" />{{ item.label }}
              </button>
            </div>
          </section>

          <section class="studio-section">
            <div class="studio-label"><span>Màu chủ đạo</span><small>Đổi màu không ảnh hưởng hiệu năng.</small></div>
            <div class="palette-grid">
              <button v-for="preset in uiStore.presets" :key="preset.id" type="button" class="palette-card" :class="{ active: uiStore.state.accent === preset.id }" @click="uiStore.setAccent(preset.id)">
                <span class="palette-swatch" :style="{ background: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})` }"></span>
                <span>{{ preset.name }}</span>
                <Check v-if="uiStore.state.accent === preset.id" :size="15" />
              </button>
            </div>
            <label class="custom-color" :class="{ active: uiStore.state.accent === 'custom' }">
              <span class="custom-color-preview" :style="{ background: customColor }"></span>
              <span><b>Màu tùy chỉnh</b><small>{{ customColor.toUpperCase() }}</small></span>
              <input type="color" :value="customColor" aria-label="Chọn màu tùy chỉnh" @input="applyCustom($event.target.value)" />
            </label>
          </section>

          <section class="studio-section">
            <div class="studio-label"><span>Nền giao diện</span><small>Hiệu ứng đã được giảm còn một lớp nhẹ.</small></div>
            <div class="backdrop-list">
              <button v-for="item in backdrops" :key="item.id" type="button" class="backdrop-option" :class="{ active: uiStore.state.backdrop === item.id }" @click="uiStore.setBackdrop(item.id)">
                <span class="backdrop-dot"></span>
                <span><b>{{ item.label }}</b><small>{{ item.description }}</small></span>
                <Check v-if="uiStore.state.backdrop === item.id" :size="16" />
              </button>
            </div>
          </section>

          <section class="studio-section compact-controls">
            <div class="studio-label"><span>Tinh chỉnh nhẹ</span><small>Giới hạn an toàn để tránh lag.</small></div>
            <label class="range-control">
              <span><span><Sparkles :size="16" /><b>Cường độ nền</b></span><strong>{{ uiStore.state.effects }}%</strong></span>
              <input type="range" min="0" max="55" step="1" :value="uiStore.state.effects" @input="uiStore.setEffects($event.target.value)" />
            </label>
            <label class="switch-row">
              <span><MousePointer2 :size="17" /><span><b>Phản hồi nút bấm</b><small>Nhấn nhẹ và trượt màu, không dùng ripple.</small></span></span>
              <input type="checkbox" :checked="uiStore.state.buttonFx" @change="uiStore.setButtonFx($event.target.checked)" />
            </label>
          </section>

          <section class="studio-section">
            <div class="studio-label"><span>Độ trong bề mặt</span><small>Blur đã được giới hạn để máy nhẹ hơn.</small></div>
            <div class="segmented three">
              <button v-for="item in glassOptions" :key="item.id" type="button" :class="{ active: uiStore.state.glass === item.id }" @click="uiStore.setGlass(item.id)">{{ item.label }}</button>
            </div>
          </section>
        </div>

        <footer class="studio-footer">
          <button type="button" class="btn btn-ghost" @click="uiStore.resetAppearance()"><RotateCcw :size="16" />Mặc định nhẹ</button>
          <button type="button" class="btn btn-primary" @click="close"><Check :size="17" />Hoàn tất</button>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.studio-shell{position:fixed;inset:0;z-index:3000;pointer-events:auto}.studio-overlay{position:absolute!important;inset:0;z-index:0;border:0;background:rgba(0,0,0,.54);backdrop-filter:blur(2px)}.appearance-studio{position:absolute;z-index:1;right:0;top:0;height:100%;width:min(500px,96vw);display:flex;flex-direction:column;pointer-events:auto;background:color-mix(in srgb,var(--panel-solid) 97%,transparent);border-left:1px solid var(--line);box-shadow:-20px 0 54px rgba(0,0,0,.32);animation:studioSlideIn .24s ease-out}@keyframes studioSlideIn{from{transform:translateX(28px);opacity:.4}to{transform:none;opacity:1}}.studio-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 15px;border-bottom:1px solid var(--line)}.studio-title{display:flex;align-items:center;gap:11px}.studio-icon{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;color:white;background:linear-gradient(135deg,var(--primary),var(--primary-2))}.studio-title h2{font-size:19px;margin-top:3px}.studio-scroll{overflow-y:auto;overscroll-behavior:contain;padding:14px 20px 25px}.performance-hero{display:grid;grid-template-columns:84px 1fr;gap:15px;align-items:center;padding:16px;border:1px solid rgba(var(--accent-rgb),.24);border-radius:18px;background:linear-gradient(135deg,rgba(var(--accent-rgb),.1),rgba(255,255,255,.02))}.performance-score{width:76px;height:76px;border-radius:50%;display:grid;place-items:center;align-content:center;border:5px solid rgba(var(--accent-rgb),.35);background:var(--panel-solid)}.performance-score b{font-size:24px}.performance-score small{font-size:7px;color:var(--muted);letter-spacing:.13em}.performance-hero h3{margin:5px 0 3px;font-size:19px}.performance-hero p{font-size:12px;line-height:1.5}.device-note{display:block;margin-top:7px;color:var(--primary);font-size:10px}.studio-section{padding:18px 0;border-bottom:1px solid var(--line)}.studio-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:11px}.studio-label span{font-weight:800}.studio-label small{max-width:245px;color:var(--muted);font-size:11px;line-height:1.4;text-align:right}.motion-list,.backdrop-list{display:grid;gap:8px}.motion-option,.backdrop-option{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;width:100%;padding:12px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.02);color:var(--text);text-align:left;transition:transform .16s ease,border-color .16s ease,background-color .16s ease}.motion-option:hover,.backdrop-option:hover{transform:translateX(3px);border-color:var(--line-strong)}.motion-option.active,.backdrop-option.active{border-color:rgba(var(--accent-rgb),.45);background:rgba(var(--accent-rgb),.08)}.motion-option b,.motion-option small,.backdrop-option b,.backdrop-option small{display:block}.motion-option small,.backdrop-option small{margin-top:3px;color:var(--muted);font-size:10px;line-height:1.45}.motion-right{display:flex;align-items:center;gap:8px;color:var(--primary)}.motion-right em{font-style:normal;font-size:10px}.backdrop-option{grid-template-columns:13px 1fr auto}.backdrop-dot{width:10px;height:10px;border-radius:50%;background:var(--primary);box-shadow:0 0 10px rgba(var(--accent-rgb),.28)}.segmented{display:grid;gap:6px;padding:4px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.02)}.segmented.three{grid-template-columns:repeat(3,1fr)}.segmented button{min-height:38px;border:0;border-radius:9px;background:transparent;color:var(--muted);display:flex;align-items:center;justify-content:center;gap:6px;font-weight:750}.segmented button.active{color:white;background:linear-gradient(135deg,var(--primary),var(--primary-2))}.palette-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.palette-card{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:8px;min-height:48px;padding:7px 9px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.02);color:var(--text);font-size:12px;font-weight:750;text-align:left}.palette-card.active{border-color:var(--line-strong);background:rgba(var(--accent-rgb),.07)}.palette-swatch{width:32px;height:32px;border-radius:10px}.custom-color{margin-top:8px;display:grid;grid-template-columns:36px 1fr auto;align-items:center;gap:9px;padding:9px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.02)}.custom-color.active{border-color:var(--line-strong)}.custom-color-preview{width:36px;height:36px;border-radius:10px}.custom-color b,.custom-color small{display:block}.custom-color small{margin-top:2px;color:var(--muted);font-size:10px}.custom-color input{width:42px;height:34px;padding:2px;border:1px solid var(--line);border-radius:8px;background:transparent}.compact-controls{display:grid;gap:10px}.compact-controls .studio-label{margin-bottom:0}.range-control,.switch-row{padding:12px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.02)}.range-control{display:grid;gap:8px}.range-control>span,.switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.range-control>span>span,.switch-row>span{display:flex;align-items:center;gap:8px}.range-control strong{color:var(--primary);font-size:11px}.range-control input{width:100%;accent-color:var(--primary)}.switch-row b,.switch-row small{display:block}.switch-row small{margin-top:3px;color:var(--muted);font-size:10px}.switch-row input{appearance:none;width:44px;height:24px;border-radius:20px;background:rgba(255,255,255,.1);border:1px solid var(--line);position:relative;cursor:pointer}.switch-row input::after{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#fff;transition:transform .16s ease}.switch-row input:checked{background:var(--primary)}.switch-row input:checked::after{transform:translateX(20px)}.studio-footer{display:flex;gap:9px;padding:13px 18px;border-top:1px solid var(--line);background:var(--panel-solid)}.studio-footer .btn{flex:1}.studio-fade-enter-active,.studio-fade-leave-active{transition:opacity .16s ease}.studio-fade-enter-from,.studio-fade-leave-to{opacity:0}@media(max-width:560px){.appearance-studio{width:100vw}.studio-scroll{padding-inline:15px}.performance-hero{grid-template-columns:72px 1fr}.performance-score{width:66px;height:66px}.palette-grid{grid-template-columns:1fr}.studio-label{display:block}.studio-label small{display:block;margin-top:3px;text-align:left}}@media(prefers-reduced-motion:reduce){.appearance-studio{animation:none}.motion-option,.backdrop-option{transition:none}}
</style>
