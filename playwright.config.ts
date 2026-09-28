import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120000,
  use: { baseURL: 'http://localhost:5178', viewport: { width: 800, height: 600 } },
  webServer: { command: 'npx vite --port 5178 --strictPort', url: 'http://localhost:5178', reuseExistingServer: true },
});
