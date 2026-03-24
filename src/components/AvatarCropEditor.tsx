/**
 * src/components/AvatarCropEditor.tsx
 * Reusable avatar upload and crop editor shared by character and avatar-library flows.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import '../styles/avatar-crop-editor.css'

import type { CharacterAvatarCrop } from '../types'

/** Props accepted by the AvatarCropEditor component. */
interface AvatarCropEditorProps {
  /** Current avatar image data URL. */
  imageData: string | null
  /** Current crop settings for the avatar image. */
  crop: CharacterAvatarCrop
  /** Called when the image changes. */
  onImageDataChange: (imageData: string | null) => void
  /** Called when the crop settings change. */
  onCropChange: (crop: CharacterAvatarCrop) => void
  /** Helper copy shown under the controls. */
  helpText?: string
  /** Upload button label. */
  uploadLabel?: string
  /** Empty-state prompt shown inside the crop circle. */
  emptyMessage?: string
  /** Optional content rendered above the control buttons. */
  controlsHeader?: React.ReactNode
}

/**
 * Clamp avatar zoom to a safe range for previews and chat bubbles.
 *
 * @param scale - Requested zoom level.
 * @returns Sanitized zoom value.
 */
function clampAvatarScale(scale: number): number {
  return Math.min(3, Math.max(1, Number(scale.toFixed(2))))
}

/**
 * AvatarCropEditor
 * Shared circular avatar framing control with upload, drag, and wheel zoom.
 */
export function AvatarCropEditor({
  imageData,
  crop,
  onImageDataChange,
  onCropChange,
  helpText = 'Drag inside the circle to position the image. Use the mouse wheel to zoom if needed.',
  uploadLabel = 'Upload Image',
  emptyMessage = 'Upload an image, then drag it to frame the avatar.',
  controlsHeader,
}: AvatarCropEditorProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  useEffect(() => () => {
    dragStateRef.current = null
  }, [])

  /**
   * Load one uploaded image file as a data URL and reset its crop state.
   *
   * @param file - Chosen image file.
   */
  function handleAvatarFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null
      if (!result) {
        return
      }

      onImageDataChange(result)
      onCropChange({ x: 0, y: 0, scale: 1 })
    }
    reader.readAsDataURL(file)
  }

  /**
   * Begin dragging the avatar image within the circular crop frame.
   *
   * @param event - Pointer event originating from the crop surface.
   */
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!imageData) {
      return
    }

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: crop.x,
      originY: crop.y,
    }
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /**
   * Update the crop offset as the pointer moves.
   *
   * @param event - Pointer move event from the crop surface.
   */
  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragStateRef.current) {
      return
    }

    onCropChange({
      ...crop,
      x: dragStateRef.current.originX + (event.clientX - dragStateRef.current.startX),
      y: dragStateRef.current.originY + (event.clientY - dragStateRef.current.startY),
    })
  }

  /**
   * End the active avatar drag interaction.
   *
   * @param event - Pointer event from the crop surface.
   */
  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dragStateRef.current = null
    setIsDragging(false)
  }

  /**
   * Adjust avatar zoom with the mouse wheel while hovering the crop area.
   *
   * @param event - Wheel event emitted by the crop surface.
   */
  function handleWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    if (!imageData) {
      return
    }

    event.preventDefault()
    const direction = event.deltaY < 0 ? 0.08 : -0.08
    onCropChange({
      ...crop,
      scale: clampAvatarScale(crop.scale + direction),
    })
  }

  const avatarPreviewStyle = imageData
    ? {
      backgroundImage: `url("${imageData}")`,
      backgroundPosition: `${crop.x}px ${crop.y}px`,
      backgroundSize: `${crop.scale * 100}%`,
    }
    : undefined

  return (
    <div className="avatar-crop-editor">
      <div
        className={`avatar-crop-editor__cropper${imageData ? ' avatar-crop-editor__cropper--ready' : ''}${isDragging ? ' avatar-crop-editor__cropper--dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className="avatar-crop-editor__viewport">
          {imageData ? (
            <div className="avatar-crop-editor__preview" style={avatarPreviewStyle} />
          ) : (
            <div className="avatar-crop-editor__empty">
              {emptyMessage}
            </div>
          )}
        </div>
      </div>

      <div className="avatar-crop-editor__controls">
        {controlsHeader}
        <input
          ref={inputRef}
          id={inputId}
          className="avatar-crop-editor__upload"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              handleAvatarFile(file)
            }
          }}
        />
        <button
          type="button"
          className="avatar-crop-editor__button"
          onClick={() => {
            inputRef.current?.click()
          }}
        >
          {uploadLabel}
        </button>
        <p className="avatar-crop-editor__help">{helpText}</p>
      </div>
    </div>
  )
}
