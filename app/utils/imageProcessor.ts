export async function expandCanvas(
  originalImageDataUrl: string,
  direction: 'up' | 'down' | 'left' | 'right',
  extensionPercent: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const originalWidth = img.width
      const originalHeight = img.height
      
      // Calculate new dimensions
      let newWidth = originalWidth
      let newHeight = originalHeight
      let offsetX = 0
      let offsetY = 0
      
      const extensionAmount = extensionPercent / 100
      
      switch (direction) {
        case 'right':
          newWidth = Math.round(originalWidth * (1 + extensionAmount))
          offsetX = 0
          offsetY = 0
          break
        case 'left':
          newWidth = Math.round(originalWidth * (1 + extensionAmount))
          offsetX = newWidth - originalWidth
          offsetY = 0
          break
        case 'down':
          newHeight = Math.round(originalHeight * (1 + extensionAmount))
          offsetX = 0
          offsetY = 0
          break
        case 'up':
          newHeight = Math.round(originalHeight * (1 + extensionAmount))
          offsetX = 0
          offsetY = newHeight - originalHeight
          break
      }
      
      // Create canvas
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      
      // Fill with white background (AI will fill this)
      ctx.fillStyle = EXTENSION_BLANK_COLOR
      ctx.fillRect(0, 0, newWidth, newHeight)
      
      // Draw original image at offset position
      ctx.drawImage(img, offsetX, offsetY, originalWidth, originalHeight)
      
      // Convert to data URL
      resolve(canvas.toDataURL('image/png'))
    }
    
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    
    img.src = originalImageDataUrl
  })
}

// New approach - send full image for context, but mark the area to extend
export async function createFullContextExtension(
  originalImageDataUrl: string,
  direction: 'up' | 'down' | 'left' | 'right',
  extensionPercent: number,
  referenceOriginalDimensions?: { width: number; height: number },
  maxDimension: number = 1536
): Promise<{ fullImageWithBlankArea: string; extensionInfo: ExtensionInfo }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const currentWidth = img.width
      const currentHeight = img.height
      
      const refWidth = referenceOriginalDimensions?.width || currentWidth
      const refHeight = referenceOriginalDimensions?.height || currentHeight
      
      const extensionAmount = extensionPercent / 100
      const extensionHeight = Math.round(refHeight * extensionAmount)
      const extensionWidth = Math.round(refWidth * extensionAmount)
      
      let newWidth = currentWidth
      let newHeight = currentHeight
      let originalOffsetX = 0
      let originalOffsetY = 0
      let extensionRegion: { x: number; y: number; width: number; height: number }
      
      switch (direction) {
        case 'up':
          newHeight = currentHeight + extensionHeight
          originalOffsetY = extensionHeight
          extensionRegion = { x: 0, y: 0, width: currentWidth, height: extensionHeight }
          break
        case 'down':
          newHeight = currentHeight + extensionHeight
          originalOffsetY = 0
          extensionRegion = { x: 0, y: currentHeight, width: currentWidth, height: extensionHeight }
          break
        case 'left':
          newWidth = currentWidth + extensionWidth
          originalOffsetX = extensionWidth
          extensionRegion = { x: 0, y: 0, width: extensionWidth, height: currentHeight }
          break
        case 'right':
          newWidth = currentWidth + extensionWidth
          originalOffsetX = 0
          extensionRegion = { x: currentWidth, y: 0, width: extensionWidth, height: currentHeight }
          break
      }
      
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      
      ctx.fillStyle = EXTENSION_BLANK_COLOR
      ctx.fillRect(0, 0, newWidth, newHeight)
      ctx.drawImage(img, originalOffsetX, originalOffsetY, currentWidth, currentHeight)
      
      const extensionInfo: ExtensionInfo = {
        direction,
        originalWidth: currentWidth,
        originalHeight: currentHeight,
        newWidth,
        newHeight,
        extensionRegion,
        originalPosition: { x: originalOffsetX, y: originalOffsetY }
      }
      
      const fullImageDataUrl = canvas.toDataURL('image/png')
      smartDownscale(fullImageDataUrl, direction, maxDimension).then(({ dataUrl, scale }) => {
        resolve({
          fullImageWithBlankArea: dataUrl,
          extensionInfo: { ...extensionInfo, scale }
        })
      }).catch(() => {
        resolve({
          fullImageWithBlankArea: fullImageDataUrl,
          extensionInfo: { ...extensionInfo, scale: 1 }
        })
      })
    }
    
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    
    img.src = originalImageDataUrl
  })
}

const EXTENSION_BLANK_COLOR = '#B0B0B0' // Gray blank area — distinguishable from white snow/sky in photos

export type ImageAlign = {
  x?: 'left' | 'center' | 'right'
  y?: 'top' | 'center' | 'bottom'
}

function getAlignOffset(target: number, scaled: number, align: 'left' | 'center' | 'right' | 'top' | 'bottom'): number {
  if (align === 'left' || align === 'top') return 0
  if (align === 'right' || align === 'bottom') return target - scaled
  return (target - scaled) / 2
}

/** Chunk alignment: anchor the edge that connects to the original image. */
export function getChunkAlign(direction: 'up' | 'down' | 'left' | 'right'): ImageAlign {
  switch (direction) {
    case 'right': return { x: 'left', y: 'center' }   // context on left of chunk
    case 'left': return { x: 'right', y: 'center' }   // context on right of chunk
    case 'down': return { x: 'center', y: 'top' }
    case 'up': return { x: 'center', y: 'bottom' }
  }
}

/** Full-canvas alignment: anchor the side where the original image sits. */
export function getCanvasAlign(direction: 'up' | 'down' | 'left' | 'right'): ImageAlign {
  switch (direction) {
    case 'right': return { x: 'left', y: 'center' }
    case 'left': return { x: 'right', y: 'center' }
    case 'down': return { x: 'center', y: 'top' }
    case 'up': return { x: 'center', y: 'bottom' }
  }
}

