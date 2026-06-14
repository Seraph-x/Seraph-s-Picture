/**
 * Passkey 注册:生成 options
 * POST /api/auth/passkey/register/options  (需登录)
 */
import { checkAuthentication, isAuthRequired, readAdminCredentials } from '../../../../utils/auth.js';
import { buildRegistrationOptions } from '../../../../utils/webauthn.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  try {
    if (!env.img_url) return json({ success: false, message: '未绑定 KV' }, 503);
    if (isAuthRequired(env)) {
      const auth = await checkAuthentication(context);
      if (!auth.authenticated) return json({ success: false, message: '需要登录' }, 401);
    }
    const cred = await readAdminCredentials(env);
    const options = await buildRegistrationOptions(context.request, env, cred.username);
    return json({ success: true, options });
  } catch (error) {
    console.error('Passkey register options error:', error);
    return json({ success: false, message: '生成注册选项失败' }, 500);
  }
}
