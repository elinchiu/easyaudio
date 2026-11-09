import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    base: '/easyaudio/',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.jpeg'],
        manifest: {
          // base 是 /easyaudio/，所以 id、start_url、scope 都要跟著改，
          // 否則安裝成 PWA 後會開到網站根目錄（404）。
          id: '/easyaudio/',
          name: 'Easy Audio - 播放音檔不卡卡',
          short_name: 'Easy Audio',
          description: '取代 Google Drive 音檔播放器的好工具',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/easyaudio/',
          scope: '/easyaudio/',
          icons: [
            {
              src: 'icon.jpeg',
              sizes: '192x192',
              type: 'image/jpeg',
              purpose: 'any',
            },
            {
              src: 'icon.jpeg',
              sizes: '512x512',
              type: 'image/jpeg',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // Whisper worker 打包後可能超過 2MB（Workbox 預設上限），
          // 超過的話不會被預先快取，所以維持較大的上限。
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
        devOptions: {
          // 開發模式下的 Service Worker 可能攔截 / 快取舊的 Worker 腳本，
          // 造成「Whisper Worker 載入失敗」難以除錯，所以開發時先關掉。
          // 要測試 PWA 時請用 `npm run build && npm run preview`。
          enabled: false,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Worker 使用 `new Worker(url, { type: 'module' })`，
    // 打包格式必須是 ES module，預設的 iife 會讓 worker 載入失敗。
    worker: {
      format: 'es' as const,
    },
    // transformers.js 內含 onnxruntime-web 等需要自己處理 WASM 的套件，
    // 不要讓 Vite 預先打包（pre-bundle），否則 worker 內會初始化失敗。
    optimizeDeps: {
      exclude: ['@xenova/transformers'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});