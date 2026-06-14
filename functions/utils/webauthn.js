/**
 * WebAuthn / Passkey 工具模块(单管理员)
 * 使用 @simplewebauthn/server(同构,Pages Functions 可直接打包,无需 nodejs_compat)。
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';

export const WEBAUTHN_CREDENTIALS_KEY = 'webauthn_credentials';
export const CHALLENGE_KEY_REGISTER = 'webauthn_challenge:register';
export const CHALLENGE_KEY_AUTH = 'webauthn_challenge:auth';

const CHALLENGE_TTL_SECONDS = 300;
const RP_NAME_DEFAULT = "Seraph's Pictures";
// 单管理员:稳定的 user handle(与用户名解耦,改名不影响已注册 passkey)。
const ADMIN_USER_HANDLE = 'seraph-admin';

/**
 * 解析 rpID / origin / rpName。
 * 默认从请求 URL 推导(本地 localhost、线上规范域名各自生效);
 * 如需强制锁定规范域名,可设 env.WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN。
 */
export function getWebAuthnConfig(request, env = {}) {
  const url = new URL(request.url);
  return {
    rpID: env.WEBAUTHN_RP_ID || url.hostname,
    origin: env.WEBAUTHN_ORIGIN || url.origin,
    rpName: env.WEBAUTHN_RP_NAME || RP_NAME_DEFAULT,
  };
}

/**
 * 读取已注册 passkey 列表(KV)。返回 { items: [...] }。
 */
export async function readCredentials(env) {
  if (!env?.img_url) return { items: [] };
  try {
    const saved = await env.img_url.get(WEBAUTHN_CREDENTIALS_KEY, { type: 'json' });
    if (saved && Array.isArray(saved.items)) return { items: saved.items };
  } catch (e) {
    console.error('WebAuthn credentials read error:', e);
  }
  return { items: [] };
}

async function writeCredentials(env, items) {
  await env.img_url.put(WEBAUTHN_CREDENTIALS_KEY, JSON.stringify({ items }));
}

/**
 * 对外安全展示子集(绝不返回 publicKey)。
 */
export function publicCredentialList(items) {
  return items.map((c) => ({
    id: c.id,
    name: c.name || 'Passkey',
    createdAt: c.createdAt || null,
    lastUsedAt: c.lastUsedAt || null,
  }));
}

async function putChallenge(env, key, challenge, type) {
  await env.img_url.put(
    key,
    JSON.stringify({ challenge, type, createdAt: Date.now() }),
    { expirationTtl: CHALLENGE_TTL_SECONDS }
  );
}

async function takeChallenge(env, key) {
  const data = await env.img_url.get(key, { type: 'json' });
  if (data) await env.img_url.delete(key); // 一次性
  return data?.challenge || null;
}

/**
 * 注册:生成 options 并暂存 challenge。
 */
export async function buildRegistrationOptions(request, env, username) {
  const { rpID, rpName } = getWebAuthnConfig(request, env);
  const { items } = await readCredentials(env);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: username || 'admin',
    userID: isoUint8Array.fromUTF8String(ADMIN_USER_HANDLE),
    attestationType: 'none',
    excludeCredentials: items.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  await putChallenge(env, CHALLENGE_KEY_REGISTER, options.challenge, 'register');
  return options;
}

/**
 * 注册:校验浏览器返回并落库。返回 { verified, credential? }。
 */
export async function verifyAndStoreRegistration(request, env, response, name) {
  const { rpID, origin } = getWebAuthnConfig(request, env);
  const expectedChallenge = await takeChallenge(env, CHALLENGE_KEY_REGISTER);
  if (!expectedChallenge) return { verified: false, error: 'challenge 已过期，请重试' };

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false, error: '验证失败' };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const { items } = await readCredentials(env);

  // 去重:同一 credential id 覆盖
  const filtered = items.filter((c) => c.id !== credential.id);
  const record = {
    id: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter || 0,
    transports: credential.transports || response?.response?.transports || [],
    deviceType: credentialDeviceType,
    backedUp: !!credentialBackedUp,
    name: (name && String(name).trim()) || 'Passkey',
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  await writeCredentials(env, [...filtered, record]);

  return { verified: true, credential: { id: record.id, name: record.name } };
}

/**
 * 登录:生成 authentication options 并暂存 challenge。
 */
export async function buildAuthenticationOptions(request, env) {
  const { rpID } = getWebAuthnConfig(request, env);
  const { items } = await readCredentials(env);

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: items.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: 'preferred',
  });

  await putChallenge(env, CHALLENGE_KEY_AUTH, options.challenge, 'auth');
  return options;
}

/**
 * 登录:校验断言、更新 counter 防重放。返回 { verified }。
 */
export async function verifyAuthentication(request, env, response) {
  const { rpID, origin } = getWebAuthnConfig(request, env);
  const { items } = await readCredentials(env);

  const cred = items.find((c) => c.id === response?.id);
  if (!cred) return { verified: false, error: '未找到对应 passkey' };

  const expectedChallenge = await takeChallenge(env, CHALLENGE_KEY_AUTH);
  if (!expectedChallenge) return { verified: false, error: 'challenge 已过期，请重试' };

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: cred.id,
      publicKey: isoBase64URL.toBuffer(cred.publicKey),
      counter: cred.counter || 0,
      transports: cred.transports,
    },
  });

  if (!verification.verified) return { verified: false, error: '验证失败' };

  // 更新 counter(防重放)与最近使用时间
  const newCounter = verification.authenticationInfo.newCounter;
  const updated = items.map((c) =>
    c.id === cred.id ? { ...c, counter: newCounter, lastUsedAt: Date.now() } : c
  );
  await writeCredentials(env, updated);

  return { verified: true };
}

/**
 * 重命名 passkey。
 */
export async function renameCredential(env, id, name) {
  const { items } = await readCredentials(env);
  if (!items.some((c) => c.id === id)) return { ok: false, error: '未找到 passkey' };
  const updated = items.map((c) =>
    c.id === id ? { ...c, name: String(name || '').trim() || 'Passkey' } : c
  );
  await writeCredentials(env, updated);
  return { ok: true };
}

/**
 * 删除 passkey。
 */
export async function deleteCredential(env, id) {
  const { items } = await readCredentials(env);
  const updated = items.filter((c) => c.id !== id);
  if (updated.length === items.length) return { ok: false, error: '未找到 passkey' };
  await writeCredentials(env, updated);
  return { ok: true };
}
