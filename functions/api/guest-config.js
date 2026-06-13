import { checkAuthentication, isAuthRequired } from '../utils/auth.js';
import { apiError, apiSuccess } from '../utils/api-v1.js';

const GUEST_CONFIG_KEY = 'guest_config';
const KV_BINDING_CANDIDATES = ['img_url', 'KV', 'UI_CONFIG_KV'];

// Telegram native single-file ceiling for guest uploads; backend can only lower it.
const MAX_GUEST_FILE_BYTES = 20 * 1024 * 1024;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3;
const MAX_DAILY_LIMIT = 1000;

const DEFAULT_GUEST_CONFIG = {
  version: 1,
  enabled: false,
  retentionDays: MAX_RETENTION_DAYS,
  dailyLimit: 10,
  maxFileSize: 5 * 1024 * 1024,
};

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function parseBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'disabled', 'disable'].includes(text)) return false;
  return fallback;
}

function normalizeGuestConfig(raw) {
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = { ...DEFAULT_GUEST_CONFIG, ...base };
  return {
    version: 1,
    enabled: parseBooleanFlag(next.enabled, DEFAULT_GUEST_CONFIG.enabled),
    retentionDays: Math.round(clampNumber(next.retentionDays, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)),
    dailyLimit: Math.round(clampNumber(next.dailyLimit, 0, MAX_DAILY_LIMIT)),
    maxFileSize: Math.round(clampNumber(next.maxFileSize, 0, MAX_GUEST_FILE_BYTES)),
  };
}

// Environment variables only seed the first read; once written, KV is authoritative.
function getEnvGuestDefaults(env = {}) {
  const seed = { ...DEFAULT_GUEST_CONFIG };
  if (env.GUEST_UPLOAD != null) {
    seed.enabled = parseBooleanFlag(env.GUEST_UPLOAD, seed.enabled);
  }
  const envMax = parseInt(env.GUEST_MAX_FILE_SIZE, 10);
  if (Number.isFinite(envMax) && envMax > 0) seed.maxFileSize = envMax;
  const envDaily = parseInt(env.GUEST_DAILY_LIMIT, 10);
  if (Number.isFinite(envDaily) && envDaily >= 0) seed.dailyLimit = envDaily;
  const envRetention = parseInt(env.GUEST_RETENTION_DAYS, 10);
  if (Number.isFinite(envRetention) && envRetention > 0) seed.retentionDays = envRetention;
  return normalizeGuestConfig(seed);
}

function extractGuestConfigPayload(body = {}) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.config && typeof body.config === 'object' && !Array.isArray(body.config)) {
      return body.config;
    }
    if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
      return body.settings;
    }
    return body;
  }
  return {};
}

function resolveKvBinding(env = {}) {
  for (const name of KV_BINDING_CANDIDATES) {
    const candidate = env?.[name];
    if (candidate && typeof candidate.get === 'function' && typeof candidate.put === 'function') {
      return { name, binding: candidate };
    }
  }
  return null;
}

function missingKvBindingResponse() {
  return apiError(
    'KV_BINDING_MISSING',
    '未检测到可用的 KV 命名空间绑定，请在 Cloudflare Pages -> Settings -> Functions -> KV namespace bindings 中绑定并重新部署。',
    500,
    { expectedBindings: KV_BINDING_CANDIDATES }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet(context) {
  const kv = resolveKvBinding(context.env);
  if (!kv) {
    console.error('[guest-config] KV binding missing. Expected one of:', KV_BINDING_CANDIDATES.join(', '));
    return missingKvBindingResponse();
  }

  let saved = null;
  try {
    saved = await kv.binding.get(GUEST_CONFIG_KEY, { type: 'json' });
  } catch (error) {
    console.error('[guest-config] Failed to read config from KV:', {
      binding: kv.name,
      error: error?.message || String(error),
    });
    return apiError(
      'KV_READ_FAILED',
      '读取访客上传配置失败，请检查 KV 绑定与 Functions 日志。',
      500,
      { binding: kv.name, detail: error?.message || String(error) }
    );
  }

  const config = saved ? normalizeGuestConfig(saved) : getEnvGuestDefaults(context.env);
  return apiSuccess({
    config,
    source: saved ? 'kv' : 'default',
    binding: kv.name,
  });
}

export async function onRequestPost(context) {
  const kv = resolveKvBinding(context.env);
  if (!kv) {
    console.error('[guest-config] KV binding missing. Expected one of:', KV_BINDING_CANDIDATES.join(', '));
    return missingKvBindingResponse();
  }

  if (isAuthRequired(context.env)) {
    const auth = await checkAuthentication(context);
    if (!auth.authenticated) {
      console.warn('[guest-config] Unauthorized write attempt blocked.');
      return apiError('UNAUTHORIZED', '需要先登录管理员账号。', 401);
    }
  }

  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const config = normalizeGuestConfig(extractGuestConfigPayload(body));
  try {
    await kv.binding.put(GUEST_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('[guest-config] Failed to write config to KV:', {
      binding: kv.name,
      error: error?.message || String(error),
    });
    return apiError(
      'KV_WRITE_FAILED',
      '保存访客上传配置失败，请检查 KV 绑定权限与 Functions 日志。',
      500,
      { binding: kv.name, detail: error?.message || String(error) }
    );
  }

  return apiSuccess({
    config,
    source: 'kv',
    binding: kv.name,
  });
}
