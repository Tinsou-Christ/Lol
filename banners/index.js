// Banner runtime helpers.
//
// Flow: first call uploads the PNG from disk, Telegram returns a file_id,
// we cache it in RAM keyed by {name}:{mtimeMs}. Every subsequent call uses
// the cached file_id — Telegram serves it from its own CDN, no file transfer.
// Cache wipes on restart (one re-upload per banner per deploy). Cache key
// includes mtime, so rebuilding banners/dist/*.png auto-invalidates without
// any manual bust.
//
// Why RAM not Redis: banners are a tiny number (~3–10), file_ids are short
// strings, losing cache on restart costs one re-upload per banner — Redis
// complexity isn't worth it here.
//
// Navigation note: Telegram allows editing a text message INTO a media
// message via editMessageMedia, but NOT the reverse. So once /start sends
// a banner (photo + caption + keyboard), subsequent navigation within that
// message stays media-based forever — we use editMessageCaption to change
// only the text/keyboard (banner unchanged), or editMessageMedia to swap
// to a different banner.

const fs = require('fs')
const path = require('path')

const DIST = path.join(__dirname, 'dist')

const cache = new Map()

function resolveBanner (name) {
  const file = path.join(DIST, `${name}.png`)
  if (!fs.existsSync(file)) return null
  const { mtimeMs } = fs.statSync(file)
  return { file, cacheKey: `${name}:${Math.floor(mtimeMs)}` }
}

function photoInput (banner) {
  return cache.get(banner.cacheKey) || { source: fs.createReadStream(banner.file) }
}

function rememberFileId (banner, message) {
  const photos = message?.photo
  if (!photos?.length) return
  // Largest size — Telegram reuses this file_id across all size requests
  cache.set(banner.cacheKey, photos[photos.length - 1].file_id)
}

function assertBanner (name) {
  const b = resolveBanner(name)
  if (!b) throw new Error(`[banners] missing dist/${name}.png — run: node banners/build.js`)
  return b
}

// First-time send (text only, no banners)
async function sendBanner(ctx, name, caption = '', extra = {}) {
  return ctx.replyWithHTML(caption, {
    parse_mode: 'HTML',
    reply_markup: extra.reply_markup
  })
}

// Swap the current message's banner (use when navigating between *different*
// banners: e.g. /start welcome → catalog). Works whether the prior message
// was text (upgrades it) or already a photo (replaces the media).
//
// Single-edit guarantee: we send photo + caption + keyboard in ONE API call.
// Telegraf 3.40 serializes `ctx.editMessageMedia(media, extra)` correctly —
// `caption`/`parse_mode` ride inside the InputMedia JSON, `reply_markup` is
// top-level (see node_modules/telegraf/telegram.js:316). So no keyboard-less
// flash between calls, which used to cause visible flicker on navigation.
//
// Same-banner fast path: if the message already shows this exact banner
// (cached file_id matches the largest PhotoSize), skip the media swap and
// do a caption-only edit. That's the pagination case (e.g. packs:N → N+1)
// where Telegram would otherwise re-render the identical photo and briefly
// drop the keyboard.
async function editBanner(ctx, name, caption = '', extra = {}) {
  if (ctx.callbackQuery) {
    return ctx.editMessageText(caption, {
      parse_mode: 'HTML',
      reply_markup: extra.reply_markup
    })
  }

  return ctx.replyWithHTML(caption, extra)
}
// In-place text/keyboard edit without touching the banner. Use when the user
// navigates WITHIN the same banner section (e.g. paging through packs).
// Auto-picks editMessageCaption (if current message is a photo) or
// editMessageText (if it's still plain text) — this keeps legacy text-only
// flows working while photo-based flows just work too.
async function editMenu (ctx, text, extra = {}) {
  const msg = ctx.callbackQuery?.message
  const isPhoto = !!(msg && msg.photo)
  const opts = { parse_mode: 'HTML', ...extra }
  try {
    if (isPhoto) {
      return await ctx.editMessageCaption(text, opts)
    }
    return await ctx.editMessageText(text, opts)
  } catch (err) {
    // benign: message-not-modified / message-to-edit-not-found
  }
}

// Convenience: pick sendBanner vs editBanner by trigger type. Use in handlers
// that can be reached both as a command and as a callback from another menu.
async function replyOrEditBanner(ctx, name, caption = '', extra = {}) {
  if (ctx.callbackQuery) {
    return ctx.editMessageText(caption, {
      parse_mode: 'HTML',
      reply_markup: extra.reply_markup
    })
  }

  return ctx.replyWithHTML(caption, {
    parse_mode: 'HTML',
    reply_markup: extra.reply_markup
  })
}
module.exports = { sendBanner, editBanner, editMenu, replyOrEditBanner }
