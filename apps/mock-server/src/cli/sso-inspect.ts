import { createAppAuthService } from './support.js'
import { assertCliEntry } from '../db/client.js'

assertCliEntry(import.meta.url)

const ssoRequestId = process.argv[2]
if (ssoRequestId === undefined || !/^[A-Za-z0-9_-]{43}$/.test(ssoRequestId)) {
  console.error('用法：pnpm sso:inspect -- <ssoRequestId>')
  process.exitCode = 1
} else {
  const { authServices, close } = createAppAuthService()
  try {
    console.log(JSON.stringify(authServices.inspectSsoRequestForCli(ssoRequestId), null, 2))
  } finally {
    close()
  }
}
