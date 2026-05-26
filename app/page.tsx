'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  createChunkedExtension,
  createFullContextExtension,
  applyFullContextResult,
  isAiExtensionUnfilled,
  measureSeamResidual,
  stitchExtendedChunk,
} from './utils/imageProcessor'

type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * One generated extension result. For horizontal extensions we produce up to
 * `maxAttempts` candidates, sort them by seam quality (lowest residual first),
 * and let the user cycle through them before accepting. Vertical extensions
 * produce a single candidate (the chunked path is deterministic enough that
 * multiple tries rarely help).
 */
type Candidate = {
  /** Fully blended, ready-to-display image data URL. */
  imageUrl: string
  /** Mean color difference at the seam — lower = cleaner blend. */
  score: number
  /** 1-indexed generation order, useful for debug logging. */
  attempt: number
}

/**
 * Extension percent is fixed in code. 38% is the sweet spot we converged on —
 * large enough to feel useful, small enough that the AI keeps the scene
 * coherent. Iterative extensions chain naturally if the user wants more.
 */
const EXTENSION_PERCENT = 38

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter integration — BYOK (bring your own key) for open-source friendliness
// ─────────────────────────────────────────────────────────────────────────────

type ModelOption = {
  value: string
  label: string
  hint?: string
  /**
   * Max best-of-N attempts for horizontal extensions on this model.
   * Slow models (GPT-5.4-image-2 takes ~4 min/call) get 1 to avoid
   * multi-minute blind waits; fast models get 3 for seam-quality picking.
   */
  maxAttempts: number
  /** Rough single-call expected duration, shown to the user as guidance. */
  approxSecondsPerCall: number
}

const MODELS: ModelOption[] = [
  {
    value: 'google/gemini-3.1-flash-image-preview',
    label: 'Gemini 3 Flash Image',
    hint: 'Nano Banana 2 · fast · default',
    maxAttempts: 3,
    approxSecondsPerCall: 18,
  },
  {
    value: 'google/gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    hint: 'Nano Banana · stable',
    maxAttempts: 3,
    approxSecondsPerCall: 15,
  },
]

const DEFAULT_MODEL = MODELS[0].value

function getModelConfig(value: string): ModelOption {
  return MODELS.find((m) => m.value === value) || MODELS[0]
}

const STORAGE_KEY = 'extender:api_key'
const STORAGE_MODEL = 'extender:model'

// ─────────────────────────────────────────────────────────────────────────────
// Inline icons — minimal SVG primitives, zero dependencies
// ─────────────────────────────────────────────────────────────────────────────

type IconProps = { size?: number; className?: string }
const svg = (path: React.ReactNode, viewBox = '0 0 24 24'): React.FC<IconProps> =>
  function Icon({ size = 18, className }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    )
  }

