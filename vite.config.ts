import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {

  const env = loadEnv(mode, process.cwd(), '');

  return {

    base: '/pli-santosh/',

    plugins: [react()],

    define: {
      'process.env.API_KEY': JSON.stringify("AIzaSyAaOSp5Fptk3qhEjlsj5kUbZnfj-GQSYS0")
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
