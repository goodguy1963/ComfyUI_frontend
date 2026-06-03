import { storeToRefs } from 'pinia'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useExecutionStore } from '@/stores/executionStore'

/**
 * Composable for managing execution state of Vue-based nodes
 *
 * Provides reactive access to execution state and progress for a specific node
 * by injecting execution data from the parent GraphCanvas provider.
 *
 * @param nodeLocatorIdMaybe - Locator ID (root or subgraph scoped) of the node to track
 * @returns Object containing reactive execution state and progress
 */
export const useNodeExecutionState = (
  nodeLocatorIdMaybe: MaybeRefOrGetter<string | undefined>
) => {
  const locatorId = computed(() => toValue(nodeLocatorIdMaybe) ?? '')
  const executionStore = useExecutionStore()
  const { isIdle, areNodeProgressVisualsSuppressed } =
    storeToRefs(executionStore)
  const selectedLocatorId = shallowRef('')

  watch(
    locatorId,
    (id) => {
      selectedLocatorId.value = id
    },
    { immediate: true }
  )

  const progressState = computed(() => {
    if (areNodeProgressVisualsSuppressed.value) {
      return undefined
    }

    const id = selectedLocatorId.value
    return id
      ? executionStore.getNodeLocationProgressStateRef(id).value
      : undefined
  })

  const executing = computed(
    () => !isIdle.value && progressState.value?.state === 'running'
  )

  const progress = computed(() => {
    const state = progressState.value
    return state && state.max > 0 ? state.value / state.max : undefined
  })

  const progressPercentage = computed(() => {
    const prog = progress.value
    return prog !== undefined ? Math.round(prog * 100) : undefined
  })

  const executionState = computed(() => {
    const state = progressState.value
    if (!state) return 'idle'
    return state.state
  })

  return {
    executing,
    progress,
    progressPercentage,
    progressState,
    executionState
  }
}
