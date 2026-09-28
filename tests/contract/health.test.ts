import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp, serviceHandlers } from '@workspace/mock-server'
import { createTestAuth } from '@tests/helpers/auth'
import Ajv, { type ValidateFunction } from 'ajv'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Contract 是 schema 的唯一来源：这里直接读取 `api/openapi.yaml`，
 * 而不是在测试中手写或复制响应结构。
 */
const contractPath = resolve(projectRoot, 'api/openapi.yaml')

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

interface ContractDocument {
  paths: Record<string, Record<string, unknown>>
  schemas: Record<string, unknown>
}

/** 解析结果没有类型保证，因此逐步校验结构，让 Contract 结构漂移以明确报错暴露，而不是静默变成 undefined。 */
function readContract(): ContractDocument {
  const parsed: unknown = parseYaml(readFileSync(contractPath, 'utf8'))

  const paths = (parsed as { paths?: unknown } | null)?.paths
  const components = (parsed as { components?: unknown } | null)?.components
  const schemas = (components as { schemas?: unknown } | null)?.schemas

  if (typeof paths !== 'object' || paths === null) {
    throw new Error(`api/openapi.yaml 缺少 paths（Contract 结构已变更）: ${contractPath}`)
  }

  if (typeof schemas !== 'object' || schemas === null) {
    throw new Error(`api/openapi.yaml 缺少 components.schemas（Contract 结构已变更）: ${contractPath}`)
  }

  return {
    paths: paths as Record<string, Record<string, unknown>>,
    schemas: schemas as Record<string, unknown>,
  }
}

const contract = readContract()

/**
 * 列出 Contract 声明的全部 operation。
 *
 * 只有 operationId 才能被 Glue 映射到 handler；漏注册时该路由会在运行时返回 500，
 * 而其他路由与全部断言仍然通过，所以这层漂移必须由测试主动检查。
 */
function listContractOperations(): Array<{ operationId: string; location: string }> {
  const operations: Array<{ operationId: string; location: string }> = []

  for (const [path, pathItem] of Object.entries(contract.paths)) {
    if (typeof pathItem !== 'object' || pathItem === null) {
      continue
    }

    // `$ref` path item 无法在这里枚举 operation；宁可失败，也不要静默跳过导致覆盖检查失效。
    if ('$ref' in pathItem) {
      throw new Error(`Contract path ${path} 使用 $ref path item，listContractOperations 无法枚举，请改为内联定义`)
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue
      }

      const operationId = (operation as { operationId?: unknown } | null)?.operationId

      if (typeof operationId !== 'string' || operationId.length === 0) {
        throw new Error(`Contract operation ${method.toUpperCase()} ${path} 缺少 operationId`)
      }

      operations.push({ operationId, location: `${method.toUpperCase()} ${path}` })
    }
  }

  return operations
}

/**
 * 把 Contract 的 `components.schemas` 转成自包含的 Draft-07 definitions，
 * 以便用与 Fastify 默认 Ajv 一致的语义校验响应。
 */
function toDraft07Definitions(schemas: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(schemas).replaceAll('#/components/schemas/', '#/definitions/'),
  ) as Record<string, unknown>
}

const definitions = toDraft07Definitions(contract.schemas)

function compileComponentSchema(name: string): ValidateFunction {
  const schema = definitions[name]

  if (typeof schema !== 'object' || schema === null) {
    throw new Error(`api/openapi.yaml 缺少 components.schemas.${name}`)
  }

  const ajv = new Ajv({ allErrors: true, strict: false })

  return ajv.compile({ ...(schema as Record<string, unknown>), definitions })
}

const validateHealthResponse = compileComponentSchema('HealthResponse')
const validateErrorEnvelope = compileComponentSchema('ErrorEnvelope')

const runningApps: Array<ReturnType<typeof createApp>> = []
const authFixtures: Array<ReturnType<typeof createTestAuth>> = []