const Icons = {
  ArrowUp: svg(<path d="M12 19V5M5 12l7-7 7 7" />),
  ArrowDown: svg(<path d="M12 5v14M19 12l-7 7-7-7" />),
  ArrowLeft: svg(<path d="M19 12H5M12 19l-7-7 7-7" />),
  ArrowRight: svg(<path d="M5 12h14M12 5l7 7-7 7" />),
  Settings: svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  Sparkle: svg(
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14zM5 5l.6 1.7L7.3 7.3 5.6 7.9 5 9.6l-.6-1.7L2.7 7.3l1.7-.6L5 5z" />
  ),
  Check: svg(<polyline points="20 6 9 17 4 12" />),
  X: svg(<path d="M18 6L6 18M6 6l12 12" />),
  Refresh: svg(
    <>
      <polyline points="1 4 1 10 7 10" />
      <polyline points="23 20 23 14 17 14" />
      <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
    </>
  ),
  Download: svg(
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  ),
  Upload: svg(
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  ),
  Plus: svg(<path d="M12 5v14M5 12h14" />),
  Spinner: ({ size = 18, className }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`${className ?? ''} animate-spin`}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  ),
  CornerFrame: svg(
    <>
      <path d="M3 9V5a2 2 0 0 1 2-2h4" />
      <path d="M21 9V5a2 2 0 0 0-2-2h-4" />
      <path d="M3 15v4a2 2 0 0 0 2 2h4" />
      <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
    </>
  ),
  Eye: svg(
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  EyeOff: svg(
    <>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </>
  ),
  Key: svg(
    <>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </>
  ),
  External: svg(
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </>
  ),
  AlertTriangle: svg(
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  Trash: svg(
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </>
  ),
}

/** Mask all but the last 4 chars of an API key for display. */
function maskKey(key: string): string {
  if (!key) return ''
  const tail = key.slice(-4)
  return `${'•'.repeat(Math.max(4, Math.min(20, key.length - 4)))}${tail}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Art styles — flat list with optional grouping for the dropdown
// ─────────────────────────────────────────────────────────────────────────────

const ART_STYLE_GROUPS: { label: string; options: { value: string; label: string }[] }[] = [
  {
    label: 'Match original',
    options: [{ value: 'none', label: 'Match original style' }],
  },
  {
    label: 'Photography',
    options: [
      { value: 'cinematic', label: 'Cinematic' },
      { value: 'vintage', label: 'Vintage film' },
      { value: 'black-white', label: 'Black & white' },
      { value: 'macro', label: 'Macro' },
    ],
  },
  {
    label: 'Painting',
    options: [
      { value: 'oil-painting', label: 'Oil painting' },
      { value: 'watercolor', label: 'Watercolor' },
      { value: 'impressionism', label: 'Impressionism' },
      { value: 'abstract', label: 'Abstract' },
      { value: 'pop-art', label: 'Pop art' },
      { value: 'cubism', label: 'Cubism' },
      { value: 'minimalist', label: 'Minimalist' },
    ],
  },
  {
    label: 'Digital',
    options: [
      { value: 'digital-art', label: 'Digital art' },
      { value: 'cyberpunk', label: 'Cyberpunk' },
      { value: 'vaporwave', label: 'Vaporwave' },
      { value: 'low-poly', label: 'Low poly' },
      { value: 'pixel-art', label: 'Pixel art' },
      { value: '3d-render', label: '3D render' },
    ],
  },
  {
    label: 'Illustration',
    options: [
      { value: 'anime', label: 'Anime' },
      { value: 'cartoon', label: 'Cartoon' },
      { value: 'comic-book', label: 'Comic book' },
      { value: 'sketch', label: 'Pencil sketch' },
      { value: 'ink', label: 'Ink drawing' },
    ],
  },
  {
    label: 'Animation studios',
    options: [
      { value: 'studio-ghibli', label: 'Studio Ghibli' },
      { value: 'pixar', label: 'Pixar' },
      { value: 'disney', label: 'Disney' },
      { value: 'dreamworks', label: 'DreamWorks' },
      { value: 'illumination', label: 'Illumination' },
      { value: 'laika', label: 'Laika' },
      { value: 'cartoon-network', label: 'Cartoon Network' },
      { value: 'nickelodeon', label: 'Nickelodeon' },
      { value: 'aardman', label: 'Aardman' },
      { value: 'blue-sky', label: 'Blue Sky' },
    ],
  },
  {
    label: 'Fantasy & retro',
    options: [
      { value: 'fantasy', label: 'Fantasy' },
      { value: 'sci-fi', label: 'Sci-fi' },
      { value: 'steampunk', label: 'Steampunk' },
      { value: 'surreal', label: 'Surreal' },
      { value: 'art-deco', label: 'Art Deco' },
      { value: 'art-nouveau', label: 'Art Nouveau' },
      { value: 'retro-80s', label: '80s retro' },
      { value: 'retro-50s', label: '50s vintage' },
    ],
  },
]

const findStyleLabel = (value: string) => {
  for (const group of ART_STYLE_GROUPS) {
    const opt = group.options.find((o) => o.value === value)
    if (opt) return opt.label
  }
  return 'Match original'
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational components
// ─────────────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-md"
        style={{
          background: 'linear-gradient(135deg, var(--accent), #e07b00)',
          color: '#1a1404',
        }}
      >
        <Icons.CornerFrame size={16} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold tracking-tight">Extender</span>
        <span className="text-[11px] font-mono text-[var(--text-muted)]">v2</span>
      </div>
    </div>
  )
}

function TopBar({
  hasImage,
  onNewImage,
  onShowSettings,
}: {
  hasImage: boolean
  onNewImage: () => void
  onShowSettings: () => void
}) {
  return (
    <header
      className="relative z-20 flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6"
      style={{ borderColor: 'var(--border)' }}
    >
      <Logo />
      <div className="flex items-center gap-1.5">
        {hasImage && (
          <button onClick={onNewImage} className="btn btn-ghost">
            <Icons.Plus size={15} />
            New image
          </button>
        )}
        <button
          onClick={onShowSettings}
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
        >
          <Icons.Settings size={17} />
        </button>
      </div>
    </header>
  )
}

function StatusPill({
  status,
  message,
}: {
  status: 'idle' | 'working' | 'error' | 'ok'
  message: string
}) {
  const color =
    status === 'error'
      ? 'var(--danger)'
      : status === 'ok'
        ? 'var(--success)'
        : status === 'working'
          ? 'var(--accent)'
          : 'var(--text-muted)'
  return (
    <div
      className="anim-slide-down flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px]"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-elev)',
        color,
      }}
    >
      {status === 'working' ? (
        <Icons.Spinner size={12} />
      ) : (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: 'currentColor' }}
        />
      )}
      <span style={{ color: 'var(--text-secondary)' }}>{message}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge handles — spatial direction selectors that sit ON the image edges
// ─────────────────────────────────────────────────────────────────────────────

function EdgeHandle({
  direction,
  onClick,
  active,
  disabled,
}: {
  direction: Direction
  onClick: (d: Direction) => void
  active: boolean
  disabled: boolean
}) {
  const Icon = {
    up: Icons.ArrowUp,
    down: Icons.ArrowDown,
    left: Icons.ArrowLeft,
    right: Icons.ArrowRight,
  }[direction]

  const position: React.CSSProperties = {
    up: { top: -22, left: '50%', transform: 'translateX(-50%)' },
    down: { bottom: -22, left: '50%', transform: 'translateX(-50%)' },
    left: { left: -22, top: '50%', transform: 'translateY(-50%)' },
    right: { right: -22, top: '50%', transform: 'translateY(-50%)' },
  }[direction]

  return (
    <button
      onClick={() => onClick(direction)}
      disabled={disabled}
      title={`Extend ${direction}`}
      aria-label={`Extend ${direction}`}
      className={`group absolute z-10 flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 ${
        active ? 'anim-pulse' : ''
      }`}
      style={{
        ...position,
        background: active ? 'var(--accent)' : 'var(--bg-elev)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        color: active ? '#1a1404' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !active ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.borderColor = 'var(--accent)'
        e.currentTarget.style.color = active ? '#1a1404' : 'var(--accent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = active
          ? 'var(--accent)'
          : 'var(--border-strong)'
        e.currentTarget.style.color = active ? '#1a1404' : 'var(--text-secondary)'
      }}
    >
      <Icon size={18} />
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace — image with edge handles, dimensions label, and result actions
// ─────────────────────────────────────────────────────────────────────────────

function Workspace({
  image,
  dimensions,
  onExtend,
  activeDirection,
  loading,
  progressMessage,
  isResult,
  resultMessage,
  variantSelector,
  resultActions,
}: {
  image: string
  dimensions: { width: number; height: number } | null
  onExtend: (d: Direction) => void
  activeDirection: Direction | null
  loading: boolean
  progressMessage?: string | null
  isResult: boolean
  resultMessage?: string
  /**
   * Optional cycle-between-variants control rendered next to the dimension
   * pill. Only shown when the current extension produced more than one
   * candidate.
   */
  variantSelector?: React.ReactNode
  resultActions?: React.ReactNode
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-6 pt-2">
      {/* Image frame */}
      <div className="relative max-h-[calc(100vh-260px)] max-w-[min(1200px,calc(100vw-96px))] anim-fade">
        {/* Edge glow overlays for the active direction */}
        {activeDirection && (
          <div
            className={`pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] edge-glow-${activeDirection}`}
          />
        )}

        <div
          className="relative overflow-hidden rounded-[var(--radius-lg)] checker"
          style={{
            border: '1px solid var(--border)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.4)',
          }}
        >
          <img
            src={image}
            alt=""
            className="block max-h-[calc(100vh-260px)] max-w-[min(1200px,calc(100vw-96px))] object-contain anim-fade"
            draggable={false}
          />
        </div>

        {/* Edge handles — only when not displaying a result */}
        {!isResult && (
          <>
            <EdgeHandle
              direction="up"
              onClick={onExtend}
              active={activeDirection === 'up'}
              disabled={loading}
            />
            <EdgeHandle
              direction="down"
              onClick={onExtend}
              active={activeDirection === 'down'}
              disabled={loading}
            />
            <EdgeHandle
              direction="left"
              onClick={onExtend}
              active={activeDirection === 'left'}
              disabled={loading}
            />
            <EdgeHandle
              direction="right"
              onClick={onExtend}
              active={activeDirection === 'right'}
              disabled={loading}
            />
          </>
        )}
      </div>

      {/* Below-image meta row */}
      <div className="mt-5 flex items-center gap-3 anim-slide-up">
        {dimensions && (
          <div
            className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-elev)',
              color: 'var(--text-secondary)',
            }}
          >
            {dimensions.width} × {dimensions.height}
          </div>
        )}
        {isResult && variantSelector}
        {isResult && resultMessage && (
          <StatusPill status="ok" message={resultMessage} />
        )}
        {!isResult && !loading && (
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Click an edge to extend
          </span>
        )}
        {loading && (
          <StatusPill
            status="working"
            message={progressMessage || (activeDirection ? `Extending ${activeDirection}…` : 'Working…')}
          />
        )}
      </div>

      {isResult && resultActions && (
        <div className="mt-4 anim-slide-up">{resultActions}</div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — drop zone for upload + generate link
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({
  onPickFile,
  onGenerate,
  onDropFile,
}: {
  onPickFile: () => void
  onGenerate: () => void
  onDropFile: (file: File) => void
}) {
  const [drag, setDrag] = useState(false)
  return (
    <div className="flex flex-1 items-center justify-center px-6 pb-8 pt-4">
      <div className="w-full max-w-2xl anim-fade">
        <div
          onClick={onPickFile}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const file = e.dataTransfer.files?.[0]
            if (file && file.type.startsWith('image/')) onDropFile(file)
          }}
          className="group relative cursor-pointer rounded-[var(--radius-lg)] px-8 py-20 text-center transition-all"
          style={{
            border: `1.5px dashed ${
              drag ? 'var(--accent)' : 'var(--border-strong)'
            }`,
            background: drag ? 'var(--accent-bg)' : 'var(--bg-elev)',
          }}
        >
          <div
            className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full transition-transform group-hover:scale-110"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--accent)',
            }}
          >
            <Icons.Upload size={24} />
          </div>
          <p className="mb-1.5 text-[15px] font-medium" style={{ color: 'var(--text)' }}>
            Drop an image to begin
          </p>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            PNG, JPG, or WEBP — click anywhere in this area to browse
          </p>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2 text-[13px]">
          <span style={{ color: 'var(--text-muted)' }}>or</span>
          <button
            onClick={onGenerate}
            className="inline-flex items-center gap-1.5 font-medium transition-colors"
            style={{ color: 'var(--accent)' }}
          >
            <Icons.Sparkle size={14} />
            generate one with AI
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CommandBar — floating bottom bar with prompt + style picker
// ─────────────────────────────────────────────────────────────────────────────

function CommandBar({
  prompt,
  setPrompt,
  artStyle,
  setArtStyle,
  loading,
  hint,
}: {
  prompt: string
  setPrompt: (v: string) => void
  artStyle: string
  setArtStyle: (v: string) => void
  loading: boolean
  hint?: string
}) {
  return (
    <div className="relative z-10 flex justify-center px-4 pb-6 pt-2">
      <div
        className="anim-slide-up flex w-full max-w-3xl items-stretch gap-2 rounded-[var(--radius-lg)] p-1.5"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 12px 32px -12px rgba(0,0,0,0.6)',
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={loading}
          placeholder={
            hint ?? 'Optional: describe what should appear in the new area…'
          }
          className="flex-1 bg-transparent px-3 py-2.5 text-[14px] focus:outline-none"
          style={{ color: 'var(--text)' }}
        />

        <div
          className="hidden items-center sm:flex"
          style={{ borderLeft: '1px solid var(--border)' }}
        >
          <select
            value={artStyle}
            onChange={(e) => setArtStyle(e.target.value)}
            disabled={loading}
            className="select-styled cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[13px] focus:outline-none"
            style={{ color: 'var(--text-secondary)' }}
            title="Art style for the extension"
          >
            {ART_STYLE_GROUPS.map((group) =>
              group.options.length === 1 && group.label === 'Match original' ? (
                <option key={group.options[0].value} value={group.options[0].value}>
                  {group.options[0].label}
                </option>
              ) : (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )
            )}
          </select>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant selector — cycle between AI-generated extension candidates
// ─────────────────────────────────────────────────────────────────────────────

function VariantSelector({
  index,
  total,
  isBest,
  score,
  onPrev,
  onNext,
}: {
  index: number
  total: number
  /** True when the current variant is the algorithm-picked best blend. */
  isBest: boolean
  /** Optional raw seam score, only shown in debug mode. */
  score?: number
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-1 pr-2 anim-fade"
      style={{
        borderColor: 'var(--border-strong)',
        background: 'var(--bg-elev)',
      }}
      role="group"
      aria-label="Cycle between extension variants"
    >
      <button
        onClick={onPrev}
        className="icon-btn h-6 w-6"
        aria-label="Previous variant (←)"
        title="Previous variant (←)"
      >
        <Icons.ArrowLeft size={13} />
      </button>
      <span
        className="font-mono text-[11px] tabular-nums"
        style={{ color: 'var(--text-secondary)' }}
      >
        Variant {index + 1}/{total}
      </span>
      {isBest && (
        <span
          className="rounded-full px-1.5 py-px text-[10px] font-medium tracking-wide"
          style={{
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-border)',
          }}
          title="Algorithm's pick: lowest seam residual"
        >
          BEST
        </span>
      )}
      {typeof score === 'number' && (
        <span
          className="font-mono text-[10px]"
          style={{ color: 'var(--text-muted)' }}
          title="Mean color difference at the seam — lower is better"
        >
          {score.toFixed(1)}
        </span>
      )}
      <button
        onClick={onNext}
        className="icon-btn h-6 w-6"
        aria-label="Next variant (→)"
        title="Next variant (→)"
      >
        <Icons.ArrowRight size={13} />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Result actions — appears below the image when an extension is ready
// ─────────────────────────────────────────────────────────────────────────────

function ResultActions({
  onAccept,
  onRegenerate,
  onDiscard,
  onDownload,
  loading,
}: {
  onAccept: () => void
  onRegenerate: () => void
  onDiscard: () => void
  onDownload: () => void
  loading: boolean
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border p-1"
      style={{
        background: 'var(--bg-elev)',
        borderColor: 'var(--border-strong)',
        boxShadow: '0 12px 32px -16px rgba(0,0,0,0.6)',
      }}
    >
      <button
        onClick={onDiscard}
        disabled={loading}
        className="btn btn-ghost"
        title="Discard this extension"
      >
        <Icons.X size={14} />
        Discard
      </button>
      <button
        onClick={onRegenerate}
        disabled={loading}
        className="btn btn-ghost"
        title="Generate a new variation"
      >
        {loading ? <Icons.Spinner size={14} /> : <Icons.Refresh size={14} />}
        Regenerate
      </button>
      <button
        onClick={onDownload}
        disabled={loading}
        className="btn btn-ghost"
        title="Download as PNG"
      >
        <Icons.Download size={14} />
        Download
      </button>
      <div
        className="mx-1 h-5 w-px"
        style={{ background: 'var(--border)' }}
        aria-hidden
      />
      <button
        onClick={onAccept}
        disabled={loading}
        className="btn btn-primary"
        title="Use this as the new base image"
      >
        <Icons.Check size={14} />
        Accept
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings drawer — debug mode, generate-from-scratch entry point
// ─────────────────────────────────────────────────────────────────────────────

function SettingsDrawer({
  open,
  onClose,
  debugMode,
  setDebugMode,
  onGenerate,
  apiKey,
  onEditApiKey,
  onClearApiKey,
  selectedModel,
  setSelectedModel,
}: {
  open: boolean
  onClose: () => void
  debugMode: boolean
  setDebugMode: (v: boolean) => void
  onGenerate: () => void
  apiKey: string
  onEditApiKey: () => void
  onClearApiKey: () => void
  selectedModel: string
  setSelectedModel: (v: string) => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div
        className="fixed inset-0 z-30 anim-fade"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col anim-slide-up"
        style={{
          background: 'var(--bg-elev)',
          borderLeft: '1px solid var(--border-strong)',
        }}
      >
        <div
          className="flex h-14 shrink-0 items-center justify-between border-b px-5"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-[14px] font-semibold tracking-tight">Settings</h2>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <Icons.X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <Section title="Model">
            <div className="space-y-2">
              {MODELS.map((m) => {
                const active = m.value === selectedModel
                return (
                  <button
                    key={m.value}
                    onClick={() => setSelectedModel(m.value)}
                    className="flex w-full items-start gap-3 rounded-[var(--radius-sm)] p-3 text-left transition-colors"
                    style={{
                      background: active ? 'var(--accent-bg)' : 'var(--surface)',
                      border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                    }}
                  >
                    <div
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{
                        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: active ? 'var(--accent)' : 'transparent',
                      }}
                    >
                      {active && (
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: '#1a1404' }}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{m.label}</div>
                      <div
                        className="mt-0.5 truncate text-[11px]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {m.hint ? `${m.hint} · ` : ''}
                        <code className="font-mono">{m.value}</code>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="OpenRouter key">
            {apiKey ? (
              <div
                className="flex items-center gap-3 rounded-[var(--radius-sm)] p-3"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                >
                  <Icons.Key size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium">Key saved locally</div>
                  <div
                    className="truncate font-mono text-[11px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {maskKey(apiKey)}
                  </div>
                </div>
                <button
                  onClick={onEditApiKey}
                  className="icon-btn"
                  aria-label="Edit key"
                  title="Edit key"
                >
                  <Icons.Settings size={14} />
                </button>
                <button
                  onClick={onClearApiKey}
                  className="icon-btn"
                  aria-label="Remove key"
                  title="Remove key"
                >
                  <Icons.Trash size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={onEditApiKey}
                className="btn btn-secondary w-full justify-start"
              >
                <Icons.Key size={14} />
                Add OpenRouter key
              </button>
            )}
            <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Stored only in this browser. Get one at{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                openrouter.ai/keys
              </a>
              .
            </p>
          </Section>

          <Section title="Tools">
            <button
              onClick={() => {
                onClose()
                onGenerate()
              }}
              className="btn btn-secondary w-full justify-start"
            >
              <Icons.Sparkle size={15} />
              Generate image from scratch
            </button>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Create a brand-new image from a text description, then extend it.
            </p>
          </Section>

          <Section title="Developer">
            <Toggle
              label="Debug overlay"
              description="Draw seam guides and log Poisson scores to the console."
              checked={debugMode}
              onChange={setDebugMode}
            />
          </Section>

          <Section title="About">
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Extensions are 38% of the current image dimension. For larger
              extensions, click an edge again after accepting.
            </p>
            <p
              className="mt-3 text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              Seamless blending via Poisson editing (Pérez et al. 2003).
            </p>
          </Section>
        </div>
      </aside>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3
        className="mb-3 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-[var(--radius-sm)] py-1">
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {description && (
          <div
            className="mt-0.5 text-[12px] leading-snug"
            style={{ color: 'var(--text-muted)' }}
          >
            {description}
          </div>
        )}
      </div>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{
          background: checked ? 'var(--accent)' : 'var(--surface)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        }}
      >
        <span
          className="inline-block h-3 w-3 rounded-full transition-transform"
          style={{
            background: checked ? '#1a1404' : 'var(--text-secondary)',
            transform: checked ? 'translateX(18px)' : 'translateX(3px)',
          }}
        />
      </span>
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate modal — text-to-image
// ─────────────────────────────────────────────────────────────────────────────

function GenerateModal({
  open,
  onClose,
  prompt,
  setPrompt,
  width,
  setWidth,
  height,
  setHeight,
  artStyle,
  setArtStyle,
  generating,
  onGenerate,
}: {
  open: boolean
  onClose: () => void
  prompt: string
  setPrompt: (v: string) => void
  width: number
  setWidth: (v: number) => void
  height: number
  setHeight: (v: number) => void
  artStyle: string
  setArtStyle: (v: string) => void
  generating: boolean
  onGenerate: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />
      <div
        className="anim-slide-up relative w-full max-w-lg rounded-[var(--radius-lg)] p-6"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 32px 64px -16px rgba(0,0,0,0.8)',
        }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
            >
              <Icons.Sparkle size={15} />
            </div>
            <h2 className="text-[15px] font-semibold tracking-tight">
              Generate image
            </h2>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <Icons.X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              Description
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A wide mountain valley at golden hour, with a winding river through pine forest"
              rows={3}
              className="field resize-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Width
              </label>
              <select
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="field select-styled"
              >
                {[512, 768, 1024, 1280, 1536].map((v) => (
                  <option key={v} value={v}>
                    {v}px
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Height
              </label>
              <select
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="field select-styled"
              >
                {[512, 768, 1024, 1280, 1536].map((v) => (
                  <option key={v} value={v}>
                    {v}px
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              Style
            </label>
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value)}
              className="field select-styled"
            >
              {ART_STYLE_GROUPS.map((group) =>
                group.options.length === 1 && group.label === 'Match original' ? (
                  <option key={group.options[0].value} value={group.options[0].value}>
                    Photorealistic
                  </option>
                ) : (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )
              )}
            </select>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={generating} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={onGenerate}
            disabled={generating || !prompt.trim()}
            className="btn btn-primary"
          >
            {generating ? <Icons.Spinner size={14} /> : <Icons.Sparkle size={14} />}
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// API key modal — first-run prompt to BYOK
// ─────────────────────────────────────────────────────────────────────────────

function ApiKeyModal({
  open,
  initialValue,
  required,
  onSave,
  onSkip,
  onClose,
}: {
  open: boolean
  initialValue: string
  /** If true, the user can't dismiss without entering a key (no Skip / Esc). */
  required: boolean
  onSave: (key: string) => void
  onSkip?: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [reveal, setReveal] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, initialValue])

  useEffect(() => {
    if (!open || required) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, required, onClose])

  if (!open) return null

  const trimmed = value.trim()
  const looksValid = trimmed.startsWith('sk-or-') && trimmed.length > 20

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
        onClick={() => {
          if (!required) onClose()
        }}
      />
      <div
        className="anim-slide-up relative w-full max-w-md rounded-[var(--radius-lg)] p-6"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 32px 64px -16px rgba(0,0,0,0.8)',
        }}
      >
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-md"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
          >
            <Icons.Key size={17} />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {required ? 'Add your OpenRouter key' : 'OpenRouter API key'}
            </h2>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Required to generate or extend images.
            </p>
          </div>
          {!required && (
            <button onClick={onClose} className="icon-btn" aria-label="Close">
              <Icons.X size={16} />
            </button>
          )}
        </div>

        <div className="mb-4">
          <div className="relative">
            <input
              ref={inputRef}
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && looksValid) onSave(trimmed)
              }}
              placeholder="sk-or-..."
              className="field pr-10 font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="icon-btn absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
              aria-label={reveal ? 'Hide key' : 'Show key'}
              tabIndex={-1}
            >
              {reveal ? <Icons.EyeOff size={14} /> : <Icons.Eye size={14} />}
            </button>
          </div>
          {value && !looksValid && (
            <div
              className="mt-2 flex items-start gap-2 text-[12px]"
              style={{ color: 'var(--danger)' }}
            >
              <Icons.AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>OpenRouter keys start with <code className="font-mono">sk-or-</code>.</span>
            </div>
          )}
        </div>

        <div
          className="mb-4 rounded-[var(--radius-sm)] p-3 text-[12px] leading-relaxed"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          Your key is stored only in this browser&apos;s <code className="font-mono">localStorage</code>.
          It&apos;s sent with each request to your local server, which proxies it to OpenRouter — never logged, never persisted server-side.
        </div>

        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-5 inline-flex items-center gap-1.5 text-[12px] transition-colors"
          style={{ color: 'var(--accent)' }}
        >
          Get a key at openrouter.ai/keys
          <Icons.External size={11} />
        </a>

        <div className="flex items-center justify-between gap-2">
          {!required && onSkip ? (
            <button onClick={onSkip} className="btn btn-ghost">
              Use server env
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={() => onSave(trimmed)}
            disabled={!looksValid}
            className="btn btn-primary"
          >
            <Icons.Check size={14} />
            Save key
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Error toast — slides in at the top, auto-dismisses
// ─────────────────────────────────────────────────────────────────────────────

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div
      className="fixed left-1/2 top-4 z-50 -translate-x-1/2 anim-slide-down"
      role="alert"
    >
      <div
        className="flex items-start gap-3 rounded-[var(--radius)] px-4 py-3"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid rgba(255, 107, 107, 0.35)',
          boxShadow: '0 16px 40px -12px rgba(0,0,0,0.6)',
          maxWidth: 480,
        }}
      >
        <div className="mt-0.5" style={{ color: 'var(--danger)' }}>
          <Icons.X size={16} />
        </div>
        <div className="flex-1 text-[13px]" style={{ color: 'var(--text)' }}>
          {message}
        </div>
        <button onClick={onClose} className="icon-btn -m-1.5 h-7 w-7">
          <Icons.X size={14} />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  // Image state
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [originalFileName, setOriginalFileName] = useState('extended')
  /**
   * Candidates returned by the most recent extension. Sorted by seam quality
   * (best first). Length is 0 when there's no active result, 1+ otherwise.
   */
  const [extendedCandidates, setExtendedCandidates] = useState<Candidate[]>([])
  /** Which candidate the user is currently previewing. */
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0)
  /**
   * Dimensions per candidate. Indexed alongside `extendedCandidates`; written
   * lazily as each image loads (they're all the same size in practice but
   * computed individually so we never display stale dims during cycling).
   */
  const [candidateDims, setCandidateDims] = useState<Array<{ width: number; height: number } | null>>([])
  const [currentImageDimensions, setCurrentImageDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [imageBeforeExtension, setImageBeforeExtension] = useState<string | null>(null)
  const [lastExtensionParams, setLastExtensionParams] = useState<{
    direction: Direction
    customPrompt: string
    artStyle: string
  } | null>(null)

  // Operation state
  const [loading, setLoading] = useState(false)
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Live progress message shown in the loading pill (e.g. "Attempt 1/3 · 24s"). */
  const [progressMsg, setProgressMsg] = useState<string | null>(null)

  // Form state
  const [customPrompt, setCustomPrompt] = useState('')
  const [artStyle, setArtStyle] = useState('none')
  const [debugMode, setDebugMode] = useState(false)

  // Modal/drawer state
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generateWidth, setGenerateWidth] = useState(1024)
  const [generateHeight, setGenerateHeight] = useState(1024)
  const [generating, setGenerating] = useState(false)

  // BYOK: API key + model are persisted to localStorage. We start in a
  // "hydrating" state so we don't flash the modal before reading storage.
  const [apiKey, setApiKey] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL)
  const [hydrated, setHydrated] = useState(false)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  // Required-mode means the user can't dismiss the modal (first run, no key
  // anywhere). Optional-mode is used when editing an existing key from settings.
  const [apiKeyRequired, setApiKeyRequired] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Hydrate from localStorage on mount, and decide whether to show the modal.
  useEffect(() => {
    try {
      const k = localStorage.getItem(STORAGE_KEY) || ''
      const m = localStorage.getItem(STORAGE_MODEL) || ''
      setApiKey(k)
      if (m && MODELS.some((mm) => mm.value === m)) {
        setSelectedModel(m)
      }
      if (!k) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — show modal anyway.
      setApiKeyRequired(true)
      setShowApiKeyModal(true)
    } finally {
      setHydrated(true)
    }
  }, [])

  // Persist key + model changes.
  useEffect(() => {
    if (!hydrated) return
    try {
      if (apiKey) localStorage.setItem(STORAGE_KEY, apiKey)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [apiKey, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_MODEL, selectedModel)
    } catch {}
  }, [selectedModel, hydrated])

  const handleSaveApiKey = (key: string) => {
    setApiKey(key)
    setShowApiKeyModal(false)
    setApiKeyRequired(false)
  }

  const handleSkipApiKey = () => {
    // User has env-set key on server; let them proceed without a client key.
    setShowApiKeyModal(false)
    setApiKeyRequired(false)
  }

  const handleClearApiKey = () => {
    setApiKey('')
  }

  const handleEditApiKey = () => {
    setApiKeyRequired(false)
    setShowApiKeyModal(true)
  }

  const ensureCanGenerate = (): boolean => {
    // If no key and we're in required mode, re-open the modal instead of
    // making a request that would fail with 401.
    if (!apiKey && apiKeyRequired) {
      setShowApiKeyModal(true)
      return false
    }
    return true
  }

  // ── Image loaders ──────────────────────────────────────────────────────────

  const loadDataUrlAsImage = useCallback(
    (dataUrl: string, filename = 'image.png') => {
      setSelectedImage(dataUrl)
      setExtendedCandidates([])
      setCandidateDims([])
      setSelectedCandidateIdx(0)
      setError(null)
      setOriginalFileName(filename)
      const img = new Image()
      img.onload = () => {
        setCurrentImageDimensions({ width: img.width, height: img.height })
      }
      img.src = dataUrl
    },
    []
  )

  /**
   * Adopts a fresh set of candidates: stores them, resets selection to the
   * top (best-blend) variant, and kicks off async dimension reads for each so
   * the meta row stays accurate as the user cycles.
   */
  const adoptCandidates = useCallback((candidates: Candidate[]) => {
    setExtendedCandidates(candidates)
    setSelectedCandidateIdx(0)
    setCandidateDims(new Array(candidates.length).fill(null))
    candidates.forEach((c, idx) => {
      const img = new Image()
      img.onload = () => {
        setCandidateDims((prev) => {
          const next = prev.slice()
          next[idx] = { width: img.width, height: img.height }
          return next
        })
      }
      img.src = c.imageUrl
    })
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        loadDataUrlAsImage(dataUrl, file.name)
      }
      reader.readAsDataURL(file)
    },
    [loadDataUrlAsImage]
  )

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // ── Generate from scratch ──────────────────────────────────────────────────

  const handleGenerateImage = async () => {
    if (!generatePrompt.trim()) {
      setError('Please describe the image you want to generate.')
      return
    }
    if (!ensureCanGenerate()) return
    setGenerating(true)
    setError(null)
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: generatePrompt,
          width: generateWidth,
          height: generateHeight,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          apiKey: apiKey || undefined,
          model: selectedModel,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setApiKeyRequired(true)
          setShowApiKeyModal(true)
        }
        throw new Error(data.error || 'Failed to generate image')
      }
      if (!data.imageUrl) throw new Error('No image returned from API')
      loadDataUrlAsImage(data.imageUrl, 'generated.png')
      setShowGenerateModal(false)
      setGeneratePrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate image')
    } finally {
      setGenerating(false)
    }
  }

  // ── Extend ─────────────────────────────────────────────────────────────────

  const runExtend = useCallback(
    async (
      direction: Direction,
      sourceImage: string,
      promptText: string,
      style: string
    ) => {
      if (!currentImageDimensions) {
        throw new Error('Image dimensions not available yet.')
      }

      const callExtendApi = async (
        expandedCanvas: string,
        body: Record<string, unknown>
      ) => {
        const response = await fetch('/api/extend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expandedCanvas,
            direction,
            extensionAmount: EXTENSION_PERCENT,
            customPrompt: promptText.trim() || undefined,
            artStyle: style !== 'none' ? style : undefined,
            apiKey: apiKey || undefined,
            model: selectedModel,
            ...body,
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          const err = new Error(data.error || 'Failed to extend image') as Error & { status?: number }
          err.status = response.status
          throw err
        }
        return data.imageUrl as string
      }

      const isHorizontal = direction === 'left' || direction === 'right'
      const modelCfg = getModelConfig(selectedModel)

      if (isHorizontal) {
        const maxAttempts = Math.max(1, modelCfg.maxAttempts)
        // Collect every candidate so the user can cycle through them and pick.
        // We no longer early-break on a "good enough" score — the user said
        // they want to see all 3 and decide themselves.
        const candidates: Candidate[] = []

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const attemptStart = Date.now()
          // Tick a live elapsed-seconds counter inside the AI call so the UI
          // doesn't feel frozen during long requests.
          const tickHandle = setInterval(() => {
            const elapsed = Math.floor((Date.now() - attemptStart) / 1000)
            const label = maxAttempts > 1
              ? `Variant ${attempt + 1}/${maxAttempts} · ${elapsed}s`
              : `Generating · ${elapsed}s`
            setProgressMsg(label)
          }, 1000)

          try {
            const fullResult = await createFullContextExtension(
              sourceImage,
              direction,
              EXTENSION_PERCENT
            )
            const imageUrl = await callExtendApi(fullResult.fullImageWithBlankArea, {
              useFullContext: true,
              extensionInfo: fullResult.extensionInfo,
              attempt,
            })
            if (await isAiExtensionUnfilled(imageUrl, fullResult.extensionInfo)) {
              continue
            }
            const blended = await applyFullContextResult(
              imageUrl,
              fullResult.extensionInfo,
              sourceImage
            )
            const score = await measureSeamResidual(
              blended,
              fullResult.extensionInfo,
              sourceImage
            )
            if (debugMode) {
              // eslint-disable-next-line no-console
              console.log(
                `🔬 Variant ${attempt + 1} seam residual: ${score.toFixed(2)}`
              )
            }
            candidates.push({ imageUrl: blended, score, attempt: attempt + 1 })
          } finally {
            clearInterval(tickHandle)
          }
        }

        if (candidates.length === 0) {
          throw new Error(
            `AI failed to fill the extension area after ${maxAttempts} attempt${maxAttempts > 1 ? 's' : ''}. Try a different direction or model.`
          )
        }
        // Sort best (lowest seam residual) first so the user lands on the
        // cleanest blend by default but can cycle to alternatives.
        candidates.sort((a, b) => a.score - b.score)
        return candidates
      } else {
        const attemptStart = Date.now()
        const tickHandle = setInterval(() => {
          const elapsed = Math.floor((Date.now() - attemptStart) / 1000)
          setProgressMsg(`Generating · ${elapsed}s`)
        }, 1000)
        try {
          const result = await createChunkedExtension(
            sourceImage,
            direction,
            EXTENSION_PERCENT,
            40
          )
          const imageUrl = await callExtendApi(result.chunkToExtend, {
            chunkInfo: result.chunkInfo,
            useFullContext: false,
          })
          const stitched = await stitchExtendedChunk(sourceImage, imageUrl, result.chunkInfo, debugMode)
          // Vertical path produces a single variant. Wrap it so the caller
          // can treat horizontal + vertical results uniformly.
          return [{ imageUrl: stitched, score: 0, attempt: 1 }]
        } finally {
          clearInterval(tickHandle)
        }
      }
    },
    [currentImageDimensions, debugMode, apiKey, selectedModel]
  )

  const handleExtend = async (direction: Direction) => {
    if (!selectedImage || loading) return
    if (!ensureCanGenerate()) return
    setError(null)
    setLoading(true)
    setProgressMsg(`Extending ${direction}…`)
    setActiveDirection(direction)
    setImageBeforeExtension(selectedImage)
    setLastExtensionParams({ direction, customPrompt, artStyle })

    try {
      const candidates = await runExtend(
        direction,
        selectedImage,
        customPrompt,
        artStyle
      )
      adoptCandidates(candidates)
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || 'An error occurred')
      setActiveDirection(null)
      if (e.status === 401) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  const handleRegenerate = async () => {
    if (!lastExtensionParams || !imageBeforeExtension || loading) return
    if (!ensureCanGenerate()) return
    setError(null)
    setLoading(true)
    setProgressMsg(`Regenerating ${lastExtensionParams.direction}…`)
    try {
      const candidates = await runExtend(
        lastExtensionParams.direction,
        imageBeforeExtension,
        lastExtensionParams.customPrompt,
        lastExtensionParams.artStyle
      )
      adoptCandidates(candidates)
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || 'An error occurred')
      if (e.status === 401) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  const cycleVariant = (delta: 1 | -1) => {
    if (extendedCandidates.length <= 1) return
    setSelectedCandidateIdx((prev) => {
      const n = extendedCandidates.length
      return (prev + delta + n) % n
    })
  }

  /** The candidate the user is currently viewing (null when no result). */
  const activeCandidate: Candidate | null =
    extendedCandidates.length > 0
      ? extendedCandidates[Math.min(selectedCandidateIdx, extendedCandidates.length - 1)]
      : null

  const handleAccept = () => {
    if (!activeCandidate) return
    const accepted = activeCandidate.imageUrl
    setSelectedImage(accepted)
    const img = new Image()
    img.onload = () => {
      setCurrentImageDimensions({ width: img.width, height: img.height })
    }
    img.src = accepted
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }

  const handleDiscard = () => {
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }

  const handleDownload = () => {
    if (!activeCandidate) return
    const link = document.createElement('a')
    link.href = activeCandidate.imageUrl
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'extended'
    // Tag the filename with the variant index when there are multiple, so
    // batch-downloading different cycles doesn't overwrite the same file.
    const variantTag = extendedCandidates.length > 1
      ? `_v${selectedCandidateIdx + 1}`
      : ''
    link.download = `${baseName}_extended${variantTag}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleNewImage = () => {
    setSelectedImage(null)
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setCurrentImageDimensions(null)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
    setError(null)
    setCustomPrompt('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (!selectedImage || loading) return
      if (activeCandidate) {
        if (e.key === 'Enter') handleAccept()
        else if (e.key === 'Escape') handleDiscard()
        else if (e.key === 'r' || e.key === 'R') handleRegenerate()
        else if (e.key === 'ArrowLeft' && extendedCandidates.length > 1) {
          e.preventDefault()
          cycleVariant(-1)
        } else if (e.key === 'ArrowRight' && extendedCandidates.length > 1) {
          e.preventDefault()
          cycleVariant(1)
        }
        return
      }
      const mapping: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }
      const dir = mapping[e.key]
      if (dir) {
        e.preventDefault()
        handleExtend(dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage, loading, activeCandidate, extendedCandidates.length, customPrompt, artStyle])

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayImage = activeCandidate?.imageUrl ?? selectedImage
  const displayDimensions = activeCandidate
    ? candidateDims[selectedCandidateIdx] ?? null
    : currentImageDimensions
  const isResult = !!activeCandidate
  const variantCount = extendedCandidates.length

  return (
    <main className="relative flex min-h-screen flex-col">
      <TopBar
        hasImage={!!selectedImage}
        onNewImage={handleNewImage}
        onShowSettings={() => setShowSettings(true)}
      />

      {!displayImage ? (
        <EmptyState
          onPickFile={() => fileInputRef.current?.click()}
          onGenerate={() => setShowGenerateModal(true)}
          onDropFile={handleFile}
        />
      ) : (
        <Workspace
          image={displayImage}
          dimensions={displayDimensions}
          onExtend={handleExtend}
          activeDirection={activeDirection}
          loading={loading}
          progressMessage={progressMsg}
          isResult={isResult}
          resultMessage={
            isResult
              ? variantCount > 1
                ? `Cycle variants with ← →, then accept`
                : 'New extension ready — accept, regenerate, or discard'
              : undefined
          }
          variantSelector={
            isResult && variantCount > 1 ? (
              <VariantSelector
                index={selectedCandidateIdx}
                total={variantCount}
                isBest={selectedCandidateIdx === 0}
                score={debugMode ? activeCandidate?.score : undefined}
                onPrev={() => cycleVariant(-1)}
                onNext={() => cycleVariant(1)}
              />
            ) : undefined
          }
          resultActions={
            isResult ? (
              <ResultActions
                onAccept={handleAccept}
                onRegenerate={handleRegenerate}
                onDiscard={handleDiscard}
                onDownload={handleDownload}
                loading={loading}
              />
            ) : undefined
          }
        />
      )}

      {selectedImage && !isResult && (
        <CommandBar
          prompt={customPrompt}
          setPrompt={setCustomPrompt}
          artStyle={artStyle}
          setArtStyle={setArtStyle}
          loading={loading}
          hint={
            artStyle !== 'none'
              ? `Style: ${findStyleLabel(artStyle)} — describe what to add (optional)`
              : undefined
          }
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        onGenerate={() => setShowGenerateModal(true)}
        apiKey={apiKey}
        onEditApiKey={handleEditApiKey}
        onClearApiKey={handleClearApiKey}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
      />

      <ApiKeyModal
        open={showApiKeyModal}
        initialValue={apiKey}
        required={apiKeyRequired}
        onSave={handleSaveApiKey}
        onSkip={apiKeyRequired ? handleSkipApiKey : undefined}
        onClose={() => setShowApiKeyModal(false)}
      />

      <GenerateModal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        prompt={generatePrompt}
        setPrompt={setGeneratePrompt}
        width={generateWidth}
        setWidth={setGenerateWidth}
        height={generateHeight}
        setHeight={setGenerateHeight}
        artStyle={artStyle}
        setArtStyle={setArtStyle}
        generating={generating}
        onGenerate={handleGenerateImage}
      />

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </main>
  )
}
