import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// Calculate app version starting from 1.000 based on git commit count
function getAppVersion(): string {
  try {
    const output = execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const commitCount = parseInt(output, 10)
    if (!isNaN(commitCount)) {
      // Baseline commit count is 42 -> 1.000
      const buildNum = Math.max(0, commitCount - 42)
      return `1.${String(buildNum).padStart(3, '0')}`
    }
  } catch {
    // Fallback if git is not available in environment
  }
  return process.env.VITE_APP_VERSION || '1.000'
}

const appVersion = getAppVersion()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  server: {
    host: '127.0.0.1'
  }
})