function createTestApp() {
  const fixture = createTestAuth()
  authFixtures.push(fixture)
  const app = createApp({ joinServices: fixture.joinServices, invitationServices: fixture.invitationServices, authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
  runningApps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.close()))
  authFixtures.splice(0).forEach((fixture) => fixture.close())
})

describe('contract coverage', () => {
  it('registers a handler for every operation declared in the contract', () => {
    const operations = listContractOperations()

    expect(operations.length).toBeGreaterThan(0)

    const registered = new Set(Object.keys(serviceHandlers))
    const unregistered = operations
      .filter((operation) => !registered.has(operation.operationId))
      .map((operation) => `${operation.operationId} (${operation.location})`)

    expect(unregistered).toEqual([])
  })

  it('registers no handler that the contract does not declare', () => {
    const declared = new Set(listContractOperations().map((operation) => operation.operationId))
    const undeclared = Object.keys(serviceHandlers).filter((operationId) => !declared.has(operationId))

    expect(undeclared).toEqual([])
  })
})

describe('GET /api/health over HTTP', () => {
  it('returns 200 with a JSON body that satisfies HealthResponse', async () => {
    const app = createTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/^application\/json/)

    const body: unknown = response.json()
    expect(validateHealthResponse(body)).toBe(true)
    expect(body).toEqual({ status: 'ok' })
  })

  it('returns no fields beyond the ones declared by the contract', async () => {
    const app = createTestApp()

    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json() as Record<string, unknown>

    expect(Object.keys(body)).toEqual(['status'])
  })

  it('registers the contract path under the explicit /api prefix', async () => {
    const app = createTestApp()

    // Contract 中路径写作 /health；缺少 prefix 时这里会得到 404。
    const unprefixed = await app.inject({ method: 'GET', url: '/health' })

    expect(unprefixed.statusCode).toBe(404)
  })
})

/**
 * 这一组是必需的，不能只靠上面的 HTTP 断言。
 *
 * Fastify 会用 Contract 的 response schema 序列化响应：未声明的字段被静默丢弃，
 * `const` 声明被强制写入。实测 handler 返回 `{status:'ok',secret:'x'}`、`{status:'down'}`
 * 或 `{status:42}` 时，线上响应都仍然是 `{"status":"ok"}`。
 * 因此 handler 的回归只能通过直接校验它注册在 `serviceHandlers` 中的原始返回值来发现。
 */
describe('registered handler output', () => {
  it('satisfies HealthResponse before serialization', async () => {
    const result = await serviceHandlers.getHealth()

    expect(validateHealthResponse(result)).toBe(true)
    expect(result).toEqual({ status: 'ok' })
  })

  it('exposes only the fields declared by the contract', async () => {
    const result = await serviceHandlers.getHealth()

    expect(Object.keys(result)).toEqual(['status'])
  })
})

describe('contract schema enforcement', () => {
  it('rejects a response body that carries an undeclared field', () => {
    expect(validateHealthResponse({ status: 'ok', uptime: 1 })).toBe(false)
  })

  it('rejects a response body that is missing a required field', () => {
    expect(validateHealthResponse({})).toBe(false)
  })

  it('rejects a response body whose value violates the contract constant', () => {
    expect(validateHealthResponse({ status: 'down' })).toBe(false)
  })

  it('rejects a response body whose value has the wrong type', () => {
    expect(validateHealthResponse({ status: 42 })).toBe(false)
  })
})

describe('undeclared routes', () => {
  it('returns the contract ErrorEnvelope', async () => {
    const app = createTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/not-in-contract' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toMatch(/^application\/json/)
    expect(validateErrorEnvelope(response.json())).toBe(true)
  })

  it('does not leak internal details', async () => {
    const app = createTestApp()

    const body = (await app.inject({ method: 'GET', url: '/api/not-in-contract' })).json() as {
      error: { message: string; requestId: string }
    }

    expect(body.error.requestId).toBeTruthy()
    expect(body.error.message).not.toContain(projectRoot)
    expect(body.error.message).not.toMatch(/mock\.sqlite|node_modules|\bat\s+\S+\s+\(/i)
  })
})
