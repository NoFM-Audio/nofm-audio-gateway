import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 });
const image = process.env.NOFM_TEST_IMAGE;
if (!image) throw new Error('Set NOFM_TEST_IMAGE to an already-built NoFM server image');
const gatewayImage = process.env.GATEWAY_TEST_IMAGE || 'nofm-audio-gateway:local';
const token = 'gateway-integration-fixture-only';
const headers = { Authorization: `Bearer ${token}` };

function wav() {
  const data = Buffer.alloc(44 + 2048);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(44100, 24); data.writeUInt32LE(88200, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
async function ready(base) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Starting. */ }
    await delay(100);
  }
  throw new Error(`Service did not become ready: ${base}`);
}

test('visitor gateway allows playback and rejects all management access', { timeout: 300000 }, async (t) => {
  const id = `nofm-integration-${process.pid}-${Date.now()}`;
  const origin = `${id}-origin`, gateway = `${id}-gateway`;
  t.after(() => {
    for (const name of [gateway, origin]) { try { docker('rm', '-f', name); } catch { /* Already gone. */ } }
    try { docker('network', 'rm', id); } catch { /* Not created. */ }
  });
  docker('network', 'create', id);
  docker('run', '-d', '--rm', '--name', origin, '--network', id, '-p', '127.0.0.1::8090',
    '-e', `NOFM_AUDIO_FPP_TOKEN=${token}`, '-e', `NOFM_AUDIO_ADMIN_TOKEN=${token}`,
    '-e', 'NOFM_AUDIO_ENABLE_WEB_UI=true', '-p', '127.0.0.1::8091',
    '-e', 'NOFM_AUDIO_RETURN_URL=https://show.example/', '-e', 'NOFM_AUDIO_RETURN_LABEL=Back to show', image);
  const internal = `http://${docker('port', origin, '8090/tcp').trim()}`;
  await ready(`${internal}/readyz`);
  const privateAdmin = `http://${docker('port', origin, '8091/tcp').trim()}`;
  assert.equal((await fetch(`${privateAdmin}/admin/`)).status, 200);
  assert.equal((await fetch(`${privateAdmin}/cast/api/files`)).status, 401);
  assert.equal((await fetch(`${privateAdmin}/cast/api/files`, { headers })).status, 200);

  const audio = wav(), filename = 'Show/雪.wav';
  const body = new FormData(); body.append('filename', filename);
  body.append('file', new Blob([audio], { type: 'audio/wav' }), 'upload.wav');
  assert.equal((await fetch(`${internal}/cast/audio`, { method: 'POST', headers, body })).status, 201);

  docker('run', '-d', '--rm', '--name', gateway, '--network', id, '-p', '127.0.0.1::8080',
    '-e', `NOFM_UPSTREAM=${origin}:8090`, gatewayImage);
  const base = `http://${docker('port', gateway, '8080/tcp').trim()}`;
  await ready(`${base}/cast/`);
  assert.match(await (await fetch(`${base}/cast/`)).text(), /Listen to/);
  for (const asset of ['style.css', 'player.js', 'playback.js']) assert.equal((await fetch(`${base}/cast/${asset}`)).status, 200);
  for (const route of ['status', 'time', 'player-config']) {
    const response = await fetch(`${base}/cast/api/${route}`);
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    assert(!(await response.text()).includes(token));
  }
  const path = `${base}/cast/audio/${encodeURIComponent(filename)}`;
  const range = await fetch(path, { headers: { Range: 'bytes=0-15' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), audio.subarray(0, 16));
  const head = await fetch(path, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(audio.length));
  assert.equal((await fetch(path, { headers: { 'If-None-Match': head.headers.get('etag') } })).status, 304);

  for (const route of ['/admin/', '/metrics', '/cast/api/files', '/cast/api/viewers', '/cast/api/admin/status', '/cast/api/source/release', '/cast%2fapi%2ffiles']) {
    assert.equal((await fetch(`${base}${route}`, { headers })).status, 404, route);
  }
  for (const [method, route] of [['POST', '/cast/audio'], ['DELETE', `/cast/audio/${encodeURIComponent(filename)}`], ['POST', '/cast/api/source/release']]) {
    assert.equal((await fetch(`${base}${route}`, { method, headers })).status, 405, `${method} ${route}`);
  }
  // A query/body cannot turn a player endpoint into a mutation path.
  assert.equal((await fetch(`${base}/cast/api/player-config?action=delete`)).status, 200);
  assert.equal((await fetch(path)).status, 200);

  await new Promise((resolve, reject) => {
    const request = http.request(`${base}/cast/ws`, { headers: {
      Host: 'audio.example', Origin: 'https://audio.example', Connection: 'Upgrade',
      Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } });
    request.setTimeout(5000, () => request.destroy(new Error('WebSocket upgrade timed out')));
    request.on('error', reject);
    request.on('response', response => { response.resume(); reject(new Error(`Upgrade failed: ${response.statusCode}`)); });
    request.on('upgrade', (response, socket) => { socket.destroy(); assert.equal(response.statusCode, 101); resolve(); });
    request.end();
  });
});
