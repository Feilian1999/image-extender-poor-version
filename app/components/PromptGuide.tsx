'use client'

import { useState } from 'react'
import { Icons } from '@/app/components/icons'
import { Mode } from '@/app/lib/app'
import {
  buildPropSheetPromptText,
  buildSpriteSheetPromptText,
  buildTileSheetPromptText,
  PROP_TEMPLATE_COLS,
  PROP_TEMPLATE_ROWS,
  TILE_TEMPLATE_CELL,
  TILE_TEMPLATE_COLS,
  TILE_TEMPLATE_ROWS,
  SPRITE_ANIM_OPTIONS,
  SPRITE_TEMPLATE_CELL,
  SPRITE_TEMPLATE_COLS,
  SPRITE_TEMPLATE_ROWS,
  SpriteChoreoAnim,
} from '@/app/lib/promptTemplates'

type Tab = 'sprite' | 'tile' | 'props'

const TABS: { value: Tab; label: string; Icon: React.FC<{ size?: number; className?: string }>; studio: Mode }[] = [
  { value: 'sprite', label: 'Sprite sheet', Icon: Icons.Play, studio: 'sprite' },
  { value: 'tile', label: 'Tile map', Icon: Icons.Layers, studio: 'tile' },
  { value: 'props', label: 'Prop atlas', Icon: Icons.Sprout, studio: 'props' },
]

/** Copy-to-clipboard button with a transient "Copied" state. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setCopied(false)
        }
      }}
      title="Copy the full prompt to the clipboard"
    >
      {copied ? <Icons.Check size={14} /> : <Icons.Download size={14} />}
      {copied ? 'Copied' : 'Copy prompt'}
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-md)] px-3 py-2 text-[13px] outline-none"
        style={{
          border: '1px solid var(--border-strong)',
          background: 'var(--bg-elev)',
          color: 'var(--text)',
        }}
      />
    </label>
  )
}

/**
 * Prompt Guide — a read-only page of copy-paste prompt templates so a user can
 * generate the "big sheet" on ANY external image generator (handy now that
 * Google's free tier is gone), then bring the result back via each studio's
 * "Import" button to slice / de-background / export it with no API call.
 */
