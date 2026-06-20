const assert = require('assert');
const { loadConfig } = require('../server/lib/config');
const { AuthService } = require('../server/lib/utils/auth');

describe('Docker AUTH_DISABLED authentication switch', function () {
  it('requires auth by default even when Basic env credentials are absent', function () {
    const config = loadConfig({});
    const service = new AuthService(null, config);

    assert.strictEqual(service.isAuthRequired(), true);

    const result = service.checkAuthentication(new Request('http://localhost/api/manage/list'));
    assert.deepStrictEqual(result, { authenticated: false, reason: 'unauthorized' });
  });

  it('disables auth only when AUTH_DISABLED is explicitly true', function () {
    const config = loadConfig({ AUTH_DISABLED: 'true' });
    const service = new AuthService(null, config);

    assert.strictEqual(service.isAuthRequired(), false);

    const result = service.checkAuthentication(new Request('http://localhost/api/manage/list'));
    assert.strictEqual(result.authenticated, true);
    assert.strictEqual(result.reason, 'auth-disabled');
  });

  it('keeps Basic env credentials requiring auth', function () {
    const config = loadConfig({ BASIC_USER: 'admin', BASIC_PASS: 'secret' });
    const service = new AuthService(null, config);

    assert.strictEqual(service.isAuthRequired(), true);
  });
});
