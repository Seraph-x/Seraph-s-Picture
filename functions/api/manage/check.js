import { isAuthRequired } from '../../utils/auth.js';

export async function onRequest(context) {
  return new Response(isAuthRequired(context.env) ? 'true' : 'Not using basic auth.', { status: 200 });
}
