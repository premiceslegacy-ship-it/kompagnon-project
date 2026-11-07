import { defineConfig, devices } from '@playwright/test'
import { isLocalSupabaseUrl } from './tests/isolation/seed-safety'

const rawBaseUrl = process.env.E2E_BASE_URL
if (!rawBaseUrl || !isLocalSupabaseUrl(rawBaseUrl)) {
  throw new Error('E2E_BASE_URL must be supplied as an explicit loopback URL.')
}
const baseUrl = new URL(rawBaseUrl)
if (baseUrl.protocol !== 'http:' || !baseUrl.port || Number(baseUrl.port) === 0 || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
  throw new Error('E2E_BASE_URL must be a loopback HTTP origin with an explicit nonzero port.')
}

const emailSinkUrl = new URL(process.env.E2E_EMAIL_SINK_URL ?? 'http://127.0.0.1:43127/v1')
if (
  !isLocalSupabaseUrl(emailSinkUrl.toString())
  || emailSinkUrl.protocol !== 'http:'
  || !emailSinkUrl.port
  || Number(emailSinkUrl.port) === 0
  || emailSinkUrl.pathname !== '/v1'
  || emailSinkUrl.search
  || emailSinkUrl.hash
) {
  throw new Error('E2E_EMAIL_SINK_URL must be a loopback HTTP URL ending in /v1.')
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: `test-results/e2e-qualification-${process.pid}-${Date.now()}`,
  timeout: 90_000,
  use: {
    baseURL: baseUrl.origin,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `${JSON.stringify(process.execPath)} ./scripts/e2e-qualification-server.mjs`,
    url: baseUrl.origin,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      E2E_BASE_URL: baseUrl.origin,
      E2E_EMAIL_SINK_URL: emailSinkUrl.toString().replace(/\/$/, ''),
      E2E_QUALIFICATION: '',
      NODE_OPTIONS: '',
      RESEND_API_KEY: '',
    },
  },
})
