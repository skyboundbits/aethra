/**
 * src/services/modelFitService.ts
 * Heuristic helpers for local llama.cpp model fit guidance in the renderer.
 */

import type { HardwareInfo, ModelFitEstimate, ModelPreset } from '../types'

/**
 * Format a byte count into a compact human-readable string.
 *
 * @param value - Byte count to format.
 * @returns Human-readable size string.
 */
export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'Unknown'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

/**
 * Estimate whether a local GGUF model is likely to fit in the best available GPU.
 *
 * This is intentionally conservative and should be presented as guidance rather
 * than an exact measurement.
 *
 * @param model - Local model preset to assess.
 * @param hardware - Detected hardware inventory.
 * @param contextWindowTokens - Requested context window for the load attempt.
 * @returns Heuristic fit guidance for the renderer.
 */
export function estimateLocalModelFit(
  model: ModelPreset | null,
  hardware: HardwareInfo | null,
  contextWindowTokens?: number | null,
): ModelFitEstimate {
  if (!model || typeof model.fileSizeBytes !== 'number' || model.fileSizeBytes <= 0) {
    return {
      level: 'unknown',
      message: 'Model file size is unavailable, so GPU fit cannot be estimated yet.',
      estimatedVramBytes: null,
      availableVramBytes: null,
      fitsFullyInGpu: null,
    }
  }

  const bestGpu = [...(hardware?.gpus ?? [])]
    .filter((gpu) => typeof gpu.vramBytes === 'number' && gpu.vramBytes > 0)
    .sort((left, right) => (right.vramBytes ?? 0) - (left.vramBytes ?? 0))[0] ?? null

  if (!bestGpu || typeof bestGpu.vramBytes !== 'number') {
    return {
      level: 'unknown',
      message: 'No dedicated GPU memory was detected. Expect CPU execution or partial offload only.',
      estimatedVramBytes: null,
      availableVramBytes: null,
      fitsFullyInGpu: null,
    }
  }

  const requestedContext = contextWindowTokens ?? model.contextWindowTokens ?? 8192
  const kvCacheBytes = Math.max(64 * 1024 * 1024, requestedContext * 16 * 1024)
  const estimatedVramBytes = Math.round(model.fileSizeBytes * 1.12 + kvCacheBytes)
  const availableVramBytes = bestGpu.vramBytes

  if (estimatedVramBytes <= availableVramBytes * 0.85) {
    return {
      level: 'good',
      message: `Likely to fit on ${bestGpu.name}. Estimated VRAM ${formatBytes(estimatedVramBytes)} vs ${formatBytes(availableVramBytes)} available.`,
      estimatedVramBytes,
      availableVramBytes,
      fitsFullyInGpu: true,
    }
  }

  if (estimatedVramBytes <= availableVramBytes) {
    return {
      level: 'warning',
      message: `Borderline GPU fit on ${bestGpu.name}. Reduce context or GPU layers if load fails. Estimated VRAM ${formatBytes(estimatedVramBytes)} vs ${formatBytes(availableVramBytes)} available.`,
      estimatedVramBytes,
      availableVramBytes,
      fitsFullyInGpu: false,
    }
  }

  return {
    level: 'critical',
    message: `Unlikely to fit fully on ${bestGpu.name}. Plan on partial offload or CPU use. Estimated VRAM ${formatBytes(estimatedVramBytes)} vs ${formatBytes(availableVramBytes)} available.`,
    estimatedVramBytes,
    availableVramBytes,
    fitsFullyInGpu: false,
  }
}
