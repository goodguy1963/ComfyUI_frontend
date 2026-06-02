<template>
  <div
    ref="transformPaneRef"
    data-testid="transform-pane"
    class="ph-no-capture pointer-events-none absolute inset-0 size-full"
  >
    <div
      ref="livePaneRef"
      data-testid="transform-pane-live"
      class="absolute inset-0 size-full will-change-auto"
    >
      <!-- Vue nodes will be rendered here -->
      <slot />
    </div>
    <div
      ref="fallbackPaneRef"
      data-testid="transform-pane-fallback"
      class="absolute inset-0 size-full will-change-auto"
      hidden
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import { useRafFn } from '@vueuse/core'
import { computed, ref, useTemplateRef, watch } from 'vue'

import type { LGraphCanvas } from '@/lib/litegraph/src/litegraph'
import { useTransformSettling } from '@/renderer/core/layout/transform/useTransformSettling'
import { useTransformState } from '@/renderer/core/layout/transform/useTransformState'
import { requestSlotLayoutSyncForAllNodes } from '@/renderer/extensions/vueNodes/composables/useSlotElementTracking'

interface TransformPaneProps {
  canvas?: LGraphCanvas
  activePanDetail?: 'none' | 'middle' | 'close'
  isMiddlePanning?: boolean
  panFallbackDetail?: 'none' | 'middle' | 'close'
}

const props = withDefaults(defineProps<TransformPaneProps>(), {
  activePanDetail: 'none',
  isMiddlePanning: false,
  panFallbackDetail: 'none'
})

const { transformStyle, syncWithCanvas } = useTransformState()

const canvasElement = computed(() => props.canvas?.canvas)
const { isTransforming: isInteracting } = useTransformSettling(canvasElement, {
  settleDelay: 256
})

const transformPaneRef = useTemplateRef('transformPaneRef')
const livePaneRef = useTemplateRef('livePaneRef')
const fallbackPaneRef = useTemplateRef('fallbackPaneRef')
const isPanFallbackActive = computed(() => props.panFallbackDetail !== 'none')
const interactionStartScale = ref<number | null>(null)

function applyTransformStyle(el: HTMLElement | null, newStyle: Record<string, string>) {
  if (!el) {
    return
  }

  Object.assign(el.style, newStyle)
}

function toggleDataset(
  el: HTMLElement | null,
  key: string,
  value: string | null
) {
  if (!el) {
    return
  }

  if (value === null) {
    delete el.dataset[key]
    return
  }

  el.dataset[key] = value
}

function toggleWillChange(el: HTMLElement | null, interacting: boolean) {
  if (!el) {
    return
  }

  el.classList.toggle('will-change-transform', interacting)
  el.classList.toggle('will-change-auto', !interacting)
}

function refreshFallbackSnapshot(
  liveEl: HTMLElement | null,
  fallbackEl: HTMLElement | null
) {
  if (!liveEl || !fallbackEl) {
    return
  }

  fallbackEl.replaceChildren(
    ...Array.from(liveEl.childNodes, (node) => node.cloneNode(true))
  )
}

/**
 * Apply transform style and will-change class via direct DOM mutation
 * instead of reactive template bindings (:style / :class).
 *
 * These values change every animation frame during zoom or pan.
 * If they were bound in the template, Vue would diff the entire
 * TransformPane vnode—including all child node slots—on every frame,
 * causing expensive vdom patch work across the full node list.
 * Mutating the DOM directly limits the update to a single element.
 */

watch([transformStyle, livePaneRef, fallbackPaneRef, isPanFallbackActive],
  ([newStyle, liveEl, fallbackEl, fallbackActive]) => {
    if (fallbackActive) {
      applyTransformStyle(fallbackEl, newStyle)
      return
    }

    applyTransformStyle(liveEl, newStyle)
  }
)

watch([isInteracting, livePaneRef, fallbackPaneRef, isPanFallbackActive],
  ([interacting, liveEl, fallbackEl, fallbackActive]) => {
    if (fallbackActive) {
      toggleWillChange(liveEl, false)
      toggleWillChange(fallbackEl, interacting)
      return
    }

    toggleWillChange(fallbackEl, false)
    toggleWillChange(liveEl, interacting)
  }
)

watch([() => props.activePanDetail, transformPaneRef], ([detail, el]) => {
  toggleDataset(el, 'activePanDetail', detail === 'none' ? null : detail)
})

watch([() => props.isMiddlePanning, transformPaneRef], ([middlePanning, el]) => {
  toggleDataset(el, 'middlePanActive', middlePanning ? 'true' : null)
})

watch([() => props.panFallbackDetail, transformPaneRef], ([detail, el]) => {
  toggleDataset(el, 'panFallbackDetail', detail === 'none' ? null : detail)
})

watch([isPanFallbackActive, transformPaneRef], ([fallbackActive, el]) => {
  toggleDataset(el, 'panFallbackActive', fallbackActive ? 'true' : null)
  toggleDataset(el, 'livePaneSuppressed', fallbackActive ? 'true' : null)
})

watch([isPanFallbackActive, livePaneRef, fallbackPaneRef, transformStyle],
  ([fallbackActive, liveEl, fallbackEl, newStyle]) => {
    if (!liveEl || !fallbackEl) {
      return
    }

    if (fallbackActive) {
      refreshFallbackSnapshot(liveEl, fallbackEl)
      applyTransformStyle(fallbackEl, newStyle)
      fallbackEl.hidden = false
      liveEl.hidden = true
      liveEl.setAttribute('aria-hidden', 'true')
      return
    }

    applyTransformStyle(liveEl, newStyle)
    liveEl.hidden = false
    liveEl.removeAttribute('aria-hidden')
    fallbackEl.hidden = true
    fallbackEl.replaceChildren()
  }
)
watch(isInteracting, (interacting, wasInteracting) => {
  if (interacting) {
    interactionStartScale.value = props.canvas?.ds?.scale ?? null
    return
  }

  if (!wasInteracting) return

  const endScale = props.canvas?.ds?.scale ?? null
  const scaleChanged =
    interactionStartScale.value != null &&
    endScale != null &&
    Math.abs(interactionStartScale.value - endScale) > 0.0001

  interactionStartScale.value = null

  if (scaleChanged) {
    requestSlotLayoutSyncForAllNodes()
  }
})

useRafFn(
  () => {
    if (!props.canvas) {
      return
    }
    syncWithCanvas(props.canvas)
  },
  { immediate: true }
)
</script>
