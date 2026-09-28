import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
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

export default defineConfig({
  plugins: [serveGameData()],
});
