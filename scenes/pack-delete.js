const Scene = require('telegraf/scenes/base')
const Markup = require('telegraf/markup')
const { match } = require('telegraf-i18n')
const { escapeHTML } = require('../utils')
const { humanizeTelegramError } = require('../utils/telegram-error')

const packDelete = new Scene('packDelete')

packDelete.enter(async (ctx) => {
  const stickerSet = await ctx.db.StickerSet.findById(ctx.match[1])

  if (!stickerSet) return ctx.answerCbQuery(ctx.i18n.t('callback.pack.answerCbQuer.not_found'), true)

  if (stickerSet.owner.toString() !== ctx.session.userInfo.id.toString()) {
    await ctx.answerCbQuery(ctx.i18n.t('error.access_denied'), true)
    return ctx.scene.leave()
  }

  await ctx.deleteMessage().catch(() => {})

  ctx.session.scene = {
    id: 'packDelete',
    data: {
      id: stickerSet._id,
      name: stickerSet.name,
      title: stickerSet.title
    }
  }

  const linkPrefix = stickerSet.packType === 'custom_emoji' ? ctx.config.emojiLinkPrefix : ctx.config.stickerLinkPrefix

  await ctx.replyWithHTML(ctx.i18n.t('scenes.delete_pack.enter', {
    link: `${linkPrefix}${stickerSet.name}`,
    title: escapeHTML(stickerSet.title),
    confirm: ctx.i18n.t('scenes.delete_pack.confirm')
  }), {
    reply_markup: Markup.keyboard([
      [
        { text: ctx.i18n.t('scenes.btn.cancel'), style: 'danger' }
      ]
    ]).resize()
  })
})

packDelete.hears(match('scenes.delete_pack.confirm'), async (ctx) => {
  if (!ctx.session.scene?.data) return ctx.scene.leave()

  const { id, name, title } = ctx.session.scene.data
  const successText = title
    ? `${ctx.i18n.t('scenes.delete_pack.success')}\n\n📦 <i>${escapeHTML(title)}</i>`
    : ctx.i18n.t('scenes.delete_pack.success')

  try {
    await ctx.telegram.callApi('deleteStickerSet', { name })
  } catch (error) {
    const description = error?.description || error?.message || ''

    if (description.includes('STICKERSET_INVALID')) {
      // Pack already gone in Telegram — clean DB and treat as success.
      await ctx.db.StickerSet.deleteOne({ _id: id })
      return ctx.replyWithHTML(successText, {
        reply_markup: Markup.removeKeyboard()
      })
    }

    return ctx.replyWithHTML(humanizeTelegramError(ctx, error), {
      reply_markup: Markup.keyboard([
        [
          { text: ctx.i18n.t('scenes.btn.cancel'), style: 'danger' }
        ]
      ]).resize()
    })
  }

  await ctx.db.StickerSet.updateOne({ _id: id }, { deleted: true })
  await ctx.db.Sticker.updateMany({
    stickerSet: id
  }, {
    $set: { deleted: true, deletedAt: new Date() }
  })

  await ctx.replyWithHTML(successText, {
    reply_markup: Markup.removeKeyboard()
  })
})

module.exports = packDelete
