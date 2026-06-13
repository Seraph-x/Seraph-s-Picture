const { createShareSignature, verifyShareSignature } = require('../lib/utils/share-link');

function registerFileRoutes(app, container, helpers) {
  const {
    getServices,
    jsonError,
    asString,
    requireAuth,
    buildFileProxyHeaders,
    handleSignedTelegramFile,
    parseShareExpiry,
    toAbsoluteUrl,
  } = helpers;

  app.get('/api/file-info/:id', (c) => {
    const { fileRepo } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const file = fileRepo.getById(id);

    if (!file) {
      return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`, false, { fileId: id });
    }

    return c.json({
      success: true,
      fileId: file.id,
      key: file.id,
      fileName: file.file_name,
      originalName: file.file_name,
      fileSize: file.file_size,
      uploadTime: file.created_at,
      storageType: file.storage_type,
      listType: file.list_type,
      label: file.label,
      liked: Boolean(file.liked),
      folderPath: file.metadata?.folderPath || '',
    });
  });

  app.get('/file/:id', async (c) => {
    const { uploadService, storageRepo } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const range = c.req.header('range');

    // Handle signed Telegram file IDs (tgs_ prefix)
    if (id.startsWith('tgs_')) {
      try {
        return await handleSignedTelegramFile(id, range, storageRepo, c);
      } catch (error) {
        console.error('signed telegram file proxy error:', error);
        return c.text(`Signed file proxy error: ${error?.message || 'Unknown error'}`, 502);
      }
    }

    try {
      const result = await uploadService.getFileResponse(id, range);
      if (!result) {
        return c.text('File not found', 404);
      }

      const upstream = result.response;
      const headers = buildFileProxyHeaders(result, upstream.headers);

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (error) {
      console.error('file proxy route error:', error);
      return c.text(`File proxy error: ${error?.message || 'Unknown error'}`, 502);
    }
  });

  app.options('/file/:id', (c) => c.body(null, 204));
  app.on('HEAD', '/file/:id', async (c) => {
    const { uploadService, storageRepo } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const range = c.req.header('range');

    if (id.startsWith('tgs_')) {
      try {
        return await handleSignedTelegramFile(id, range, storageRepo, c, true);
      } catch (error) {
        console.error('signed telegram file HEAD error:', error);
        return c.body(null, 502);
      }
    }

    try {
      const result = await uploadService.getFileResponse(id, range);
      if (!result) {
        return c.body(null, 404);
      }

      const upstream = result.response;
      const headers = buildFileProxyHeaders(result, upstream.headers);

      return new Response(null, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (error) {
      console.error('file proxy HEAD route error:', error);
      return c.body(null, 502, {
        'X-File-Proxy-Error': String(error?.message || 'Unknown error').slice(0, 200),
      });
    }
  });

  app.get('/share/:id', async (c) => {
    const { uploadService } = getServices(c);
    const fileId = decodeURIComponent(c.req.param('id'));
    const expiresAt = Number(c.req.query('exp') || 0);
    const signature = c.req.query('sig') || '';
    const range = c.req.header('range');

    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      return c.text('Invalid share expiry.', 400);
    }
    if (Date.now() > expiresAt) {
      return c.text('Share link expired.', 410);
    }

    const secret = container.config.sessionSecret || container.config.configEncryptionKey;
    if (!verifyShareSignature({ fileId, expiresAt, signature, secret })) {
      return c.text('Invalid share signature.', 403);
    }

    try {
      const result = await uploadService.getFileResponse(fileId, range);
      if (!result) {
        return c.text('File not found', 404);
      }

      const upstream = result.response;
      const headers = buildFileProxyHeaders(result, upstream.headers);
      headers.set('Cache-Control', 'private, max-age=60');

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (error) {
      console.error('share proxy route error:', error);
      return c.text(`Share proxy error: ${error?.message || 'Unknown error'}`, 502);
    }
  });

  app.options('/share/:id', (c) => c.body(null, 204));

  app.post('/api/share/sign', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const fileId = asString(body.fileId || body.id).trim();
    if (!fileId) {
      return jsonError(c, 400, 'FILE_ID_REQUIRED', 'fileId is required.', 'Provide fileId in request body.');
    }

    const file = fileRepo.getById(fileId);
    if (!file) {
      return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${fileId}" does not exist.`);
    }

    const expiresAt = parseShareExpiry(body.ttlSeconds || body.expiresIn || body.ttl || undefined);
    const secret = container.config.sessionSecret || container.config.configEncryptionKey;
    const signature = createShareSignature({ fileId, expiresAt, secret });
    const sharePath = `/share/${encodeURIComponent(fileId)}?exp=${expiresAt}&sig=${encodeURIComponent(signature)}`;

    return c.json({
      success: true,
      permission: 'public-read-signed',
      expiresAt,
      sharePath,
      shareUrl: toAbsoluteUrl(c, sharePath),
      directPath: `/file/${encodeURIComponent(fileId)}`,
      directUrl: toAbsoluteUrl(c, `/file/${encodeURIComponent(fileId)}`),
    });
  });
}

module.exports = {
  registerFileRoutes,
};
