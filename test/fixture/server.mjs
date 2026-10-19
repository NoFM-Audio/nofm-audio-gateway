import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const audio = Buffer.from('RIFF-noFM-fixture-audio-for-range-tests');
const etag = '"nofm-fixture-v1"';
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const headers = { authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null, host: req.headers.host };
  if (path === '/cast/' || /^\/cast\/(index\.html|style\.css|player\.js|playback\.js)$/.test(path)) {
    res.end('NoFM fixture asset');
  } else if (/^\/cast\/api\/(status|time|player-config)$/.test(path)) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ...headers, url: req.url }));
  } else if (path === '/cast/audio/Show%2F%E9%9B%AA.wav') {
    res.setHeader('ETag', etag);
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
    if (req.headers.range === 'bytes=0-7') {
      res.writeHead(206, { 'Content-Range': `bytes 0-7/${audio.length}`, 'Content-Length': 8 });
      res.end(audio.subarray(0, 8));
    } else { res.setHeader('Content-Length', audio.length); res.end(audio); }
  } else {
    // Deliberately expose management routes here: the gateway must block them.
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ management: true, ...headers }));
  }
});
server.on('upgrade', (req, socket) => {
  if (req.url !== '/cast/ws' || req.headers.origin !== `https://${req.headers.host}`) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
  }
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const data = Buffer.from(JSON.stringify({ authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null }));
  socket.write(Buffer.concat([Buffer.from([0x81, data.length]), data]));
  socket.on('error', () => {});
});
server.listen(8090, '0.0.0.0');
