import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'approval-mcp': resolve('src/main/approval-mcp.ts'),
          web: resolve('src/main/web.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
