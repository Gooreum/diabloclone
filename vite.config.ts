import { defineConfig, type Plugin } from 'vite';
import { appendFileSync, createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const GAME_DATA = resolve(import.meta.dirname, 'game-data');

// dev 서버에서 로컬 game-data/ 의 원작 MPQ를 /d2/<파일명> 으로 서빙한다 (저장소에는 포함하지 않음).
function serveGameData(): Plugin {
  return {
    name: 'serve-game-data',
    configureServer(server) {
      server.middlewares.use('/d2/', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0] ?? '');
        if (!name || name.includes('/') || name.includes('..') || !existsSync(GAME_DATA)) return next();
        const actual = readdirSync(GAME_DATA).find((f) => f.toLowerCase() === name.toLowerCase());
        if (!actual) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        const path = resolve(GAME_DATA, actual);
        const size = statSync(path).size;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        if (m) {
          const start = Number(m[1]);
          const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          if (start > end || start >= size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', String(end - start + 1));
          createReadStream(path, { start, end }).pipe(res);
          return;
        }
        res.setHeader('Content-Length', String(size));
        createReadStream(path).pipe(res);
      });
    },
  };
}

// dev 전용: 브라우저에서 난 오류를 로컬 로그 파일에 남긴다 (사용자가 콘솔을 복사하지 않아도 원인을 볼 수 있게)
export const CLIENT_LOG = resolve(tmpdir(), 'diabloclone-client-errors.log');
function clientErrorLog(): Plugin {
  return {
    name: 'client-error-log',
    configureServer(server) {
      server.middlewares.use('/__clientlog', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => {
          if (body.length < 20000) body += c.toString();
        });
        req.on('end', () => {
          appendFileSync(CLIENT_LOG, `${new Date().toISOString()} ${body}\n`);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [serveGameData(), clientErrorLog()],
  // 플레이 중에 코드가 바뀌어도 페이지를 자동으로 새로고침하지 않는다 (진행 중인 게임이 끊기지 않게 — 적용은 직접 F5)
  server: { hmr: false },
});
