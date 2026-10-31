// A capture of the area a comment targets, cut from the visible half of the app.
// Chrome captures the active tab of the window: in a split view, the half that has the focus.

const OUTLINE = '#ff9f0a'

// rect and viewport in CSS pixels; scale = image pixels per CSS pixel.
// Returns the source box in the image, the destination size, and the target inside it.
export function cropBox (rect, viewport, scale, { margin = 24, max = 1600 } = {}) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
  const x0 = clamp(rect.x - margin, 0, viewport.width - 1)
  const y0 = clamp(rect.y - margin, 0, viewport.height - 1)
  const x1 = clamp(rect.x + rect.width + margin, x0 + 1, viewport.width)
  const y1 = clamp(rect.y + rect.height + margin, y0 + 1, viewport.height)
  const [sx, sy, sw, sh] = [x0, y0, x1 - x0, y1 - y0].map(v => Math.round(v * scale))
  const shrink = Math.min(1, max / Math.max(sw, sh))
  return {
    sx, sy, sw, sh,
    dw: Math.round(sw * shrink),
    dh: Math.round(sh * shrink),
    target: {
      x: Math.round((rect.x * scale - sx) * shrink),
      y: Math.round((rect.y * scale - sy) * shrink),
      width: Math.round(rect.width * scale * shrink),
      height: Math.round(rect.height * scale * shrink)
    }
  }
}

async function dataUrlOf (blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:image/png;base64,${btoa(binary)}`
}

// Refuses unless the app tab is the active half: Chrome would capture the review page instead.
export async function captureCrop (windowId, tabId, rect, viewport, dpr) {
  try {
    if (!(await chrome.tabs.get(tabId)).active) return { ok: false, error: 'app tab not active' }
    const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
    const bitmap = await createImageBitmap(await (await fetch(shot)).blob())
    // The image's own width gives the scale, page zoom included; dpr is only a fallback.
    const box = cropBox(rect, viewport, bitmap.width / viewport.width || dpr)
    const canvas = new OffscreenCanvas(box.dw, box.dh)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, box.sx, box.sy, box.sw, box.sh, 0, 0, box.dw, box.dh)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = Math.max(2, Math.round(2 * box.dw / box.sw * dpr))
    ctx.strokeRect(box.target.x, box.target.y, box.target.width, box.target.height)
    return { ok: true, dataUrl: await dataUrlOf(await canvas.convertToBlob({ type: 'image/png' })) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}
