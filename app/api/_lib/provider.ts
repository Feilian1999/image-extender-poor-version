// Server-side AI provider abstraction — BYOK with two key types:
//
//   • Google AI Studio keys ("AIza...") — FREE tier. Requests go directly to
//     the Google Gemini API (generativelanguage.googleapis.com). Image
//     generation uses gemini-2.5-flash-image (Nano Banana), which the free
//     tier covers (~500 requests/day, no credit card).
//   • OpenRouter keys ("sk-or-...") — paid. Requests go to openrouter.ai
//     exactly as before (the original behavior of this app).
//
// Every route builds OpenAI-style chat messages; this module dispatches on
// the key type, translates the request, and normalizes the response to
// { text, imageUrl }.

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, any>>
}

export class ProviderError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const MISSING_KEY_ERROR =
  'API key missing. Add a free Google AI Studio key (AIza...) or an OpenRouter key (sk-or-...) in Settings.'

/** Client-provided key wins; fall back to env for local dev / hosted demos. */
export function resolveApiKey(clientKey: unknown): string | null {
  if (typeof clientKey === 'string' && clientKey.trim()) return clientKey.trim()
  return (
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    null
  )
}

export function isGoogleKey(key: string): boolean {
  // "AIza..." = legacy Standard keys; "AQ...." = the Auth keys Google AI
  // Studio issues since 2026 (both work on the native generateContent
  // endpoint via the x-goog-api-key header).
  return key.startsWith('AIza') || key.startsWith('AQ.')
}

// Free-tier fallbacks on the Google API. Any model the Google API doesn't
// recognize (or a non-Gemini model like openai/gpt-*) maps here so a free
// key always works regardless of which model is selected in Settings.
const GOOGLE_IMAGE_FALLBACK = 'gemini-2.5-flash-image'
const GOOGLE_TEXT_FALLBACK = 'gemini-2.5-flash'

function googleModelId(model: string, wantImage: boolean): string {
  const m = model.replace(/^google\//, '')
  if (!m.startsWith('gemini')) return wantImage ? GOOGLE_IMAGE_FALLBACK : GOOGLE_TEXT_FALLBACK
  if (wantImage && !m.includes('image')) return GOOGLE_IMAGE_FALLBACK
  if (!wantImage && m.includes('image')) return GOOGLE_TEXT_FALLBACK
  return m
}

export interface ChatOptions {
  key: string
  /** OpenRouter-style model id (e.g. "google/gemini-2.5-flash-image"). */
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  /** Set when the call must return an image (enables image modalities). */
  wantImage?: boolean
  /** e.g. "16:9" — only used for image generation. */
  aspectRatio?: string
  referer?: string | null
  title?: string
}

export interface ChatResult {
  text: string
  imageUrl: string | null
}

export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  return isGoogleKey(opts.key) ? callGoogle(opts) : callOpenRouter(opts)
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Gemini API (free tier) path
// ─────────────────────────────────────────────────────────────────────────────

function toGoogleContents(messages: ChatMessage[]): {
  systemText: string
  contents: Array<Record<string, any>>
} {
  let systemText = ''
  const contents: Array<Record<string, any>> = []
  for (const m of messages) {
    const parts: Array<Record<string, any>> = []
    const pushPart = (part: Record<string, any>) => {
      if (part?.type === 'text' && typeof part.text === 'string') {
        parts.push({ text: part.text })
      } else if (part?.type === 'image_url') {
        const url = part.image_url?.url
        const match = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(
          typeof url === 'string' ? url : ''
        )
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
        }
      }
    }
    if (typeof m.content === 'string') {
      if (m.role === 'system') {
        systemText += (systemText ? '\n\n' : '') + m.content
        continue
      }
      parts.push({ text: m.content })
    } else if (Array.isArray(m.content)) {
      if (m.role === 'system') {
        for (const part of m.content) {
          if (typeof part?.text === 'string') {
            systemText += (systemText ? '\n\n' : '') + part.text
          }
        }
        continue
      }
      for (const part of m.content) pushPart(part)
    }
    if (parts.length) {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts })
    }
  }
  return { systemText, contents }
}

