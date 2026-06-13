const { toStorageErrorPayload } = require('../lib/utils/storage-error');

function getBootstrapReadiness(config) {
  const bootstrap = config?.bootstrapDefaultStorage || {};
  const byType = {
    telegram: Boolean(bootstrap.telegram?.botToken && bootstrap.telegram?.chatId),
    r2: Boolean(bootstrap.r2?.endpoint && bootstrap.r2?.bucket && bootstrap.r2?.accessKeyId && bootstrap.r2?.secretAccessKey),
    s3: Boolean(bootstrap.s3?.endpoint && bootstrap.s3?.bucket && bootstrap.s3?.accessKeyId && bootstrap.s3?.secretAccessKey),
    discord: Boolean(bootstrap.discord?.webhookUrl || (bootstrap.discord?.botToken && bootstrap.discord?.channelId)),
    huggingface: Boolean(bootstrap.huggingface?.token && bootstrap.huggingface?.repo),
    webdav: Boolean(bootstrap.webdav?.baseUrl && (bootstrap.webdav?.bearerToken || (bootstrap.webdav?.username && bootstrap.webdav?.password))),
    github: Boolean(bootstrap.github?.repo && bootstrap.github?.token),
  };

  return {
    defaultType: String(bootstrap.type || 'telegram').toLowerCase(),
    byType,
  };
}

