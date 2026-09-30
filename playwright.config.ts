import { defineConfig } from '@playwright/test';

// 작업 공간마다 다른 포트 (사용자 게임 5173·다른 worktree 와 겹치지 않게)
const PORT = Number(process.env.PW_PORT ?? 5188);

export default defineConfig({
  testDir: 'e2e',
  timeout: 300000,
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 800, height: 600 } },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true },
});
