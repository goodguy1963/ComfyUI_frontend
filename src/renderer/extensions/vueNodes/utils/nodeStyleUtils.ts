import { useColorPaletteStore } from '@/stores/workspace/colorPaletteStore'
import {
  adjustColor,
  isTransparent,
  parseToRgb
} from '@/utils/colorUtil'

const MIN_READABLE_LOD_LUMINANCE = 0.16

function colorLuminance(color: string): number {
  const { r, g, b } = parseToRgb(color)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Applies light theme color adjustments to a color
 */
export function applyLightThemeColor(color?: string): string {
  if (!color) return ''

  if (!useColorPaletteStore().completedActivePalette.light_theme) return color

  return adjustColor(color, { lightness: 0.5 })
}

export function applyReadableNodeLodColor(
  color: string | undefined,
  fallback: string
): string {
  const adjusted = applyLightThemeColor(color)
  if (
    !adjusted ||
    isTransparent(adjusted) ||
    colorLuminance(adjusted) < MIN_READABLE_LOD_LUMINANCE
  ) {
    return fallback
  }

  return adjusted
}