/** Resize image to exact dimensions with explicit alignment (cover + crop). */
export function normalizeImageToSize(
  imageDataUrl: string,
  targetWidth: number,
  targetHeight: number,
  align: ImageAlign = { x: 'center', y: 'center' }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      if (img.width === targetWidth && img.height === targetHeight) {
        resolve(imageDataUrl)
        return
      }

      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        resolve(imageDataUrl)
        return
      }

      const scale = Math.max(targetWidth / img.width, targetHeight / img.height)
      const scaledWidth = img.width * scale
      const scaledHeight = img.height * scale

      const offsetX = getAlignOffset(targetWidth, scaledWidth, align.x ?? 'center')
      const offsetY = getAlignOffset(targetHeight, scaledHeight, align.y ?? 'center')

      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight)
      resolve(canvas.toDataURL('image/png'))
    }

    img.onerror = () => reject(new Error('Failed to load image for normalization'))
    img.src = imageDataUrl
  })
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/** Check if the horizontal extension strip is still unfilled after stitching. */
export async function isChunkExtensionUnfilled(
  imageDataUrl: string,
  chunkInfo: ChunkInfo
): Promise<boolean> {
  const img = await loadImageElement(imageDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.drawImage(img, 0, 0)
  const { direction, extensionSize, originalWidth } = chunkInfo

  let x = 0
  if (direction === 'right') x = originalWidth
  else if (direction === 'left') x = 0
  else return false

  const data = ctx.getImageData(x, 0, extensionSize, img.height).data
  let blankPixels = 0
  const totalPixels = extensionSize * img.height
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (r > 200 && g > 200 && b > 200) blankPixels++
    else if (Math.abs(r - 176) < 30 && Math.abs(g - 176) < 30 && Math.abs(b - 176) < 30) blankPixels++
  }
  return blankPixels / totalPixels > 0.5
}

/** Check if the extension region is still mostly unfilled (gray/white). */
export async function isExtensionRegionUnfilled(
  imageDataUrl: string,
  extensionInfo: ExtensionInfo
): Promise<boolean> {
  const img = await loadImageElement(imageDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = extensionInfo.newWidth
  canvas.height = extensionInfo.newHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.drawImage(img, 0, 0, extensionInfo.newWidth, extensionInfo.newHeight)
  const { x, y, width, height } = extensionInfo.extensionRegion
  const data = ctx.getImageData(x, y, width, height).data

  let blankPixels = 0
  const totalPixels = width * height
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (r > 200 && g > 200 && b > 200) blankPixels++
    else if (Math.abs(r - 176) < 30 && Math.abs(g - 176) < 30 && Math.abs(b - 176) < 30) blankPixels++
  }
  return blankPixels / totalPixels > 0.5
}

/**
 * Pre-correction: shift AI's bulk color in the extension area to match the
 * original's color at the seam. This handles the low-frequency color component
 * directly (the slowest-converging part of Gauss-Seidel) so Poisson only has
 * to clean up the high-frequency residual (gradients, fine detail), where it's
 * efficient. Massively reduces visible color seams across uniform regions
 * like sky, water, snow.
 *
 * Uniform shift preserves the AI's gradients (Laplacian of (S+c) = Laplacian
 * of S) so Poisson's gradient field is unchanged — only the starting color is
 * shifted to be near the right answer.
 */
