import { computed } from 'vue'

import { useFeatureFlags } from '@/composables/useFeatureFlags'
import UploadModelDialog from '@/platform/assets/components/UploadModelDialog.vue'
import UploadModelDialogHeader from '@/platform/assets/components/UploadModelDialogHeader.vue'
import UploadModelUpgradeModal from '@/platform/assets/components/UploadModelUpgradeModal.vue'
import UploadModelUpgradeModalHeader from '@/platform/assets/components/UploadModelUpgradeModalHeader.vue'
import { useDialogStore } from '@/stores/dialogStore'

// Contents bring their own width and padding — shrink-wrap the chrome and
// zero the section padding (the PrimeVue `pt` overrides this replaces).
const uploadDialogComponentProps = {
  renderer: 'reka',
  contentClass: 'w-fit max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-1rem)]',
  headerClass: 'py-0 pl-0',
  bodyClass: 'p-0 overflow-y-hidden'
} as const

export function useModelUpload(
  onUploadSuccess?: () => Promise<unknown> | void
) {
  const dialogStore = useDialogStore()
  const { flags } = useFeatureFlags()
  const isUploadButtonEnabled = computed(() => flags.modelUploadButtonEnabled)

  function showUploadDialog() {
    if (!flags.privateModelsEnabled) {
      dialogStore.showDialog({
        key: 'upload-model-upgrade',
        headerComponent: UploadModelUpgradeModalHeader,
        component: UploadModelUpgradeModal,
        dialogComponentProps: uploadDialogComponentProps
      })
    } else {
      dialogStore.showDialog({
        key: 'upload-model',
        headerComponent: UploadModelDialogHeader,
        component: UploadModelDialog,
        props: {
          onUploadSuccess: async () => {
            await onUploadSuccess?.()
          }
        },
        dialogComponentProps: uploadDialogComponentProps
      })
    }
  }
  return { isUploadButtonEnabled, showUploadDialog }
}
