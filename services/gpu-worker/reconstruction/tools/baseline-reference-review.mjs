import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const [threeDirectory] = process.argv.slice(2);
if (!threeDirectory) throw Error('설치된 three 패키지 폴더를 지정한다');
const three = resolve(threeDirectory);
const html = await readFile(new URL('./baseline-reference-review.html', import.meta.url));
const server = createServer(async (request, response) => {
  const path = request.url;
  const module = /^\/three\/(build|examples\/jsm)\/[a-zA-Z0-9_./-]+\.js$/.test(path ?? '') &&
    !path.split('/').includes('..');
  if (request.method !== 'GET' || (path !== '/' && !module)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = module ? await readFile(resolve(three, path.slice('/three/'.length))) : html;
    response.writeHead(200, {
      'Content-Type': module ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' blob:; img-src blob: data:; base-uri 'none'; form-action 'none'",
      'Cache-Control': 'no-store',
    }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