function preCorrectAiColor(
  dstU8: Uint8ClampedArray,
  srcU8: Uint8ClampedArray,
  extensionInfo: ExtensionInfo,
  w: number,
  h: number
): { dR: number; dG: number; dB: number } {
  const { direction, originalWidth, originalHeight, originalPosition, extensionRegion } = extensionInfo
  const SAMPLE_DEPTH = 30
  const isHorizontal = direction === 'left' || direction === 'right'
  const isRight = direction === 'right'
  const isDown = direction === 'down'

  let oR = 0, oG = 0, oB = 0, oN = 0
  let aR = 0, aG = 0, aB = 0, aN = 0

  if (isHorizontal) {
    const seamX = isRight ? originalWidth + originalPosition.x : originalPosition.x
    for (let y = 0; y < h; y++) {
      for (let d = 1; d <= SAMPLE_DEPTH; d++) {
        const origX = isRight ? seamX - d : seamX + d - 1
        const aiX = isRight ? seamX + d - 1 : seamX - d
        if (origX >= 0 && origX < w) {
          const idx = (y * w + origX) * 4
          oR += dstU8[idx]; oG += dstU8[idx + 1]; oB += dstU8[idx + 2]; oN++
        }
        if (aiX >= 0 && aiX < w) {
          const idx = (y * w + aiX) * 4
          aR += srcU8[idx]; aG += srcU8[idx + 1]; aB += srcU8[idx + 2]; aN++
        }
      }
    }
  } else {
    const seamY = isDown ? originalHeight + originalPosition.y : originalPosition.y
    for (let x = 0; x < w; x++) {
      for (let d = 1; d <= SAMPLE_DEPTH; d++) {
        const origY = isDown ? seamY - d : seamY + d - 1
        const aiY = isDown ? seamY + d - 1 : seamY - d
        if (origY >= 0 && origY < h) {
          const idx = (origY * w + x) * 4
          oR += dstU8[idx]; oG += dstU8[idx + 1]; oB += dstU8[idx + 2]; oN++
        }
        if (aiY >= 0 && aiY < h) {
          const idx = (aiY * w + x) * 4
          aR += srcU8[idx]; aG += srcU8[idx + 1]; aB += srcU8[idx + 2]; aN++
        }
      }
    }
  }

  if (oN === 0 || aN === 0) return { dR: 0, dG: 0, dB: 0 }

  const dR = oR / oN - aR / aN
  const dG = oG / oN - aG / aN
  const dB = oB / oN - aB / aN

  // Apply uniform delta to AI pixels in the extension area in dstU8 (which
  // becomes Poisson's initial guess). srcU8 is left unchanged because uniform
  // shift doesn't affect the Laplacian.
  const { x: rx, y: ry, width: rw, height: rh } = extensionRegion
  for (let y = ry; y < ry + rh; y++) {
    const row = y * w
    for (let x = rx; x < rx + rw; x++) {
      const idx = (row + x) * 4
      const r = dstU8[idx] + dR
      const g = dstU8[idx + 1] + dG
      const b = dstU8[idx + 2] + dB
      dstU8[idx]     = r < 0 ? 0 : r > 255 ? 255 : r
      dstU8[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      dstU8[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }

  return { dR, dG, dB }
}

/**
 * Measure the residual seam quality after blending. Samples pixels just inside
 * vs just outside the seam and returns the mean absolute color difference per
 * channel. Lower = less visible seam (under ~6 is typically invisible at normal
 * viewing distance; over ~15 is clearly visible).
 *
 * Used by `applyFullContextResult` for the multi-attempt "best of N" selection
 * so we automatically pick the AI generation that blended best — addressing the
 * common pattern of needing to manually regenerate to get an acceptable result.
 */
export async function measureSeamResidual(
  blendedImageDataUrl: string,
  extensionInfo: ExtensionInfo,
  originalImageDataUrl: string
): Promise<number> {
  const [blendedImg, originalImg] = await Promise.all([
    loadImageElement(blendedImageDataUrl),
    loadImageElement(originalImageDataUrl),
  ])
  const { direction, originalWidth, originalHeight, newWidth, newHeight, originalPosition } = extensionInfo

  // Render original-at-correct-position reference and blended into the same canvas size.
  const refCanvas = document.createElement('canvas')
  refCanvas.width = newWidth
  refCanvas.height = newHeight
  const refCtx = refCanvas.getContext('2d')!
  refCtx.drawImage(
    originalImg,
    0, 0, originalWidth, originalHeight,
    originalPosition.x, originalPosition.y, originalWidth, originalHeight
  )
  const refData = refCtx.getImageData(0, 0, newWidth, newHeight).data

  const blendedCanvas = document.createElement('canvas')
  blendedCanvas.width = newWidth
  blendedCanvas.height = newHeight
  const blendedCtx = blendedCanvas.getContext('2d')!
  blendedCtx.drawImage(blendedImg, 0, 0, newWidth, newHeight)
  const blendedData = blendedCtx.getImageData(0, 0, newWidth, newHeight).data

  // Sample 4 pixels just inside the original side, 4 pixels just inside the
  // blended side of the seam. Measure mean abs delta between them.
  const SAMPLE_OFFSET = 4
  const isHorizontal = direction === 'left' || direction === 'right'
  const isRight = direction === 'right'
  const isDown = direction === 'down'

  let total = 0
  let count = 0

  if (isHorizontal) {
    const seamX = isRight ? originalWidth + originalPosition.x : originalPosition.x
    const origX = isRight ? seamX - SAMPLE_OFFSET : seamX + SAMPLE_OFFSET - 1
    const aiX = isRight ? seamX + SAMPLE_OFFSET - 1 : seamX - SAMPLE_OFFSET
    if (origX < 0 || origX >= newWidth || aiX < 0 || aiX >= newWidth) return 0
    for (let y = 0; y < newHeight; y++) {
      const origIdx = (y * newWidth + origX) * 4
      const aiIdx = (y * newWidth + aiX) * 4
      total += Math.abs(refData[origIdx] - blendedData[aiIdx])
      total += Math.abs(refData[origIdx + 1] - blendedData[aiIdx + 1])
      total += Math.abs(refData[origIdx + 2] - blendedData[aiIdx + 2])
      count += 3
    }
  } else {
    const seamY = isDown ? originalHeight + originalPosition.y : originalPosition.y
    const origY = isDown ? seamY - SAMPLE_OFFSET : seamY + SAMPLE_OFFSET - 1
    const aiY = isDown ? seamY + SAMPLE_OFFSET - 1 : seamY - SAMPLE_OFFSET
    if (origY < 0 || origY >= newHeight || aiY < 0 || aiY >= newHeight) return 0
    for (let x = 0; x < newWidth; x++) {
      const origIdx = (origY * newWidth + x) * 4
      const aiIdx = (aiY * newWidth + x) * 4
      total += Math.abs(refData[origIdx] - blendedData[aiIdx])
      total += Math.abs(refData[origIdx + 1] - blendedData[aiIdx + 1])
      total += Math.abs(refData[origIdx + 2] - blendedData[aiIdx + 2])
      count += 3
    }
  }

  return count > 0 ? total / count : 0
}

/**
 * Poisson image editing (Pérez et al. 2003) via Gauss-Seidel iterations.
 *
 * Solves ΔV = ΔS inside Ω with V = D on ∂Ω, which preserves the AI's
 * gradients (texture/detail) while forcing the seam pixels to match the
 * original's colors. Used in tandem with `preCorrectAiColor` which handles the
 * bulk color shift separately.
 *
 * Implementation notes:
 *   • Gauss-Seidel (red-black ordering) converges ~2× faster than plain Jacobi.
 *   • Mask is grown into the original by GROW_PX along the seam direction so
 *     the Dirichlet boundary sits inside the original, absorbing sub-pixel
 *     mismatches at the AI-original interface (the "grow then blur" trick
 *     from AUTOMATIC1111's outpainting_mk_2.py and ComfyUI's MaskGrow node).
 *   • Iterates the FULL mask including canvas-edge rows/cols (with replicate
 *     padding for out-of-bounds neighbors → Neumann boundary at canvas edges).
 *     Skipping these was making Poisson's boundary effectively "AI color" on
 *     3 of 4 sides for full-height/width extensions, causing color seams to
 *     persist deep into the strip.
 *   • All work is in Float32 typed arrays over the mask's bounding box.
 */
function poissonBlendOutpaint(
  originalImg: HTMLImageElement,
  aiImg: HTMLImageElement,
  extensionInfo: ExtensionInfo,
  iterations: number = 250
): HTMLCanvasElement {
  const { direction, newWidth, newHeight, originalWidth, originalHeight, originalPosition, extensionRegion } = extensionInfo

  // Build destination D = canvas with the original at its position, AI everywhere else.
  // (Outside the mask Ω, V stays = D, so the original is preserved exactly.)
  const dstCanvas = document.createElement('canvas')
  dstCanvas.width = newWidth
  dstCanvas.height = newHeight
  const dstCtx = dstCanvas.getContext('2d')!
  dstCtx.drawImage(aiImg, 0, 0, newWidth, newHeight)
  dstCtx.drawImage(
    originalImg,
    0, 0, originalWidth, originalHeight,
    originalPosition.x, originalPosition.y, originalWidth, originalHeight
  )
  const dstU8 = dstCtx.getImageData(0, 0, newWidth, newHeight).data

  // Source S = pure AI output (provides gradients inside Ω).
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = newWidth
  srcCanvas.height = newHeight
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(aiImg, 0, 0, newWidth, newHeight)
  const srcU8 = srcCtx.getImageData(0, 0, newWidth, newHeight).data

  // Stage 1: pre-correct the bulk color shift so Poisson only has to fix the
  // high-frequency residual (which it converges to quickly).
  preCorrectAiColor(dstU8, srcU8, extensionInfo, newWidth, newHeight)

  const N = newWidth * newHeight
  const dstR = new Float32Array(N)
  const dstG = new Float32Array(N)
  const dstB = new Float32Array(N)
  const srcR = new Float32Array(N)
  const srcG = new Float32Array(N)
  const srcB = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const j = i * 4
    dstR[i] = dstU8[j];     dstG[i] = dstU8[j + 1];     dstB[i] = dstU8[j + 2]
    srcR[i] = srcU8[j];     srcG[i] = srcU8[j + 1];     srcB[i] = srcU8[j + 2]
  }

  // Grow the mask into the original by GROW_PX, but only in the seam direction.
  // This is the "grow then blur" trick: by moving Poisson's Dirichlet boundary
  // a few pixels INSIDE the original, any sub-pixel mismatch right at the
  // original-AI interface gets absorbed by the solver instead of showing as a seam.
  // The original detail in this ring is preserved because the AI faithfully
  // reproduced the original there (its gradients are nearly identical).
  const GROW_PX = Math.max(6, Math.min(14, Math.floor(Math.min(originalWidth, originalHeight) * 0.012)))
  let mx = extensionRegion.x
  let my = extensionRegion.y
  let mw = extensionRegion.width
  let mh = extensionRegion.height
  if (direction === 'right')      { mx -= GROW_PX; mw += GROW_PX }
  else if (direction === 'left')  { mw += GROW_PX }
  else if (direction === 'down')  { my -= GROW_PX; mh += GROW_PX }
  else if (direction === 'up')    { mh += GROW_PX }
  mx = Math.max(0, mx); my = Math.max(0, my)
  mw = Math.min(newWidth - mx, mw); mh = Math.min(newHeight - my, mh)

  const mask = new Uint8Array(N)
  for (let y = my; y < my + mh; y++) {
    const row = y * newWidth
    for (let x = mx; x < mx + mw; x++) mask[row + x] = 1
  }

  // Iterate over the FULL mask bounding box, including canvas-edge rows/cols.
  // Out-of-bounds neighbors are replicate-padded (clamped to image bounds),
  // giving canvas edges a Neumann (zero-gradient) boundary condition. This is
  // critical for full-height/width extensions where the mask touches the
  // canvas edge: skipping those rows leaves them frozen at the AI's initial
  // color, which then acts as a Dirichlet boundary pulling the interior toward
  // AI's color and defeating the seam at the original boundary.
  const x0 = mx
  const x1 = mx + mw
  const y0 = my
  const y1 = my + mh

  // Precompute Laplacian of S with replicate padding.
  const lapR = new Float32Array(N)
  const lapG = new Float32Array(N)
  const lapB = new Float32Array(N)
  for (let y = y0; y < y1; y++) {
    const row = y * newWidth
    const rowUp = (y > 0 ? y - 1 : 0) * newWidth
    const rowDn = (y < newHeight - 1 ? y + 1 : newHeight - 1) * newWidth
    for (let x = x0; x < x1; x++) {
      const i = row + x
      const xL = x > 0 ? x - 1 : 0
      const xR = x < newWidth - 1 ? x + 1 : newWidth - 1
      lapR[i] = 4 * srcR[i] - srcR[rowUp + x] - srcR[rowDn + x] - srcR[row + xL] - srcR[row + xR]
      lapG[i] = 4 * srcG[i] - srcG[rowUp + x] - srcG[rowDn + x] - srcG[row + xL] - srcG[row + xR]
      lapB[i] = 4 * srcB[i] - srcB[rowUp + x] - srcB[rowDn + x] - srcB[row + xL] - srcB[row + xR]
    }
  }

  // Initial guess V = D. Inside the extension proper, D = AI (color-corrected
  // by preCorrectAiColor above); inside the grown ring, D = original.
  const vR = new Float32Array(N)
  const vG = new Float32Array(N)
  const vB = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    vR[i] = dstR[i]; vG[i] = dstG[i]; vB[i] = dstB[i]
  }

  // Gauss-Seidel red-black ordering. On "red" pass we visit pixels where
  // (x + y) is even; on "black" pass, where it's odd. Each pass reads updated
  // values from the previous pass, doubling effective convergence speed vs Jacobi.
  for (let iter = 0; iter < iterations; iter++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let y = y0; y < y1; y++) {
        const row = y * newWidth
        const rowUp = (y > 0 ? y - 1 : 0) * newWidth
        const rowDn = (y < newHeight - 1 ? y + 1 : newHeight - 1) * newWidth
        const startX = x0 + ((x0 + y + parity) & 1)
        for (let x = startX; x < x1; x += 2) {
          const i = row + x
          if (!mask[i]) continue
          const xL = x > 0 ? x - 1 : 0
          const xR = x < newWidth - 1 ? x + 1 : newWidth - 1
          const iU = rowUp + x, iD = rowDn + x, iL = row + xL, iR = row + xR
          const upR = mask[iU] ? vR[iU] : dstR[iU]
          const dnR = mask[iD] ? vR[iD] : dstR[iD]
          const lfR = mask[iL] ? vR[iL] : dstR[iL]
          const rtR = mask[iR] ? vR[iR] : dstR[iR]
          const upG = mask[iU] ? vG[iU] : dstG[iU]
          const dnG = mask[iD] ? vG[iD] : dstG[iD]
          const lfG = mask[iL] ? vG[iL] : dstG[iL]
          const rtG = mask[iR] ? vG[iR] : dstG[iR]
          const upB = mask[iU] ? vB[iU] : dstB[iU]
          const dnB = mask[iD] ? vB[iD] : dstB[iD]
          const lfB = mask[iL] ? vB[iL] : dstB[iL]
          const rtB = mask[iR] ? vB[iR] : dstB[iR]
          vR[i] = (upR + dnR + lfR + rtR + lapR[i]) * 0.25
          vG[i] = (upG + dnG + lfG + rtG + lapG[i]) * 0.25
          vB[i] = (upB + dnB + lfB + rtB + lapB[i]) * 0.25
        }
      }
    }
  }

  const out = new ImageData(newWidth, newHeight)
  const od = out.data
  for (let i = 0; i < N; i++) {
    const j = i * 4
    if (mask[i]) {
      od[j]     = vR[i] < 0 ? 0 : vR[i] > 255 ? 255 : vR[i]
      od[j + 1] = vG[i] < 0 ? 0 : vG[i] > 255 ? 255 : vG[i]
      od[j + 2] = vB[i] < 0 ? 0 : vB[i] > 255 ? 255 : vB[i]
    } else {
      od[j]     = dstR[i]
      od[j + 1] = dstG[i]
      od[j + 2] = dstB[i]
    }
    od[j + 3] = 255
  }

  const result = document.createElement('canvas')
  result.width = newWidth
  result.height = newHeight
  result.getContext('2d')!.putImageData(out, 0, 0)
  return result
}

