import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.env.GATEWAY_TEST_IMAGE || 'nofm-audio-gateway:local';
const fixtureImage = process.env.GATEWAY_FIXTURE_IMAGE || 'nofm-audio-gateway-fixture:local';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const credentials = { Authorization: 'Bearer integration-fixture-only', Cookie: 'admin=fixture-only' };

async function ready(base) {
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* Starting. */ }
    await delay(100);
  }
  throw new Error('Gateway did not start');
}

function websocket(base, origin = 'https://audio.example') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/cast/ws`, { headers: {
      ...credentials, Host: 'audio.example', Origin: origin, Connection: 'Upgrade',
      Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } });
    req.setTimeout(5000, () => req.destroy(new Error('Upgrade timed out')));
    req.on('error', reject);
    req.on('response', res => { res.resume(); resolve({ status: res.statusCode }); });
    req.on('upgrade', (res, socket, head) => {
      let bytes = head;
      const finish = () => {
        if (bytes.length < 2 || bytes.length < 2 + (bytes[1] & 127)) return;
        const payload = JSON.parse(bytes.subarray(2, 2 + (bytes[1] & 127)).toString());
        socket.destroy(); resolve({ status: res.statusCode, payload });
      };
      socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('No WebSocket data')); });
      socket.on('error', reject);
      socket.on('data', data => { bytes = Buffer.concat([bytes, data]); finish(); });
      finish();
    });
    req.end();
  });
}

test('built gateway image enforces the visitor boundary', { timeout: 180000 }, async t => {
  const id = `nofm-gateway-test-${process.pid}-${Date.now()}`;
  const origin = `${id}-origin`, gateway = `${id}-gateway`;
  t.after(() => {
    for (const name of [gateway, origin]) { try { docker('rm', '-f', name); } catch { /* Not created. */ } }
    try { docker('network', 'rm', id); } catch { /* Not created. */ }
  });
  docker('network', 'create', id);
  docker('run', '-d', '--rm', '--name', origin, '--network', id, fixtureImage);
  docker('run', '-d', '--rm', '--name', gateway, '--network', id, '-p', '127.0.0.1::8080',
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '-e', `NOFM_UPSTREAM=${origin}:8090`, image);
  const base = `http://${docker('port', gateway, '8080/tcp')}`;
  await ready(base);

  await t.test('runs without root or a writable image filesystem', () => {
    const config = JSON.parse(docker('inspect', gateway))[0];
    assert.equal(config.Config.User, '101:101');
    assert.equal(config.HostConfig.ReadonlyRootfs, true);
    assert.equal(docker('exec', gateway, 'id', '-u'), '101');
  });

  await t.test('serves health, redirects root, and allows only player assets', async () => {
    assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok\n');
    const root = await fetch(base, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/cast/');
    for (const asset of ['', 'index.html', 'style.css', 'player.js', 'playback.js']) {
      assert.equal((await fetch(`${base}/cast/${asset}`)).status, 200, asset);
    }
  });

  await t.test('preserves public headers and strips credentials', async () => {
    for (const route of ['status', 'time', 'player-config']) {
      const response = await fetch(`${base}/cast/api/${route}?fixture=1`, { headers: credentials });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.deepEqual(await response.json(), { authorization: null, cookie: null, host: new URL(base).host, url: `/cast/api/${route}?fixture=1` });
    }
  });

  await t.test('preserves encoded nested filenames, Range, HEAD and ETag', async () => {
    const path = `${base}/cast/audio/Show%2F%E9%9B%AA.wav`;
    const full = await fetch(path); assert.equal(full.status, 200);
    const audio = Buffer.from(await full.arrayBuffer());
    const range = await fetch(path, { headers: { Range: 'bytes=0-7' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 0-7/${audio.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), audio.subarray(0, 8));
    const head = await fetch(path, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(audio.length));
    assert.equal((await fetch(path, { headers: { 'If-None-Match': head.headers.get('etag') } })).status, 304);
  });

  await t.test('rejects management and unknown paths even with credentials', async () => {
    for (const path of ['/admin/', '/metrics', '/cast/api/files', '/cast/api/viewers', '/cast/api/admin/status', '/cast/api/source/release', '/cast%2fapi%2ffiles', '/cast/unknown.js', '/cast/audio/../api/files']) {
      assert.equal((await fetch(`${base}${path}`, { headers: credentials })).status, 404, path);
    }
  });

  await t.test('rejects mutation methods on allowed paths', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal((await fetch(`${base}/cast/api/status`, { method, headers: credentials })).status, 405, method);
    }
  });

  await t.test('forwards WebSocket messages and preserves Host/Origin without credentials', async () => {
    assert.deepEqual(await websocket(base), { status: 101, payload: { authorization: null, cookie: null } });
    assert.equal((await websocket(base, 'https://untrusted.example')).status, 403);
  });
});

test('invalid or missing upstream fails startup', { timeout: 180000 }, () => {
  for (const upstream of ['', 'https://audio.example:8090', 'audio.example:0', 'audio.example:65536', 'audio.example:8090;bad', 'audio.example:8090\nother:80']) {
    assert.throws(() => docker('run', '--rm', '-e', `NOFM_UPSTREAM=${upstream}`, image, 'nginx', '-t'), upstream);
  }
});
