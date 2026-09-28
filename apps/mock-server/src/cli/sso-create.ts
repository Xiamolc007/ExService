import { createAppAuthService } from '@server/src/cli/support.js'
import { assertCliEntry } from '@server/src/db/client.js'

assertCliEntry(import.meta.url)

const { authServices, close } = createAppAuthService()
try {
  const request = authServices.createSsoRequest()
  const url = `http://localhost:8081/login?ssoRequestId=${encodeURIComponent(request.ssoRequestId)}`
  console.log(JSON.stringify({ ...request, url }, null, 2))
} finally {
  close()
}
