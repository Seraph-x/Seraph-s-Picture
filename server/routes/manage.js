const { normalizeFolderPath } = require('../lib/repos/file-repo');

function registerManageRoutes(app, container, helpers) {
  const {
    getServices,
    jsonError,
    methodNotAllowed,
    asString,
    firstNonEmpty,
    parseBoundedInt,
    isTruthy,
    requireAuth,
  } = helpers;

  app.get('/api/manage/list', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const limit = parseBoundedInt(
      firstNonEmpty(c.req.query('limit'), c.req.query('pageSize'), c.req.query('size')),
      100,
      1,
      1000
    );

    let cursor = firstNonEmpty(c.req.query('cursor'), c.req.query('offset'));
    if (!cursor) {
      const current = parseBoundedInt(
        firstNonEmpty(c.req.query('page'), c.req.query('current')),
        1,
        1,
        Number.MAX_SAFE_INTEGER
      );
      cursor = current > 1 ? String((current - 1) * limit) : null;
    }

    const storage = c.req.query('storage') || 'all';
    const search = c.req.query('search') || '';
    const listType = c.req.query('listType') || c.req.query('list_type') || 'all';
    const folderPath = normalizeFolderPath(c.req.query('folderPath') || c.req.query('path') || '');

    const includeStatsRaw = String(c.req.query('includeStats') || c.req.query('stats') || '').toLowerCase();
    const includeStats = ['1', 'true', 'yes'].includes(includeStatsRaw);

    const payload = fileRepo.list({
      limit,
      cursor,
      includeStats,
      filters: {
        storageType: storage,
        search,
        listType,
        folderPath: c.req.query('folderPath') != null || c.req.query('path') != null ? folderPath : undefined,
      },
    });

    return c.json(payload);
  });

  app.get('/api/drive/tree', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const storage = c.req.query('storage') || 'all';

    const nodes = fileRepo.listFolderTree({
      storageType: storage,
    });

    return c.json({
      success: true,
      nodes,
    });
  });

  app.get('/api/drive/explorer', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const limit = parseBoundedInt(c.req.query('limit'), 100, 1, 1000);
    const cursor = c.req.query('cursor');
    const storage = c.req.query('storage') || 'all';
    const search = c.req.query('search') || '';
    const listType = c.req.query('listType') || c.req.query('list_type') || 'all';
    const includeStatsRaw = String(c.req.query('includeStats') || c.req.query('stats') || '').toLowerCase();
    const includeStats = ['1', 'true', 'yes'].includes(includeStatsRaw);
    const folderPath = normalizeFolderPath(c.req.query('path') || c.req.query('folderPath') || '');

    const payload = fileRepo.listExplorer({
      folderPath,
      limit,
      cursor,
      includeStats,
      filters: {
        storageType: storage,
        search,
        listType,
      },
    });

    return c.json({
      success: true,
      ...payload,
    });
  });

  app.get('/api/manage/folders', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const storage = c.req.query('storage') || 'all';

    const folders = fileRepo.listFolderTree({
      storageType: storage,
    });

    return c.json({
      success: true,
      folders,
    });
  });

  app.post('/api/drive/folders', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const path = normalizeFolderPath(body.path || body.folderPath);

    if (!path) {
      return jsonError(c, 400, 'PATH_REQUIRED', 'path is required.', 'Provide path or folderPath.');
    }

    const folder = fileRepo.createFolder(path);
    return c.json({ success: true, folder });
  });
  app.post('/api/manage/folders', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const path = normalizeFolderPath(body.path || body.folderPath);
    if (!path) {
      return jsonError(c, 400, 'PATH_REQUIRED', 'path is required.', 'Provide path or folderPath.');
    }
    const folder = fileRepo.createFolder(path);
    return c.json({ success: true, folder });
  });

  app.post('/api/drive/folders/move', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const sourcePath = normalizeFolderPath(body.sourcePath);
    let targetPath = normalizeFolderPath(body.targetPath);
    if (!targetPath && body.targetParentPath && body.newName) {
      targetPath = normalizeFolderPath(`${body.targetParentPath}/${body.newName}`);
    }

    if (!sourcePath || !targetPath) {
      return jsonError(
        c,
        400,
        'MOVE_PATHS_REQUIRED',
        'sourcePath and targetPath are required.',
        'Provide both sourcePath and targetPath.'
      );
    }

    const result = fileRepo.moveFolder(sourcePath, targetPath);
    return c.json({ success: true, ...result });
  });
  app.put('/api/manage/folders', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const sourcePath = normalizeFolderPath(body.sourcePath || body.path || '');
    const targetPath = normalizeFolderPath(body.targetPath || body.newPath || '');
    if (!sourcePath || !targetPath) {
      return jsonError(
        c,
        400,
        'MOVE_PATHS_REQUIRED',
        'sourcePath and targetPath are required.',
        'Provide both sourcePath and targetPath.'
      );
    }
    const result = fileRepo.moveFolder(sourcePath, targetPath);
    return c.json({ success: true, ...result });
  });

  app.delete('/api/drive/folders', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo, uploadService } = getServices(c);
    const path = normalizeFolderPath(c.req.query('path'));
    const recursive = isTruthy(c.req.query('recursive'));

    if (!path) {
      return jsonError(c, 400, 'PATH_REQUIRED', 'path is required.', 'Provide path query parameter.');
    }

    if (recursive) {
      const fileIds = fileRepo.listFileIdsByFolderPrefix(path);
      for (const fileId of fileIds) {
        await uploadService.deleteFile(fileId);
      }
    }

    const result = fileRepo.deleteFolder(path, { recursive });
    return c.json({
      success: true,
      recursive,
      ...result,
    });
  });
  app.delete('/api/manage/folders', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const path = normalizeFolderPath(c.req.query('path'));
    const recursive = isTruthy(c.req.query('recursive'));
    if (!path) {
      return jsonError(c, 400, 'PATH_REQUIRED', 'path is required.', 'Provide path query parameter.');
    }

    let movedFiles = 0;
    if (recursive) {
      const fileIds = fileRepo.listFileIdsByFolderPrefix(path);
      const moved = fileRepo.moveFiles(fileIds, '');
      movedFiles = Number(moved.moved || 0);
    }

    const result = fileRepo.deleteFolder(path, { recursive });
    return c.json({
      success: true,
      recursive,
      movedFiles,
      ...result,
    });
  });

  app.post('/api/drive/files/move', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const targetFolderPath = normalizeFolderPath(body.targetFolderPath || body.path || '');

    const result = fileRepo.moveFiles(ids, targetFolderPath);
    return c.json({
      success: true,
      ...result,
    });
  });
  app.post('/api/manage/files/move-folder', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const targetFolderPath = normalizeFolderPath(body.targetFolderPath || body.folderPath || body.path || '');

    const result = fileRepo.moveFiles(ids, targetFolderPath);
    return c.json({
      success: true,
      ...result,
    });
  });

  app.post('/api/drive/files/rename', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const id = asString(body.id).trim();
    const fileName = asString(body.fileName || body.name).trim();

    if (!id || !fileName) {
      return jsonError(
        c,
        400,
        'FILE_RENAME_PARAMS_REQUIRED',
        'id and fileName are required.',
        'Provide id and fileName in request body.'
      );
    }

    const updated = fileRepo.updateMetadata(id, { fileName });
    if (!updated) {
      return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`);
    }

    return c.json({
      success: true,
      file: {
        id: updated.id,
        fileName: updated.file_name,
      },
    });
  });

  app.post('/api/drive/files/delete-batch', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { uploadService } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return jsonError(c, 400, 'IDS_REQUIRED', 'ids is required.', 'Provide at least one file id.');
    }

    let deleted = 0;
    for (const id of ids) {
      const result = await uploadService.deleteFile(id);
      if (result.deleted) deleted += 1;
    }

    return c.json({
      success: true,
      requested: ids.length,
      deleted,
    });
  });

  app.get('/api/manage/toggleLike/:id', (c) => methodNotAllowed(c, 'POST'));
  app.post('/api/manage/toggleLike/:id', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const file = fileRepo.getById(id);
    if (!file) return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`);

    const updated = fileRepo.updateMetadata(id, { liked: !Boolean(file.liked) });
    return c.json({ success: true, liked: Boolean(updated.liked) });
  });

  app.get('/api/manage/editName/:id', (c) => methodNotAllowed(c, 'POST'));
  app.post('/api/manage/editName/:id', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const newName = String(body.newName || '').trim();

    if (!newName) return jsonError(c, 400, 'NEW_NAME_REQUIRED', 'newName is required.', 'Provide newName in the JSON body.');
    const updated = fileRepo.updateMetadata(id, { fileName: newName });
    if (!updated) return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`);

    return c.json({ success: true, fileName: updated.file_name, key: updated.id });
  });

  app.get('/api/manage/block/:id', (c) => methodNotAllowed(c, 'POST'));
  app.post('/api/manage/block/:id', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const nextListType = 'Block';
    const updated = fileRepo.updateMetadata(id, { listType: nextListType });
    if (!updated) return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`);

    return c.json({ success: true, listType: nextListType, key: updated.id });
  });

  app.get('/api/manage/white/:id', (c) => methodNotAllowed(c, 'POST'));
  app.post('/api/manage/white/:id', (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { fileRepo } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const nextListType = 'White';
    const updated = fileRepo.updateMetadata(id, { listType: nextListType });
    if (!updated) return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`);

    return c.json({ success: true, listType: nextListType, key: updated.id });
  });

  app.get('/api/manage/delete/:id', (c) => methodNotAllowed(c, 'DELETE'));
  app.delete('/api/manage/delete/:id', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { uploadService } = getServices(c);
    const id = decodeURIComponent(c.req.param('id'));
    const result = await uploadService.deleteFile(id);

    if (!result.deleted) {
      return jsonError(c, 404, 'FILE_NOT_FOUND', 'File not found.', `File "${id}" does not exist.`);
    }

    return c.json({ success: true, message: 'File deleted.', fileId: id });
  });
}

module.exports = {
  registerManageRoutes,
};
