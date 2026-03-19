import { chromium } from 'playwright'

async function main() {
  const timestamp = Date.now()
  const email = `login-repro-${timestamp}@example.com`
  const password = 'Test1234'

  const registerResp = await fetch('http://127.0.0.1:8000/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `user${timestamp}`,
      email,
      password,
    }),
  })

  const registerJson = await registerResp.json()
  console.log('REGISTER_STATUS', registerResp.status)
  console.log('REGISTER_JSON', JSON.stringify(registerJson))
  if (!registerResp.ok) return

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const consoleMessages = []
  const failedRequests = []

  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`))

  await page.goto('http://127.0.0.1:5173/login')
  await page.waitForLoadState('networkidle')

  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForTimeout(2500)

  const token = await page.evaluate(() => localStorage.getItem('access_token'))
  const refreshToken = await page.evaluate(() => localStorage.getItem('refresh_token'))
  const errorText = await page.locator('p.text-sm.text-\\[var\\(--color-danger\\)\\]').first().textContent().catch(() => '')

  console.log('FINAL_URL', page.url())
  console.log('ERROR_TEXT', errorText || '')
  console.log('HAS_ACCESS_TOKEN', Boolean(token))
  console.log('HAS_REFRESH_TOKEN', Boolean(refreshToken))
  console.log('FAILED_REQUESTS', JSON.stringify(failedRequests))
  console.log('CONSOLE_MESSAGES', JSON.stringify(consoleMessages))

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
