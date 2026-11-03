'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { Eraser, Pen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DOCUMENT_INK, DOCUMENT_PAPER } from '@/lib/document/colors'
import styles from './SignaturePad.module.css'

export type SignaturePadProps = {
  value: string | null
  onChange: (dataUrl: string | null) => void
  width?: number
  height?: number
  surface?: 'app' | 'paper'
  hint?: string
}

const MAX_SIGNATURE_PNG_WIDTH = 2000
const MAX_SIGNATURE_PNG_HEIGHT = 1000

export function SignaturePad({ value, onChange, width = 480, height = 180, surface = 'app', hint }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [hasDrawing, setHasDrawing] = useState<boolean>(Boolean(value))
  const hintId = useId()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof CanvasRenderingContext2D === 'undefined') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Cap DPR directly so exported signatures stay inside the server's dimension limits.
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      MAX_SIGNATURE_PNG_WIDTH / width,
      MAX_SIGNATURE_PNG_HEIGHT / height,
    )
    const pixelWidth = Math.max(1, Math.min(MAX_SIGNATURE_PNG_WIDTH, Math.round(width * ratio)))
    const pixelHeight = Math.max(1, Math.min(MAX_SIGNATURE_PNG_HEIGHT, Math.round(height * ratio)))
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = 2
    ctx.strokeStyle = DOCUMENT_INK
    ctx.fillStyle = DOCUMENT_PAPER
    ctx.fillRect(0, 0, width, height)

    if (value) {
      const image = new Image()
      image.onload = () => {
        ctx.drawImage(image, 0, 0, width, height)
        setHasDrawing(true)
      }
      image.src = value
    }
  }, [width, height, value])

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width ? width / rect.width : 1
    const scaleY = rect.height ? height / rect.height : 1
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    drawingRef.current = true
    lastPointRef.current = getPoint(event)
    canvasRef.current?.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const last = lastPointRef.current
    if (!canvas || !ctx || !last) return
    const point = getPoint(event)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
  }

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    canvasRef.current?.releasePointerCapture(event.pointerId)
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    setHasDrawing(true)
    onChange(dataUrl)
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = DOCUMENT_PAPER
    ctx.fillRect(0, 0, width, height)
    setHasDrawing(false)
    onChange(null)
  }

  const frameStyle = {
    '--signature-width': `${width}px`,
    '--signature-ratio': `${width} / ${height}`,
  } as React.CSSProperties

  return (
    <div className={surface === 'paper' ? `${styles.container} ${styles.paper}` : styles.container}>
      <div className={styles.frame} style={frameStyle}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerLeave={finishStroke}
          onPointerCancel={finishStroke}
          className={styles.canvas}
          aria-label="Zone de signature"
          aria-describedby={hint ? hintId : undefined}
        />
        {!hasDrawing && (
          <div className={styles.placeholder} aria-hidden="true">
            <Pen />
            <span>Signez ici</span>
          </div>
        )}
      </div>
      <div className={styles.controls}>
        <Button
          type="button"
          variant="text"
          size="sm"
          className={styles.clearButton}
          onClick={handleClear}
          disabled={!hasDrawing}
        >
          <Eraser aria-hidden="true" />
          Effacer
        </Button>
        {hint !== undefined && <p id={hintId} className={styles.hint}>{hint}</p>}
      </div>
    </div>
  )
}
