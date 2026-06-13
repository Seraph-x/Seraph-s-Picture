const {
  getTelegramFileFromMessage,
  createSignedTelegramFileId,
  shouldUseSignedTelegramLinks,
  shouldWriteTelegramMetadata,
  buildTelegramDirectLink,
  sendTelegramUploadNotice,
} = require('../lib/utils/telegram-webhook');

function normalizeTelegramReplyResult(result, chatId) {
  if (!chatId) {
    return {
      attempted: false,
      ok: false,
      skipped: true,
      reason: 'missing-chat-id',
    };
  }

  if (!result) {
    return {
      attempted: true,
      ok: false,
      skipped: false,
      reason: 'empty-result',
    };
  }

  return {
    attempted: !result.skipped,
    ok: Boolean(result.ok),
    skipped: Boolean(result.skipped),
    reason: result.reason || result.error || result.data?.description || '',
    status: result.data?.error_code || undefined,
  };
}

function registerTelegramRoutes(app, container, helpers) {
  const { getServices, jsonError } = helpers;

  app.get('/api/bing/wallpaper', async (c) => {
    const response = await fetch('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
    if (!response.ok) {
      return jsonError(
        c,
        502,
        'UPSTREAM_BING_FAILED',
        'Failed to fetch Bing wallpapers.',
        `Bing upstream returned HTTP ${response.status}.`,
        true
      );
    }
    const json = await response.json();
    return c.json({ status: true, message: 'ok', data: json.images || [] });
  });
  app.get('/api/bing/wallpaper/', async (c) => {
    const response = await fetch('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
    if (!response.ok) {
      return jsonError(
        c,
        502,
        'UPSTREAM_BING_FAILED',
        'Failed to fetch Bing wallpapers.',
        `Bing upstream returned HTTP ${response.status}.`,
        true
      );
    }
    const json = await response.json();
    return c.json({ status: true, message: 'ok', data: json.images || [] });
  });

  app.post('/api/telegram/webhook', async (c) => {
    const { storageRepo } = getServices(c);

    // Resolve Telegram storage config (from DB or env bootstrap)
    const telegramConfig = (() => {
      const dbConfig = storageRepo.findEnabledByType('telegram')[0];
      if (dbConfig?.config?.botToken && dbConfig?.config?.chatId) {
        return {
          botToken: dbConfig.config.botToken,
          chatId: dbConfig.config.chatId,
          apiBase: dbConfig.config.apiBase || container.config.telegramApiBase,
        };
      }
      const bootstrap = container.config.bootstrapDefaultStorage?.telegram;
      if (bootstrap?.botToken && bootstrap?.chatId) {
        return { botToken: bootstrap.botToken, chatId: bootstrap.chatId, apiBase: bootstrap.apiBase };
      }
      return null;
    })();

    if (!telegramConfig?.botToken) {
      return c.json({ ok: false, error: 'No Telegram bot token configured.' }, 500);
    }

    // Build env-like object for utility functions
    const env = {
      ...process.env,
      TG_Bot_Token: telegramConfig.botToken,
      TG_Chat_ID: telegramConfig.chatId,
      CUSTOM_BOT_API_URL: telegramConfig.apiBase,
      PUBLIC_BASE_URL: container.config.publicBaseUrl,
      FILE_URL_SECRET: container.config.configEncryptionKey,
    };

    // Verify webhook secret if configured
    const expectedSecret = env.TG_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      const headerSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token') || '';
      if (headerSecret !== expectedSecret) {
        return c.json({ ok: false, error: 'Invalid webhook secret.' }, 401);
      }
    }

    let update;
    try {
      update = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body.' }, 400);
    }

    const message = update?.message || update?.channel_post;
    if (!message) {
      return c.json({ ok: true, ignored: 'no-message' });
    }

    const media = getTelegramFileFromMessage(message);
    if (!media) {
      return c.json({ ok: true, ignored: 'message-without-file' });
    }

    const useSigned = shouldUseSignedTelegramLinks(env);
    const directId = useSigned
      ? createSignedTelegramFileId(
          {
            fileId: media.fileId,
            fileExtension: media.fileExtension,
            fileName: media.fileName,
            mimeType: media.mimeType,
            fileSize: media.fileSize,
            messageId: media.messageId,
          },
          env
        )
      : `${media.fileId}.${media.fileExtension}`;

    // Store file metadata in SQLite if enabled
    if (shouldWriteTelegramMetadata(env)) {
      try {
        const { fileRepo } = getServices(c);
        const publicId = `${media.fileId}.${media.fileExtension}`;
        const existing = fileRepo.getById(publicId);
        if (!existing) {
          fileRepo.create({
            id: publicId,
            storageConfigId: 'telegram-webhook',
            storageType: 'telegram',
            storageKey: media.fileId,
            fileName: media.fileName,
            fileSize: media.fileSize,
            mimeType: media.mimeType,
            folderPath: '',
            extra: {
              fromWebhook: true,
              signedLink: useSigned,
              telegramFileId: media.fileId,
              telegramMessageId: media.messageId || undefined,
            },
          });
        }
      } catch (dbErr) {
        console.error('[telegram-webhook] metadata store error:', dbErr.message);
      }
    }

    const requestUrl = new URL(c.req.url);
    const origin = `${requestUrl.protocol}//${requestUrl.host}`;
    const directLink = buildTelegramDirectLink(env, directId, origin);
    const chatId = message?.chat?.id;
    let reply = normalizeTelegramReplyResult(null, chatId);

    if (chatId) {
      const noticeResult = await sendTelegramUploadNotice(
        {
          chatId,
          replyToMessageId: message.message_id,
          directLink,
          fileId: media.fileId,
          messageId: media.messageId || message.message_id,
          fileName: media.fileName,
          fileSize: media.fileSize,
        },
        env
      );
      reply = normalizeTelegramReplyResult(noticeResult, chatId);
      if (!noticeResult?.ok && !noticeResult?.skipped) {
        console.warn(
          '[telegram-webhook] reply failed:',
          noticeResult?.data?.description || noticeResult?.error || 'unknown error'
        );
      }
    }

    return c.json({
      ok: true,
      directLink,
      storageType: 'telegram',
      mode: useSigned ? 'signed' : 'direct',
      update: {
        chatId,
        messageId: message.message_id,
        mediaKind: media.kind,
      },
      reply,
    });
  });

  app.get('/api/health', (c) => {
    return c.json({ ok: true, mode: 'docker-node', timestamp: Date.now() });
  });
}

module.exports = {
  registerTelegramRoutes,
};