function registerStorageRoutes(app, container, helpers) {
  const { getServices, jsonError, requireAuth, formatStatusDetail, getUploadLimits } = helpers;

  app.get('/api/storage/list', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageRepo } = getServices(c);
    return c.json({ success: true, items: storageRepo.list(false) });
  });

  app.post('/api/storage', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageRepo } = getServices(c);
    const body = await c.req.json();

    const created = storageRepo.create({
      name: body.name,
      type: body.type,
      config: body.config || {},
      enabled: body.enabled !== false,
      isDefault: Boolean(body.isDefault),
      metadata: body.metadata || {},
    });

    return c.json({ success: true, item: storageRepo.getById(created.id, false) });
  });

  app.put('/api/storage/:id', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageRepo } = getServices(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const updated = storageRepo.update(id, {
      name: body.name,
      type: body.type,
      config: body.config,
      enabled: body.enabled,
      isDefault: body.isDefault,
      metadata: body.metadata,
    });

    if (!updated) {
      return jsonError(c, 404, 'STORAGE_NOT_FOUND', 'Storage config not found.', `Storage config "${id}" does not exist.`);
    }

    return c.json({ success: true, item: storageRepo.getById(id, false) });
  });

  app.delete('/api/storage/:id', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageRepo } = getServices(c);
    const id = c.req.param('id');
    let deleted = false;
    try {
      deleted = storageRepo.delete(id);
    } catch (error) {
      return jsonError(
        c,
        409,
        'STORAGE_CONFLICT',
        'Storage config cannot be deleted.',
        error?.message || 'Storage profile is in use.'
      );
    }

    if (!deleted) {
      return jsonError(c, 404, 'STORAGE_NOT_FOUND', 'Storage config not found.', `Storage config "${id}" does not exist.`);
    }
    return c.json({ success: true });
  });

  app.post('/api/storage/:id/test', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageRepo, storageFactory } = getServices(c);
    const id = c.req.param('id');
    const item = storageRepo.getById(id, true);
    if (!item) {
      return jsonError(c, 404, 'STORAGE_NOT_FOUND', 'Storage config not found.', `Storage config "${id}" does not exist.`);
    }

    try {
      const adapter = storageFactory.createAdapter(item);
      const result = await adapter.testConnection();
      const normalized = {
        ...(result || {}),
      };
      if (!normalized.connected) {
        normalized.detail = formatStatusDetail(normalized.detail || normalized.raw || 'Connection failed');
        normalized.errorModel = toStorageErrorPayload(normalized.detail || 'Connection failed', normalized.status);
      }
      return c.json({ success: true, result: normalized });
    } catch (error) {
      const payload = toStorageErrorPayload(error);
      return c.json({ success: true, result: { connected: false, errorModel: payload, detail: payload.detail } });
    }
  });

  app.post('/api/storage/bootstrap/sync', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageRepo } = getServices(c);
    storageRepo.ensureBootstrapStorage();

    const items = storageRepo.list(false);
    return c.json({
      success: true,
      synced: true,
      bootstrap: getBootstrapReadiness(container.config),
      items,
    });
  });

  app.post('/api/storage/default/:id', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageRepo } = getServices(c);
    const id = c.req.param('id');
    const item = storageRepo.setDefault(id);
    if (!item) {
      return jsonError(c, 404, 'STORAGE_NOT_FOUND', 'Storage config not found.', `Storage config "${id}" does not exist.`);
    }

    return c.json({ success: true, item: storageRepo.getById(id, false) });
  });

  app.post('/api/storage/test', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { storageFactory } = getServices(c);
    const body = await c.req.json();
    try {
      const adapter = storageFactory.createTemporaryAdapter(body.type, body.config || {});
      const result = await adapter.testConnection();
      const normalized = {
        ...(result || {}),
      };
      if (!normalized.connected) {
        normalized.detail = formatStatusDetail(normalized.detail || normalized.raw || 'Connection failed');
        normalized.errorModel = toStorageErrorPayload(normalized.detail || 'Connection failed', normalized.status);
      }
      return c.json({ success: true, result: normalized });
    } catch (error) {
      const payload = toStorageErrorPayload(error);
      return c.json({ success: true, result: { connected: false, errorModel: payload, detail: payload.detail } });
    }
  });

  app.get('/api/status', async (c) => {
    const { storageRepo, storageFactory, authService, guestService, settingsStore } = getServices(c);

    const status = {
      telegram: {
        connected: false,
        enabled: false,
        configured: false,
        layer: 'direct',
        message: 'Not configured',
      },
      kv: { connected: true, message: 'SQLite metadata storage enabled' },
      r2: { connected: false, enabled: false, configured: false, layer: 'direct', message: 'Not configured' },
      s3: { connected: false, enabled: false, configured: false, layer: 'direct', message: 'Not configured' },
      discord: { connected: false, enabled: false, configured: false, layer: 'direct', message: 'Not configured' },
      huggingface: { connected: false, enabled: false, configured: false, layer: 'direct', message: 'Not configured' },
      webdav: { connected: false, enabled: false, configured: false, layer: 'mounted', message: 'Not configured' },
      github: { connected: false, enabled: false, configured: false, layer: 'direct', message: 'Not configured' },
      auth: {
        enabled: authService.isAuthRequired(),
        message: authService.isAuthRequired() ? 'Password auth enabled' : 'No auth required',
      },
      guestUpload: guestService.getConfig(),
      uploadLimits: getUploadLimits(),
      settings: { connected: false, message: 'Unknown' },
      diagnostics: {},
    };

    status.settings = await settingsStore.healthCheck();

    const configs = storageRepo.list(true);
    const byType = {
      telegram: configs.find((item) => item.type === 'telegram') || null,
      r2: configs.find((item) => item.type === 'r2') || null,
      s3: configs.find((item) => item.type === 's3') || null,
      discord: configs.find((item) => item.type === 'discord') || null,
      huggingface: configs.find((item) => item.type === 'huggingface') || null,
      webdav: configs.find((item) => item.type === 'webdav') || null,
      github: configs.find((item) => item.type === 'github') || null,
    };

    for (const [type, storageConfig] of Object.entries(byType)) {
      if (!storageConfig) continue;
      if (!storageConfig.enabled) {
        status[type] = {
          connected: false,
          enabled: false,
          configured: true,
          layer: status[type]?.layer || 'direct',
          message: `Configured (${storageConfig.name}) but disabled`,
          configName: storageConfig.name,
        };
        continue;
      }
      try {
        const adapter = storageFactory.createAdapter(storageConfig);
        const result = await adapter.testConnection();
        const detailText = formatStatusDetail(result.detail || result.raw || '');
        const errorModel = result.connected
          ? undefined
          : toStorageErrorPayload(detailText || 'Connection failed', result.status);

        status[type] = {
          connected: Boolean(result.connected),
          enabled: Boolean(storageConfig.enabled),
          configured: true,
          layer: status[type]?.layer || 'direct',
          message: result.connected
            ? `Connected (${storageConfig.name})`
            : (detailText ? `Connection failed: ${detailText}` : 'Connection failed'),
          errorModel,
          configName: storageConfig.name,
        };
      } catch (error) {
        const errorModel = toStorageErrorPayload(error);
        status[type] = {
          connected: false,
          enabled: Boolean(storageConfig.enabled),
          configured: true,
          layer: status[type]?.layer || 'direct',
          message: `Connection error: ${errorModel.detail}`,
          errorModel,
          configName: storageConfig.name,
        };
      }
    }

    const telegramConfig = byType.telegram;
    if (telegramConfig) {
      const envSource = telegramConfig.metadata?.envSource
        || container.config.bootstrapDefaultStorage?.telegram?.envSource
        || {};
      const hasToken = Boolean(telegramConfig.config?.botToken);
      const hasChatId = Boolean(telegramConfig.config?.chatId);
      const telegramStatus = status.telegram || {};
      status.diagnostics.telegram = {
        summary: telegramStatus.connected
          ? 'Telegram adapter is connected.'
          : (telegramStatus.message || 'Telegram adapter is unavailable.'),
        configName: telegramConfig.name || '',
        configSource: telegramConfig.metadata?.source || 'dynamic-storage-config',
        tokenSource: envSource.botToken || 'configured in storage profile',
        chatIdSource: envSource.chatId || 'configured in storage profile',
        apiBaseSource: envSource.apiBase || 'configured in storage profile',
        hasToken,
        hasChatId,
      };
    } else {
      const envSource = container.config.bootstrapDefaultStorage?.telegram?.envSource || {};
      const hasToken = Boolean(container.config.bootstrapDefaultStorage?.telegram?.botToken);
      const hasChatId = Boolean(container.config.bootstrapDefaultStorage?.telegram?.chatId);
      status.diagnostics.telegram = {
        summary: 'Telegram storage profile is not created yet.',
        configName: '',
        configSource: 'not-configured',
        tokenSource: envSource.botToken || 'not found',
        chatIdSource: envSource.chatId || 'not found',
        apiBaseSource: envSource.apiBase || 'default',
        hasToken,
        hasChatId,
      };
    }

    status.capabilities = [
      { type: 'telegram', label: 'Telegram', layer: 'direct', enableHint: 'Create a Telegram storage profile in Storage Config.' },
      { type: 'r2', label: 'Cloudflare R2', layer: 'direct', enableHint: 'Create an R2 profile with endpoint/bucket/keys.' },
      { type: 's3', label: 'S3 Compatible', layer: 'direct', enableHint: 'Create an S3 profile with endpoint/region/bucket/keys.' },
      { type: 'discord', label: 'Discord', layer: 'direct', enableHint: 'Create a Discord webhook or bot profile.' },
      { type: 'huggingface', label: 'HuggingFace', layer: 'direct', enableHint: 'Create a HuggingFace profile with token + dataset repo.' },
      { type: 'github', label: 'GitHub', layer: 'direct', enableHint: 'Create a GitHub profile in Releases or Contents mode.' },
      {
        type: 'webdav',
        label: 'WebDAV (Mounted)',
        layer: 'mounted',
        enableHint: 'Recommended for mounted/aggregated storage (e.g. alist/openlist WebDAV endpoint).',
      },
    ];

    return c.json(status);
  });
}

module.exports = {
  registerStorageRoutes,
};
