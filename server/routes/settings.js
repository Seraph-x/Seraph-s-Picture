const fs = require('node:fs/promises');
const path = require('node:path');

const UI_CONFIG_FILE_NAME = 'ui_config.json';
const UI_EFFECT_STYLES = new Set(['none', 'math', 'particle', 'texture']);
const DEFAULT_UI_CONFIG = {
  version: 1,
  baseColor: '#fafaf8',
  globalBackgroundUrl: '',
  loginBackgroundMode: 'follow-global',
  loginBackgroundUrl: '',
  cardOpacity: 86,
  cardBlur: 14,
  effectStyle: 'math',
  effectIntensity: 22,
  optimizeMobile: true,
};

function clampUiNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeUiHexColor(value) {
  const text = String(value || '').trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) {
    return DEFAULT_UI_CONFIG.baseColor;
  }
  if (text.length === 4) {
    return (
      '#' +
      text[1] +
      text[1] +
      text[2] +
      text[2] +
      text[3] +
      text[3]
    ).toLowerCase();
  }
  return text.toLowerCase();
}

function sanitizeUiUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  if (/^(https?:)?\/\//i.test(text)) return text;
  if (/^\//.test(text)) return text;
  return '';
}

function normalizeUiConfig(raw) {
  const next = Object.assign({}, DEFAULT_UI_CONFIG, raw || {});
  next.baseColor = normalizeUiHexColor(next.baseColor);
  next.globalBackgroundUrl = sanitizeUiUrl(next.globalBackgroundUrl);
  next.loginBackgroundMode = next.loginBackgroundMode === 'custom' ? 'custom' : 'follow-global';
  next.loginBackgroundUrl = sanitizeUiUrl(next.loginBackgroundUrl);
  next.cardOpacity = Math.round(clampUiNumber(next.cardOpacity, 0, 100));
  next.cardBlur = Math.round(clampUiNumber(next.cardBlur, 0, 32));
  next.effectStyle = UI_EFFECT_STYLES.has(next.effectStyle) ? next.effectStyle : DEFAULT_UI_CONFIG.effectStyle;
  next.effectIntensity = Math.round(clampUiNumber(next.effectIntensity, 0, 100));
  next.optimizeMobile = next.optimizeMobile !== false;
  return next;
}

function extractUiConfigPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  if (input.config && typeof input.config === 'object' && !Array.isArray(input.config)) {
    return input.config;
  }
  if (input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)) {
    return input.settings;
  }
  return input;
}

function registerSettingsRoutes(app, container, helpers) {
  const { getServices, jsonError, requireAuth } = helpers;

  function sanitizeSettingEntries(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }

    const output = {};
    for (const [rawKey, value] of Object.entries(input)) {
      const key = String(rawKey || '').trim();
      if (!key) continue;
      output[key] = value;
    }
    return output;
  }

  function getSettingsKeyList(c) {
    const list = [];
    const rawSingle = c.req.query('key');
    const rawList = c.req.query('keys');

    if (rawSingle) {
      list.push(String(rawSingle));
    }
    if (rawList) {
      for (const key of String(rawList).split(',')) {
        list.push(key);
      }
    }

    return list
      .map((key) => String(key || '').trim())
      .filter(Boolean);
  }

  function resolveUiConfigPath() {
    const dir = container.config.dataDir || path.resolve(process.cwd(), 'data');
    return path.join(dir, UI_CONFIG_FILE_NAME);
  }

  async function readUiConfig() {
    const filePath = resolveUiConfigPath();
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeUiConfig(parsed);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return normalizeUiConfig(DEFAULT_UI_CONFIG);
      }
      console.warn('[ui-config] failed to read config, falling back to defaults:', error?.message || error);
      return normalizeUiConfig(DEFAULT_UI_CONFIG);
    }
  }

  async function writeUiConfig(input) {
    const filePath = resolveUiConfigPath();
    const normalized = normalizeUiConfig(input);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
  }

  const getSettingsHandler = async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { settingsStore } = getServices(c);
    const keys = getSettingsKeyList(c);
    const settings = keys.length > 0
      ? await settingsStore.getMany(keys)
      : await settingsStore.getAll();

    return c.json({ success: true, settings });
  };

  const setSettingsHandler = async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { settingsStore } = getServices(c);
    const body = await c.req.json().catch(() => ({}));
    const source = body.settings != null ? body.settings : body;
    const settings = sanitizeSettingEntries(source);
    const removeKeys = Array.isArray(body.removeKeys)
      ? body.removeKeys.map((key) => String(key || '').trim()).filter(Boolean)
      : [];

    if (Object.keys(settings).length > 0) {
      await settingsStore.setMany(settings);
    }
    if (removeKeys.length > 0) {
      await settingsStore.deleteMany(removeKeys);
    }

    return c.json({
      success: true,
      settings: await settingsStore.getAll(),
    });
  };

  const deleteSettingsHandler = async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const { settingsStore } = getServices(c);
    const queryKeys = getSettingsKeyList(c);
    let payloadKeys = [];

    if (queryKeys.length === 0) {
      const body = await c.req.json().catch(() => ({}));
      if (Array.isArray(body.keys)) {
        payloadKeys = body.keys.map((key) => String(key || '').trim()).filter(Boolean);
      }
    }

    const keys = queryKeys.length > 0 ? queryKeys : payloadKeys;
    if (keys.length === 0) {
      return jsonError(
        c,
        400,
        'NO_SETTING_KEYS',
        'No setting keys provided.',
        'Provide key or keys in query/body.'
      );
    }

    await settingsStore.deleteMany(keys);

    return c.json({
      success: true,
      settings: await settingsStore.getAll(),
    });
  };

  app.get('/api/settings', getSettingsHandler);
  app.put('/api/settings', setSettingsHandler);
  app.patch('/api/settings', setSettingsHandler);
  app.delete('/api/settings', deleteSettingsHandler);

  // Compatibility aliases
  app.get('/api/manage/settings', getSettingsHandler);
  app.post('/api/manage/settings', setSettingsHandler);

  app.get('/api/ui-config', async (c) => {
    const config = await readUiConfig();
    return c.json({
      success: true,
      config,
      source: 'file',
    });
  });

  app.post('/api/ui-config', async (c) => {
    const unauthorized = requireAuth(c);
    if (unauthorized) return unauthorized;

    const body = await c.req.json().catch(() => ({}));
    const config = await writeUiConfig(extractUiConfigPayload(body));

    return c.json({
      success: true,
      config,
      source: 'file',
    });
  });
}

module.exports = {
  registerSettingsRoutes,
};
