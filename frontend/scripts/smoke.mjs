import assert from 'node:assert/strict';
import { preview } from 'vite';

// Serve only the built frontend on a temporary loopback port. No provider calls.
const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false } });
try {
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Margin/);
  const script = html.match(/src="([^"]+\.js)"/)[1];
  const stylesheet = html.match(/href="([^"]+\.css)"/)[1];
  for (const path of [script, stylesheet]) {
    const asset = await fetch(new URL(path, base));
    assert.equal(asset.status, 200);
    assert.ok((await asset.text()).length > 0);
  }
  console.log('Production HTTP smoke passed: HTML, JavaScript and CSS assets.');
} finally {
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