/**
 * Apply full-context AI result with Poisson blending.
 * Gradient-domain blending preserves AI textures while mathematically forcing
 * the seam to match the original — the same technique professional outpainting
 * tools (Adobe, ComfyUI, the Nano Banana ComfyUI node) use.
 */
export async function applyFullContextResult(
  aiImageDataUrl: string,
  extensionInfo: ExtensionInfo,
  originalImageDataUrl: string
): Promise<string> {
  const normalizedAi = await normalizeImageToSize(
    aiImageDataUrl,
    extensionInfo.newWidth,
    extensionInfo.newHeight,
    getCanvasAlign(extensionInfo.direction)
  )

  const [aiImg, originalImg] = await Promise.all([
    loadImageElement(normalizedAi),
    loadImageElement(originalImageDataUrl),
  ])

  // Poisson blending: source = AI, destination = canvas with original placed,
  // mask = extension region. Inside the mask, V is solved so its Laplacian
  // matches the AI's gradients while V at the seam = original's pixels exactly.
  // This eliminates color seams and brightness mismatches without smearing detail.
  const blended = poissonBlendOutpaint(originalImg, aiImg, extensionInfo)
  return blended.toDataURL('image/png')
}

/** Validate AI output before compositing — checks the raw AI image extension region. */
export async function isAiExtensionUnfilled(
  aiImageDataUrl: string,
  extensionInfo: ExtensionInfo
): Promise<boolean> {
  const normalized = await normalizeImageToSize(
    aiImageDataUrl,
    extensionInfo.newWidth,
    extensionInfo.newHeight,
    getCanvasAlign(extensionInfo.direction)
  )
  return isExtensionRegionUnfilled(normalized, extensionInfo)
}

