const assert = require('assert');

class MemoryKV {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  async get(key, options = {}) {
    const value = this.entries.get(String(key));
    if (options.type === 'json' && typeof value === 'string') {
      return JSON.parse(value);
    }
    return value ?? null;
  }
}

describe('AUTH_DISABLED authentication switch', function () {
  it('requires auth by default even when Basic env credentials are absent', async function () {
    const { isAuthRequired, checkAuthentication } = await import('../functions/utils/auth.js');
    const env = {};

    assert.strictEqual(isAuthRequired(env), true);

    const result = await checkAuthentication({
      request: new Request('https://vault.example/api/manage/list'),
      env,
    });

    assert.deepStrictEqual(result, { authenticated: false });
  });

  it('disables auth only when AUTH_DISABLED is explicitly true', async function () {
    const { isAuthRequired, checkAuthentication } = await import('../functions/utils/auth.js');
    const env = { AUTH_DISABLED: 'true' };

    assert.strictEqual(isAuthRequired(env), false);

    const result = await checkAuthentication({
      request: new Request('https://vault.example/api/manage/list'),
      env,
    });

    assert.strictEqual(result.authenticated, true);
    assert.strictEqual(result.reason, 'auth-disabled');
  });

  it('still requires auth when KV credentials exist without Basic env credentials', async function () {
    const { ADMIN_CREDENTIALS_KEY, isAuthRequired } = await import('../functions/utils/auth.js');
    const env = {
      img_url: new MemoryKV({
        [ADMIN_CREDENTIALS_KEY]: JSON.stringify({
          username: 'admin',
          passwordHash: 'hash',
          salt: 'salt',
          iterations: 100000,
        }),
      }),
    };

    assert.strictEqual(isAuthRequired(env), true);
  });

  it('keeps Basic env credentials requiring auth', async function () {
    const { isAuthRequired } = await import('../functions/utils/auth.js');

    assert.strictEqual(isAuthRequired({ BASIC_USER: 'admin', BASIC_PASS: 'secret' }), true);
  });
});