export function PromptGuide({ onGoToStudio }: { onGoToStudio: (m: Mode) => void }) {
  const [tab, setTab] = useState<Tab>('sprite')
  const [anim, setAnim] = useState<SpriteChoreoAnim>('walk')
  const [character, setCharacter] = useState('')
  const [material, setMaterial] = useState('')
  const [theme, setTheme] = useState('')

  const spriteW = SPRITE_TEMPLATE_COLS * SPRITE_TEMPLATE_CELL
  const spriteH = SPRITE_TEMPLATE_ROWS * SPRITE_TEMPLATE_CELL

  const prompt =
    tab === 'sprite'
      ? buildSpriteSheetPromptText(anim, character)
      : tab === 'tile'
        ? buildTileSheetPromptText(material)
        : buildPropSheetPromptText(theme)

  const activeTab = TABS.find((t) => t.value === tab)!

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 pb-6 pt-3 sm:px-6">
      {/* Intro */}
      <div className="flex items-center justify-center gap-2 text-center text-[12px]">
        <Icons.Guide size={14} className="text-[color:var(--accent)]" />
        <span style={{ color: 'var(--text-secondary)' }}>
          Prompt Guide — copy a template, generate the sheet on any external AI
          image tool, then come back and use that studio&apos;s{' '}
          <span style={{ color: 'var(--text)' }}>Import</span> button to slice,
          de-background, and export it. No API key needed for this flow.
        </span>
      </div>

      {/* Tab switcher */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {TABS.map(({ value, label, Icon }) => {
          const active = tab === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-bg)' : 'var(--bg-elev)',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          )
        })}
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {/* Inputs per tab */}
        {tab === 'sprite' && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-col gap-1.5 sm:w-52">
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Animation
              </span>
              <select
                value={anim}
                onChange={(e) => setAnim(e.target.value as SpriteChoreoAnim)}
                className="w-full rounded-[var(--radius-md)] px-3 py-2 text-[13px] outline-none"
                style={{
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg-elev)',
                  color: 'var(--text)',
                }}
              >
                {SPRITE_ANIM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex-1">
              <Field
                label="Character description"
                value={character}
                onChange={setCharacter}
                placeholder="e.g. a small knight in blue plate armor with a short sword"
              />
            </div>
          </div>
        )}
        {tab === 'tile' && (
          <Field
            label="Material"
            value={material}
            onChange={setMaterial}
            placeholder="e.g. mossy gray stone bricks"
          />
        )}
        {tab === 'props' && (
          <Field
            label="World / theme"
            value={theme}
            onChange={setTheme}
            placeholder="e.g. lush jungle foliage and mushrooms"
          />
        )}

        {/* Usage hint per tab */}
        <div
          className="rounded-[var(--radius-md)] px-3.5 py-2.5 text-[12px] leading-relaxed"
          style={{
            border: '1px solid var(--border)',
            background: 'var(--bg-elev)',
            color: 'var(--text-secondary)',
          }}
        >
          {tab === 'sprite' && (
            <>
              Set your generator&apos;s output to{' '}
              <strong style={{ color: 'var(--text)' }}>
                {spriteW}×{spriteH}
              </strong>{' '}
              ({SPRITE_TEMPLATE_COLS}×{SPRITE_TEMPLATE_ROWS} grid,{' '}
              {SPRITE_TEMPLATE_COLS * SPRITE_TEMPLATE_ROWS} frames). Keep the
              magenta <code>#FF00FF</code> background — the importer keys it to
              transparency. Then go to{' '}
              <strong style={{ color: 'var(--text)' }}>Sprite → Import finished sheet</strong>.
            </>
          )}
          {tab === 'tile' && (
            <>
              Set your generator&apos;s output to{' '}
              <strong style={{ color: 'var(--text)' }}>
                {TILE_TEMPLATE_COLS * TILE_TEMPLATE_CELL}×
                {TILE_TEMPLATE_ROWS * TILE_TEMPLATE_CELL}
              </strong>{' '}
              (square, {TILE_TEMPLATE_COLS}×{TILE_TEMPLATE_ROWS} grid). This is a{' '}
              <strong style={{ color: 'var(--text)' }}>text-to-image</strong> prompt
              — each cell is one autotile piece, so it slices on clean, uniform
              cells (no “rectangle-with-a-hole” geometry to match). Keep the
              magenta <code>#FF00FF</code> background. Then go to{' '}
              <strong style={{ color: 'var(--text)' }}>Tiles → Import grid</strong>.
            </>
          )}
          {tab === 'props' && (
            <>
              Set your generator&apos;s output to{' '}
              <strong style={{ color: 'var(--text)' }}>
                {PROP_TEMPLATE_COLS * SPRITE_TEMPLATE_CELL}×
                {PROP_TEMPLATE_ROWS * SPRITE_TEMPLATE_CELL}
              </strong>{' '}
              ({PROP_TEMPLATE_COLS}×{PROP_TEMPLATE_ROWS} grid). Keep the magenta{' '}
              <code>#FF00FF</code> background. Then go to{' '}
              <strong style={{ color: 'var(--text)' }}>Props → Import atlas</strong>.
            </>
          )}
        </div>

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={prompt} />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onGoToStudio(activeTab.studio)}
            title={`Switch to the ${activeTab.label} studio to import your generated sheet`}
          >
            <activeTab.Icon size={14} />
            Go to {activeTab.label}
          </button>
        </div>

        {/* The prompt itself */}
        <pre
          className="max-h-[46vh] overflow-auto rounded-[var(--radius-md)] p-3.5 text-[11.5px] leading-relaxed"
          style={{
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          {prompt}
        </pre>
      </div>
    </div>
  )
}