async function callGoogle(opts: ChatOptions): Promise<ChatResult> {
  const wantImage = !!opts.wantImage
  let model = googleModelId(opts.model, wantImage)
  let includeImageConfig = wantImage && !!opts.aspectRatio

  const { systemText, contents } = toGoogleContents(opts.messages)

  for (let attempt = 0; ; attempt++) {
    const generationConfig: Record<string, any> = {}
    if (typeof opts.temperature === 'number') generationConfig.temperature = opts.temperature
    if (wantImage) {
      generationConfig.responseModalities = ['TEXT', 'IMAGE']
      // Don't cap output tokens on image calls — a generated image alone
      // costs ~1290 output tokens on gemini-2.5-flash-image.
      if (includeImageConfig) {
        generationConfig.imageConfig = { aspectRatio: opts.aspectRatio }
      }
    } else if (typeof opts.maxTokens === 'number') {
      generationConfig.maxOutputTokens = opts.maxTokens
    }

    const body: Record<string, any> = { contents, generationConfig }
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': opts.key,
        },
        body: JSON.stringify(body),
      }
    )

    if (response.ok) {
      const data = await response.json()
      const parts = data?.candidates?.[0]?.content?.parts
      let text = ''
      let imageUrl: string | null = null
      if (Array.isArray(parts)) {
        for (const p of parts) {
          const inline = p?.inlineData || p?.inline_data
          if (inline?.data && !imageUrl) {
            const mime = inline.mimeType || inline.mime_type || 'image/png'
            imageUrl = `data:${mime};base64,${inline.data}`
          }
          if (typeof p?.text === 'string') text += p.text
        }
      }
      return { text: text.trim(), imageUrl }
    }

    const errBody = await response.text()
    let message = `Google Gemini API error (${response.status})`
    try {
      message = JSON.parse(errBody)?.error?.message || message
    } catch {
      if (errBody) message = errBody.slice(0, 500)
    }

    if (attempt < 2) {
      const fallback = wantImage ? GOOGLE_IMAGE_FALLBACK : GOOGLE_TEXT_FALLBACK
      // Selected model doesn't exist on the Google API (or isn't on the free
      // tier as this id) — retry once on the known-good free model.
      if (response.status === 404 && model !== fallback) {
        model = fallback
        continue
      }
      // Older API surface rejecting imageConfig — retry without it.
      if (
        response.status === 400 &&
        includeImageConfig &&
        /image_?config|aspect_?ratio/i.test(message)
      ) {
        includeImageConfig = false
        continue
      }
    }

    throw new ProviderError(message, response.status)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter path (original behavior)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk an arbitrary OpenAI/OpenRouter response shape and pull out the first
 * image data URL we can find. Different image-output chat models put the
 * payload in different places (top-level `images[]`, `content[].image_url`,
 * inline_data, raw base64 strings, etc.) so we check all of them.
 */
export function extractImageFromAny(node: any): string | null {
  if (!node) return null

  // images: [{ image_url: { url } }] — Gemini and many image-output chat models
  if (Array.isArray(node.images) && node.images.length > 0) {
    for (const img of node.images) {
      if (img?.image_url?.url) return img.image_url.url
      if (img?.url) return img.url
      if (img?.b64_json) return `data:image/png;base64,${img.b64_json}`
    }
  }

  // Some OpenAI-style responses expose raw base64 directly as b64_json
  if (typeof node.b64_json === 'string' && node.b64_json.length > 100) {
    return `data:image/png;base64,${node.b64_json}`
  }

  const content = node.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'image_url' && part?.image_url?.url) return part.image_url.url
      if (part?.type === 'image' && part?.url) return part.url
      if (part?.image_url?.data) return `data:image/png;base64,${part.image_url.data}`
      if (part?.b64_json) return `data:image/png;base64,${part.b64_json}`
      if (part?.data && typeof part.data === 'string' && part.data.length > 100) {
        return `data:image/png;base64,${part.data}`
      }
      if (part?.inline_data?.data) {
        const mime = part.inline_data.mime_type || 'image/png'
        return `data:${mime};base64,${part.inline_data.data}`
      }
    }
  } else if (typeof content === 'string') {
    if (content.startsWith('data:image') || content.startsWith('http')) return content
    if (content.length > 100 && /^[A-Za-z0-9+/=]+$/.test(content.substring(0, 100))) {
      return `data:image/png;base64,${content}`
    }
    const urlMatch = content.match(/!\[.*?\]\((.*?)\)/)
    if (urlMatch && urlMatch[1]) return urlMatch[1]
  } else if (content && typeof content === 'object') {
    if ((content as any).data) return `data:image/png;base64,${(content as any).data}`
    if ((content as any).inline_data?.data) {
      const mime = (content as any).inline_data.mime_type || 'image/png'
      return `data:${mime};base64,${(content as any).inline_data.data}`
    }
  }

  return null
}

function extractTextFromMessage(message: any): string {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((p: any) =>
        typeof p === 'string' ? p : p?.type === 'text' && typeof p.text === 'string' ? p.text : ''
      )
      .join(' ')
      .trim()
  }
  return ''
}

async function callOpenRouter(opts: ChatOptions): Promise<ChatResult> {
  const body: Record<string, any> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 2000,
  }
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature
  if (opts.wantImage) {
    body.modalities = ['image', 'text']
    if (opts.aspectRatio) {
      body.image_config = { aspect_ratio: opts.aspectRatio }
    }
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': opts.referer || 'http://localhost:3000',
      'X-Title': opts.title || 'AI Image Extender',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    let message = 'AI provider request failed'
    try {
      message = JSON.parse(errBody)?.error?.message || message
    } catch {
      if (errBody) message = errBody.slice(0, 500)
    }
    throw new ProviderError(message, response.status)
  }

  const data = await response.json()
  const message = data.choices?.[0]?.message
  if (!message) throw new ProviderError('No message in response', 500)

  return {
    text: extractTextFromMessage(message),
    imageUrl: extractImageFromAny(message),
  }
}
