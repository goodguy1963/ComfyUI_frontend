<script setup lang="ts">
import { computed } from 'vue'

import type {
  SimplifiedControlWidget,
  SimplifiedWidget
} from '@/types/simplifiedWidget'

import WidgetInputNumberGradientSlider from './WidgetInputNumberGradientSlider.vue'
import WidgetInputNumberInput from './WidgetInputNumberInput.vue'
import WidgetInputNumberSlider from './WidgetInputNumberSlider.vue'
import WidgetWithControl from './WidgetWithControl.vue'

const props = defineProps<{
  widget: SimplifiedWidget<number>
}>()

const modelValue = defineModel<number | string | boolean>({ default: 0 })

const numericModelValue = computed({
  get: () => {
    const value = modelValue.value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'boolean') return value ? 1 : 0

    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : 0
  },
  set: (value: number) => {
    modelValue.value = value
  }
})

const controlWidget = computed<SimplifiedControlWidget<number> | null>(() =>
  props.widget.controlWidget
    ? (props.widget as SimplifiedControlWidget<number>)
    : null
)

const widgetComponent = computed(() => {
  switch (props.widget.type) {
    case 'gradientslider':
      return WidgetInputNumberGradientSlider
    case 'slider':
      return WidgetInputNumberSlider
    default:
      return WidgetInputNumberInput
  }
})
</script>

<template>
  <WidgetWithControl
    v-if="controlWidget"
    v-model="numericModelValue"
    :widget="controlWidget"
    :component="widgetComponent"
  />
  <component
    :is="widgetComponent"
    v-else
    v-model="numericModelValue"
    :widget="widget"
    v-bind="$attrs"
  />
</template>