// Interface for full context extension info
export interface ExtensionInfo {
  direction: 'up' | 'down' | 'left' | 'right'
  originalWidth: number
  originalHeight: number
  newWidth: number
  newHeight: number
  extensionRegion: { x: number; y: number; width: number; height: number }
  originalPosition: { x: number; y: number }
  scale?: number
}

// Helper function to downscale image while preserving aspect ratio
async function smartDownscale(
  imageDataUrl: string, 
  direction: 'up' | 'down' | 'left' | 'right',
  maxDimension: number = 2048
): Promise<{ dataUrl: string; scale: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const width = img.width
      const height = img.height
      
      // Find the larger dimension
      const maxSize = Math.max(width, height)
      
      // If within limits, return as-is
      if (maxSize <= maxDimension) {
        resolve({ dataUrl: imageDataUrl, scale: 1 })
        return
      }
      
      // Scale PROPORTIONALLY to maintain aspect ratio
      // This is critical so AI sees the correct shape of what it needs to generate
      const scale = maxDimension / maxSize
      const newWidth = Math.round(width * scale)
      const newHeight = Math.round(height * scale)
      
      console.log(`📏 Proportional downscaling for ${direction.toUpperCase()}: ${width}x${height} → ${newWidth}x${newHeight} (scale: ${scale.toFixed(2)})`)
      
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (ctx) {
        // Use JPEG with good quality to reduce payload size while maintaining quality
        ctx.drawImage(img, 0, 0, newWidth, newHeight)
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.95), scale })
      } else {
        resolve({ dataUrl: imageDataUrl, scale: 1 })
      }
    }
    
    img.src = imageDataUrl
  })
}

