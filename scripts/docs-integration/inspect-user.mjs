// Copied into a temporary owned Website container by the orchestrator, never a new HTTP route.
const [action, value] = process.argv.slice(2)
try {
  if (!['health', 'inspect'].includes(action)) throw new Error()
  const response = await fetch(`http://127.0.0.1:${process.env.SERVER_PORT || '8080'}/api/${action === 'health' ? 'health' : 'internal/identity/user/inspect'}`, {
    ...(action === 'inspect' ? { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Bootstrap-Key': process.env.IDENTITY_BOOTSTRAP_KEY }, body: JSON.stringify({ userId: value }) } : {}),
    signal: AbortSignal.timeout(2000),
  })
  if (!response.ok || (action === 'inspect' && (await response.json()).id !== value)) throw new Error()
  console.log(action === 'health' ? 'TEMPORARY_WEBSITE_READY' : 'BOOTSTRAP_ACCOUNT_ACTIVE')
} catch { console.error('TEMPORARY_WEBSITE_CHECK_FAILED'); process.exitCode = 1 }
