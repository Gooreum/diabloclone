import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 원작 데이터로 월드를 만드는 테스트는 전체를 한꺼번에 돌리면 느려진다 — 부하로 인한 시간 초과(가짜 실패)를 막는다
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
