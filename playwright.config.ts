import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 300000,
  use: { baseURL: 'http://localhost:5188', viewport: { width: 800, height: 600 } },
  webServer: { command: 'npx vite --port 5188 --strictPort', url: 'http://localhost:5188', reuseExistingServer: true },
});
