import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import selfsigned from 'selfsigned';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serve(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function generateSelfSignedCert() {
  const sslDir = path.join(__dirname, 'ssl');
  const keyPath = path.join(sslDir, 'key.pem');
  const certPath = path.join(sslDir, 'cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  try {
    fs.mkdirSync(sslDir, { recursive: true });
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'localhost' }],
      { keySize: 2048, days: 365 }
    );
    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
    return { key: pems.private, cert: pems.cert };
  } catch (err) {
    console.error('SSL 证书生成失败:', err.message);
    return null;
  }
}

const sslOptions = await generateSelfSignedCert();
const proto = sslOptions ? 'https' : 'http';
const server = sslOptions
  ? https.createServer(sslOptions, serve)
  : http.createServer(serve);

server.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  console.log('=== AI LED Web Flasher ===');
  console.log(`本机访问: ${proto}://localhost:${PORT}/`);
  for (const ip of ips) {
    console.log(`局域网访问: ${proto}://${ip}:${PORT}/`);
  }
  if (proto === 'https') {
    console.log('\n注意: 浏览器会提示证书不安全，点击 "高级" → "继续访问" 即可');
  } else {
    console.log('\nHTTP 模式 - Web Serial API 仅在 localhost 下可用');
  }
});