// Old chunked extension approach - only takes a portion of the image to extend
export async function createChunkedExtension(
  originalImageDataUrl: string,
  direction: 'up' | 'down' | 'left' | 'right',
  extensionPercent: number,
  overlapPercent: number = 40, // Context area: how much existing image to send to AI (lower = less regeneration of good parts)
  referenceOriginalDimensions?: { width: number; height: number }, // Reference dimensions for consistent percentage calculations
  maxDimension: number = 1536 // Maximum dimension to send to AI (balanced for quality and API limits)
): Promise<{ chunkToExtend: string; chunkInfo: ChunkInfo }> {
  return new Promise(async (resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = async () => {
      const currentWidth = img.width
      const currentHeight = img.height
      
      // Use reference dimensions if provided, otherwise use current image dimensions
      const refWidth = referenceOriginalDimensions?.width || currentWidth
      const refHeight = referenceOriginalDimensions?.height || currentHeight
      
      // Calculate chunk dimensions based on direction
      let chunkInfo: ChunkInfo
      let sourceX = 0, sourceY = 0, sourceWidth = 0, sourceHeight = 0
      let newWidth = 0, newHeight = 0
      let offsetX = 0, offsetY = 0
      
      const extensionAmount = extensionPercent / 100
      const overlapAmount = overlapPercent / 100
      
      switch (direction) {
        case 'up':
          // Take top portion of CURRENT image (context area)
          sourceWidth = currentWidth
          sourceHeight = Math.round(currentHeight * overlapAmount)
          sourceX = 0
          sourceY = 0
          
          // Calculate extension based on REFERENCE (original) image dimensions for consistency
          const extensionHeight = Math.round(refHeight * extensionAmount)
          
          // Add white space above the context area
          newWidth = sourceWidth
          newHeight = sourceHeight + extensionHeight
          offsetX = 0
          offsetY = extensionHeight
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionHeight,
            sourceX,
            sourceY
          }
          break
          
        case 'down':
          // Take bottom portion of CURRENT image (context area)
          sourceWidth = currentWidth
          sourceHeight = Math.round(currentHeight * overlapAmount)
          sourceX = 0
          sourceY = currentHeight - sourceHeight
          
          // Calculate extension based on REFERENCE (original) image dimensions
          const extensionHeightDown = Math.round(refHeight * extensionAmount)
          
          // Add white space below the context area
          newWidth = sourceWidth
          newHeight = sourceHeight + extensionHeightDown
          offsetX = 0
          offsetY = 0
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionHeightDown,
            sourceX,
            sourceY
          }
          break
          
        case 'left':
          // Take left portion of CURRENT image (context area)
          sourceWidth = Math.round(currentWidth * overlapAmount)
          sourceHeight = currentHeight
          sourceX = 0
          sourceY = 0
          
          // Calculate extension based on REFERENCE (original) image dimensions
          const extensionWidthLeft = Math.round(refWidth * extensionAmount)
          
          // Add white space to left of context area
          newWidth = sourceWidth + extensionWidthLeft
          newHeight = sourceHeight
          offsetX = extensionWidthLeft
          offsetY = 0
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionWidthLeft,
            sourceX,
            sourceY
          }
          break
          
        case 'right':
          // Take right portion of CURRENT image (context area)
          sourceWidth = Math.round(currentWidth * overlapAmount)
          sourceHeight = currentHeight
          sourceX = currentWidth - sourceWidth
          sourceY = 0
          
          // Calculate extension based on REFERENCE (original) image dimensions
          const extensionWidthRight = Math.round(refWidth * extensionAmount)
          
          // Add white space to right of context area
          newWidth = sourceWidth + extensionWidthRight
          newHeight = sourceHeight
          offsetX = 0
          offsetY = 0
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionWidthRight,
            sourceX,
            sourceY
          }
          break
      }
      
      // Create canvas for the chunk with extension
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      
      // Fill with white background
      ctx.fillStyle = EXTENSION_BLANK_COLOR
      ctx.fillRect(0, 0, newWidth, newHeight)
      
      // Draw the chunk from original image
      ctx.drawImage(
        img,
        sourceX, sourceY, sourceWidth, sourceHeight, // Source
        offsetX, offsetY, sourceWidth, sourceHeight  // Destination
      )
      
      // Smart downscale before sending to AI to prevent aggressive compression
      // Only scale the dimension being extended (keep width constant for up/down)
      const chunkDataUrl = canvas.toDataURL('image/png')
      smartDownscale(chunkDataUrl, direction, maxDimension).then(({ dataUrl, scale }) => {
        resolve({
          chunkToExtend: dataUrl,
          chunkInfo: { ...chunkInfo, scale }
        })
      }).catch(() => {
        // Fallback to original if downscale fails
        resolve({
          chunkToExtend: chunkDataUrl,
          chunkInfo: { ...chunkInfo, scale: 1 }
        })
      })
    }
    
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    
    img.src = originalImageDataUrl
  })
}

