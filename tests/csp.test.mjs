// GLB embedded texture URLs need both ImageBitmapLoader fetch and img fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../server.mjs';

test('static CSP permits local GLB object URLs without widening script sources', async () => {
  const server = buildServer({});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    const directives = Object.fromEntries(response.headers.get('content-security-policy')
      .split(';').map(part => part.trim().split(/\s+/)).map(([key, ...values]) => [key, values]));
    assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'blob:']);
    assert.deepEqual(directives['connect-src'], ["'self'", 'blob:']);
    assert.deepEqual(directives['script-src'], ["'self'"]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
