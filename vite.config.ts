import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages 프로젝트 페이지 경로: https://<user>.github.io/vacation_management/
export default defineConfig({
  base: '/vacation_management/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
