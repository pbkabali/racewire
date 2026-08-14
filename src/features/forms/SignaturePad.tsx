import { useEffect, useRef, useState } from 'react'

/**
 * Draw-to-sign, on touch or with a mouse.
 *
 * Pointer events rather than separate touch and mouse handlers: one code path
 * covers finger, stylus and mouse, and `setPointerCapture` keeps the stroke
 * alive when a finger strays outside the box mid-signature.
 */
export function SignaturePad({
  label,
  value,
  onChange,
}: {
  label: string
  /** PNG data URL, or empty. */
  value: string
  onChange: (dataUrl: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(Boolean(value))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    /*
     * A canvas has two sizes: its CSS box and its pixel buffer. Left equal on a
     * phone the signature renders soft, so the buffer is scaled by the device
     * pixel ratio and the context scaled to match.
     */
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio

    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(ratio, ratio)
    context.lineWidth = 2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    // Signatures are composited onto white in the PDF, so ink is always dark
    // regardless of the app theme.
    context.strokeStyle = '#0b0b0c'

    if (value) {
      const image = new Image()
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height)
      image.src = value
    }
    // Re-running on `value` would wipe the stroke in progress every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const { x, y } = positionOf(event)
    context.beginPath()
    context.moveTo(x, y)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const { x, y } = positionOf(event)
    context.lineTo(x, y)
    context.stroke()
    setHasInk(true)
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange('')
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {label}
        </span>
        {hasInk && (
          <button
            type="button"
            onClick={clear}
            className="text-xs font-semibold text-danger-text"
          >
            Clear
          </button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        // touch-none stops the browser treating a signing gesture as a scroll,
        // which otherwise makes signing on a phone almost impossible.
        className="h-32 w-full touch-none rounded-md border border-edge bg-white"
        aria-label={label}
      />

      <p className="mt-1 text-xs text-fg-subtle">
        {hasInk ? 'Signed. Draw again after clearing to change it.' : 'Sign inside the box.'}
      </p>
    </div>
  )
}
