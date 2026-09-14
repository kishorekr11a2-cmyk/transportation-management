import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { exec } from 'child_process'
import fs from 'fs'

// Explicitly detect installed Google Chrome executable
const findChromePath = () => {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
  ];
  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }
  return 'chrome';
};

const openChromePlugin = () => {
  let opened = false;
  return {
    name: 'open-chrome-plugin',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        if (!opened) {
          opened = true;
          const chromeBin = findChromePath();
          const targetUrl = 'http://localhost:5173';
          exec(`start "" "${chromeBin}" "${targetUrl}"`, (err) => {
            if (err) {
              console.warn('[Chrome] Failed to open Chrome via shell:', err.message);
            } else {
              console.log(`[Chrome] Launched Google Chrome -> ${targetUrl}`);
            }
          });
        }
      });
    }
  };
};

export default defineConfig({
  plugins: [react(), openChromePlugin()],
  server: {
    port: 5173,
    host: true,
    open: false
  }
})