// Stitch the extended chunk back to the original image
export async function stitchExtendedChunk(
  originalImageDataUrl: string,
  extendedChunkDataUrl: string,
  chunkInfo: ChunkInfo,
  debugMode: boolean = false // Add debug overlay to visualize seam
): Promise<string> {
  return new Promise((resolve, reject) => {
    const originalImg = new Image()
    const extendedImg = new Image()
    
    let originalLoaded = false
    let extendedLoaded = false
    
    const checkBothLoaded = () => {
      if (!originalLoaded || !extendedLoaded) return
      
      const { direction, originalWidth, originalHeight, chunkWidth, chunkHeight, extensionSize, scale = 1 } = chunkInfo
      
      // DEBUG: Log all dimensions
      console.log('=== STITCHING DEBUG INFO ===')
      console.log('Direction:', direction)
      console.log('Original Image:', originalImg.width, 'x', originalImg.height)
      console.log('Extended Chunk (AI result):', extendedImg.width, 'x', extendedImg.height)
      console.log('ChunkInfo - originalWidth:', originalWidth, 'originalHeight:', originalHeight)
      console.log('ChunkInfo - chunkWidth:', chunkWidth, 'chunkHeight:', chunkHeight)
      console.log('ChunkInfo - extensionSize:', extensionSize)
      
      // Check for dimension mismatches
      if (originalImg.width !== originalWidth || originalImg.height !== originalHeight) {
        console.warn('⚠️ DIMENSION MISMATCH DETECTED!')
        console.warn('Expected original:', originalWidth, 'x', originalHeight)
        console.warn('Actual original:', originalImg.width, 'x', originalImg.height)
      }
      
      // Calculate expected extended chunk dimensions (full resolution)
      const expectedChunkWidth = direction === 'left' || direction === 'right' 
        ? chunkWidth + extensionSize 
        : originalWidth
      const expectedChunkHeight = direction === 'up' || direction === 'down'
        ? chunkHeight + extensionSize
        : originalHeight

      // Dimensions at the scale sent to the AI (before upscaling back)
      const sentChunkWidth = Math.round(expectedChunkWidth * scale)
      const sentChunkHeight = Math.round(expectedChunkHeight * scale)
      
      console.log('Expected extended chunk:', expectedChunkWidth, 'x', expectedChunkHeight)
      console.log('Sent to AI (scaled):', sentChunkWidth, 'x', sentChunkHeight, `(scale: ${scale})`)
      
      // Handle AI dimension changes by resizing to expected dimensions
      let processedExtendedImg = extendedImg
      
      const resizeImage = (img: HTMLImageElement, width: number, height: number, onDone: (resized: HTMLImageElement) => void) => {
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = img.width
        tempCanvas.height = img.height
        tempCanvas.getContext('2d')?.drawImage(img, 0, 0)

        normalizeImageToSize(tempCanvas.toDataURL('image/png'), width, height, getChunkAlign(direction))
          .then((dataUrl) => {
            const resizedImg = new Image()
            resizedImg.onload = () => onDone(resizedImg)
            resizedImg.onerror = () => onDone(img)
            resizedImg.src = dataUrl
          })
          .catch(() => onDone(img))
      }
      
      if (extendedImg.width !== sentChunkWidth || extendedImg.height !== sentChunkHeight) {
        console.warn('⚠️ AI CHANGED DIMENSIONS (at sent scale)!')
        console.warn('Expected (sent scale):', sentChunkWidth, 'x', sentChunkHeight)
        console.warn('AI returned:', extendedImg.width, 'x', extendedImg.height)
        console.warn('🔧 Resizing to sent-scale dimensions...')
        
        resizeImage(extendedImg, sentChunkWidth, sentChunkHeight, (resizedAtSentScale) => {
          if (scale !== 1) {
            console.warn('🔧 Upscaling to full resolution...')
            resizeImage(resizedAtSentScale, expectedChunkWidth, expectedChunkHeight, (fullRes) => {
              console.log('✅ Resized to full res:', fullRes.width, 'x', fullRes.height)
              processedExtendedImg = fullRes
              continueStitching()
            })
          } else {
            console.log('✅ Resized to:', resizedAtSentScale.width, 'x', resizedAtSentScale.height)
            processedExtendedImg = resizedAtSentScale
            continueStitching()
          }
        })
        return
      }
      
      if (scale !== 1) {
        console.warn('🔧 Upscaling AI result from sent scale to full resolution...')
        resizeImage(extendedImg, expectedChunkWidth, expectedChunkHeight, (fullRes) => {
          console.log('✅ Upscaled to:', fullRes.width, 'x', fullRes.height)
          processedExtendedImg = fullRes
          continueStitching()
        })
        return
      }
      
      continueStitching()
      
      function continueStitching() {
      
        // Calculate final dimensions based on processed (potentially resized) extended image
        // Extended chunk = new content + AI-blended overlap
        // Remaining original = original minus the overlap portion
        let finalWidth = originalWidth
        let finalHeight = originalHeight
        
        switch (direction) {
          case 'up':
          case 'down':
            // Final height = extended chunk height + remaining original height
            finalHeight = processedExtendedImg.height + (originalHeight - chunkHeight)
            break
          case 'left':
          case 'right':
            // Final width = extended chunk width + remaining original width
            finalWidth = processedExtendedImg.width + (originalWidth - chunkWidth)
            break
        }
        
        console.log('Final canvas size:', finalWidth, 'x', finalHeight)
        console.log('===========================\n')
        
        // Create final canvas
        const canvas = document.createElement('canvas')
        canvas.width = finalWidth
        canvas.height = finalHeight
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }
        
        // Position images based on direction with gradient feathering for seamless blending
        // Use the overlap dimension along the extension axis (width for L/R, height for U/D)
        const overlapSize = direction === 'left' || direction === 'right'
          ? chunkInfo.chunkWidth
          : chunkInfo.chunkHeight
        const baseFeatherSize = Math.floor(overlapSize * 0.2) // 20% of overlap region
        const featherSize = Math.min(
          Math.max(30, baseFeatherSize),
          200,
          Math.floor(overlapSize * 0.25) // Never feather more than 25% of overlap
        )
        
        console.log('--- POSITIONING DEBUG ---')
        console.log('Feather size:', featherSize, 'px')
        
        switch (direction) {
          case 'up':
            // 1. Draw entire extended chunk at top
            console.log('Step 1: Drawing extended chunk at (0, 0) size:', processedExtendedImg.width, 'x', processedExtendedImg.height)
            ctx.drawImage(processedExtendedImg, 0, 0)
          
            // 2. Draw remaining original below
            const extendedChunkHeight = processedExtendedImg.height
            const overlapStartY = extendedChunkHeight
          
            const sourceStartY = chunkInfo.chunkHeight
            const sourceHeightUp = originalHeight - chunkInfo.chunkHeight
            const destStartY = extendedChunkHeight
            
            console.log('Step 2: Drawing remaining original')
            console.log('  Source: (0,', sourceStartY, ') size:', originalWidth, 'x', sourceHeightUp)
            console.log('  Dest: (0,', destStartY, ') size:', finalWidth, 'x', sourceHeightUp)
            console.log('  Seam position (Y):', overlapStartY)
            
            ctx.drawImage(
              originalImg,
              0, sourceStartY, originalWidth, sourceHeightUp,
              0, destStartY, finalWidth, sourceHeightUp
            )
          
          // 3. Apply gradient feathering at the seam for seamless blending
          const gradientY = overlapStartY - featherSize
          console.log('Step 3: Applying gradient feather')
          console.log('  Gradient zone: Y', gradientY, 'to', overlapStartY + featherSize)
          console.log('  Feather zone height:', featherSize * 2, 'px')
          
          const gradient = ctx.createLinearGradient(0, gradientY, 0, overlapStartY + featherSize)
          gradient.addColorStop(0, 'rgba(0,0,0,1)')     // Extended chunk fully visible
          gradient.addColorStop(0.5, 'rgba(0,0,0,0.5)') // 50% blend at seam
          gradient.addColorStop(1, 'rgba(0,0,0,0)')     // Original fully visible
          
          // Create temporary canvas for gradient mask
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = finalWidth
          tempCanvas.height = featherSize * 2
          const tempCtx = tempCanvas.getContext('2d')
          
          if (tempCtx) {
            // Draw the transition area from both images
            tempCtx.drawImage(canvas, 0, gradientY, finalWidth, featherSize * 2, 0, 0, finalWidth, featherSize * 2)
            
            // Apply gradient mask
            tempCtx.globalCompositeOperation = 'destination-in'
            tempCtx.fillStyle = gradient
            tempCtx.fillRect(0, 0, finalWidth, featherSize * 2)
            
            // Draw back with blending
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvas, 0, gradientY)
          }
          console.log('-------------------------\n')
          
          // DEBUG: Draw visual markers at seam
          if (debugMode) {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'
            ctx.lineWidth = 2
            ctx.setLineDash([10, 5])
            ctx.beginPath()
            ctx.moveTo(0, overlapStartY)
            ctx.lineTo(finalWidth, overlapStartY)
            ctx.stroke()
            ctx.setLineDash([])
            
            // Add text label
            ctx.fillStyle = 'rgba(255, 0, 0, 0.9)'
            ctx.font = 'bold 16px Arial'
            ctx.fillText(`Seam at Y: ${overlapStartY}`, 10, overlapStartY - 10)
          }
          break
          
          case 'down':
            // 1. Draw non-overlapping portion of original at top
            const nonOverlapHeight = originalHeight - chunkInfo.chunkHeight
            ctx.drawImage(
              originalImg,
              0, 0, originalWidth, nonOverlapHeight,
              0, 0, finalWidth, nonOverlapHeight
            )
            
            // 2. Draw entire extended chunk below
            ctx.drawImage(processedExtendedImg, 0, nonOverlapHeight)
          
          // 3. Apply gradient feathering at the seam
          const overlapStartYDown = nonOverlapHeight
          const gradientYDown = overlapStartYDown - featherSize
          const gradientDown = ctx.createLinearGradient(0, gradientYDown, 0, overlapStartYDown + featherSize)
          gradientDown.addColorStop(0, 'rgba(0,0,0,0)')
          gradientDown.addColorStop(0.5, 'rgba(0,0,0,0.5)')
          gradientDown.addColorStop(1, 'rgba(0,0,0,1)')
          
          const tempCanvasDown = document.createElement('canvas')
          tempCanvasDown.width = finalWidth
          tempCanvasDown.height = featherSize * 2
          const tempCtxDown = tempCanvasDown.getContext('2d')
          
          if (tempCtxDown) {
            tempCtxDown.drawImage(canvas, 0, gradientYDown, finalWidth, featherSize * 2, 0, 0, finalWidth, featherSize * 2)
            tempCtxDown.globalCompositeOperation = 'destination-in'
            tempCtxDown.fillStyle = gradientDown
            tempCtxDown.fillRect(0, 0, finalWidth, featherSize * 2)
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvasDown, 0, gradientYDown)
          }
          break
          
          case 'left':
            // Layout: [AI chunk (extension + overlap) | original non-overlap]
            ctx.drawImage(
              originalImg,
              0, 0, originalWidth, originalHeight,
              extensionSize, 0, originalWidth, finalHeight
            )
            ctx.drawImage(
              processedExtendedImg,
              0, 0, processedExtendedImg.width, processedExtendedImg.height,
              0, 0, processedExtendedImg.width, finalHeight
            )
          
          const overlapStartXLeft = extensionSize
          const gradientXLeft = overlapStartXLeft - featherSize
          const gradientLeft = ctx.createLinearGradient(gradientXLeft, 0, overlapStartXLeft + featherSize, 0)
          gradientLeft.addColorStop(0, 'rgba(0,0,0,1)')
          gradientLeft.addColorStop(0.5, 'rgba(0,0,0,0.5)')
          gradientLeft.addColorStop(1, 'rgba(0,0,0,0)')
          
          const tempCanvasLeft = document.createElement('canvas')
          tempCanvasLeft.width = featherSize * 2
          tempCanvasLeft.height = finalHeight
          const tempCtxLeft = tempCanvasLeft.getContext('2d')
          
          if (tempCtxLeft) {
            tempCtxLeft.drawImage(canvas, gradientXLeft, 0, featherSize * 2, finalHeight, 0, 0, featherSize * 2, finalHeight)
            tempCtxLeft.globalCompositeOperation = 'destination-in'
            tempCtxLeft.fillStyle = gradientLeft
            tempCtxLeft.fillRect(0, 0, featherSize * 2, finalHeight)
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvasLeft, gradientXLeft, 0)
          }
          break
          
          case 'right': {
            const overlapStartX = originalWidth - chunkWidth
            ctx.drawImage(
              originalImg,
              0, 0, overlapStartX, originalHeight,
              0, 0, overlapStartX, finalHeight
            )
            ctx.drawImage(
              processedExtendedImg,
              0, 0, processedExtendedImg.width, processedExtendedImg.height,
              overlapStartX, 0, processedExtendedImg.width, finalHeight
            )
          
          const overlapStartXRight = overlapStartX
          const gradientXRight = overlapStartXRight - featherSize
          const gradientRight = ctx.createLinearGradient(gradientXRight, 0, overlapStartXRight + featherSize, 0)
          gradientRight.addColorStop(0, 'rgba(0,0,0,0)')
          gradientRight.addColorStop(0.5, 'rgba(0,0,0,0.5)')
          gradientRight.addColorStop(1, 'rgba(0,0,0,1)')
          
          const tempCanvasRight = document.createElement('canvas')
          tempCanvasRight.width = featherSize * 2
          tempCanvasRight.height = finalHeight
          const tempCtxRight = tempCanvasRight.getContext('2d')
          
          if (tempCtxRight) {
            tempCtxRight.drawImage(canvas, gradientXRight, 0, featherSize * 2, finalHeight, 0, 0, featherSize * 2, finalHeight)
            tempCtxRight.globalCompositeOperation = 'destination-in'
            tempCtxRight.fillStyle = gradientRight
            tempCtxRight.fillRect(0, 0, featherSize * 2, finalHeight)
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvasRight, gradientXRight, 0)
          }
            break
          }
        }
        
        resolve(canvas.toDataURL('image/png'))
      } // End of continueStitching()
    }
    
    originalImg.onload = () => {
      originalLoaded = true
      checkBothLoaded()
    }
    
    extendedImg.onload = () => {
      extendedLoaded = true
      checkBothLoaded()
    }
    
    originalImg.onerror = () => reject(new Error('Failed to load original image'))
    extendedImg.onerror = () => reject(new Error('Failed to load extended chunk'))
    
    originalImg.src = originalImageDataUrl
    extendedImg.src = extendedChunkDataUrl
  })
}

export interface ChunkInfo {
  direction: 'up' | 'down' | 'left' | 'right'
  originalWidth: number
  originalHeight: number
  chunkWidth: number
  chunkHeight: number
  extensionSize: number
  sourceX: number
  sourceY: number
  scale?: number // Downscale factor applied before sending to AI (1 = full resolution)
}

export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

