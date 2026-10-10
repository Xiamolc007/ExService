import { performance } from 'node:perf_hooks'

/** Redacts even short and percent-encoded secrets; never prints raw connection URLs or SQL. */
export function redact(value, environment = {}) {
  let text = String(value).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  const secrets = new Set()
  for (const [key, value] of Object.entries(environment)) {
    if (!value) continue
    if (/(?:PASSWORD|SECRET|TOKEN|KEY|DSN|DATABASE_URL|REDIS_URL|OUTBOX_TARGETS_JSON)/i.test(key)) {
      secrets.add(value)
      secrets.add(encodeURIComponent(value))
      try {
        const url = new URL(value)
        if (url.password) {
          secrets.add(url.password)
          secrets.add(decodeURIComponent(url.password))
        }
      } catch {}
      if (key === 'IDENTITY_OUTBOX_TARGETS_JSON') {
        try {
          for (const target of Object.values(JSON.parse(value))) {
            if (target.deliveryKey) { secrets.add(target.deliveryKey); secrets.add(encodeURIComponent(target.deliveryKey)) }
          }
        } catch {}
      }
    }
  }
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[已隐藏]')
  return text.replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/(?:postgres(?:ql)?|rediss?):\/\/[^\s'"<>]+/gi, '[连接串已隐藏]')
    .replace(/\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER|CREATE|DROP|TRUNCATE)\b[^\r\n]*/gi, '[SQL 已隐藏]')
}

export class RuntimeError extends Error {
  constructor(code, { service = '运行配置', phase = '校验', keys = [], target = '', next = '检查 docs/runtime.md' } = {}) {
    super(`${service} · ${phase} · ${code}${target ? ` · ${target}` : ''}${keys.length ? ` · 配置键 ${keys.join(', ')}` : ''}；下一步：${next}`)
    this.code = code
  }
}

/** Keeps failure classification separate from database readiness checks. */
export function diagnostic(error, context) {
  if (error instanceof RuntimeError) return error
  const nested = error?.cause?.code ?? error?.errors?.[0]?.code
  const code = error?.code ?? nested
  const reasons = { ECONNREFUSED: '连接被拒绝', ENOTFOUND: 'DNS 解析失败', EAI_AGAIN: 'DNS 暂时不可用',
    ETIMEDOUT: '连接超时', ECONNRESET: '连接中断', '28P01': '密码错误', '28000': '认证失败',
    '3D000': '数据库不存在', '42P01': 'migration 或必需表缺失', '42703': 'migration 或必需列缺失' }
  return new RuntimeError(`${code ?? 'CHECK_FAILED'} (${reasons[code] ?? '检查失败'})`, context)
}

/** Plain text is stable in CI, redirected output and NO_COLOR. */
export function reporter({ environment = {}, verbose = false, write = line => console.log(line) } = {}) {
  const log = (service, line, level = '信息') => write(`${new Date().toISOString()} [${level}] [${service}] ${redact(line, environment)}`)
  return { log, title: value => write(redact(value, environment)),
    async stage(service, execute) {
      const start = performance.now(), lines = []
      log(service, '开始')
      try {
        const result = await execute((name, line, channel) => {
          const safe = redact(line, environment)
          if (verbose || channel === 'stderr' || /warn|error|警告|错误|deprecated/i.test(safe)) log(name, safe)
          lines.push(`[${name}] ${safe}`)
          if (lines.length > 300) lines.shift()
        })
        log(service, `完成 (${((performance.now() - start) / 1000).toFixed(1)} 秒)`)
        return result
      } catch (error) {
        lines.forEach(line => write(line))
        log(service, error instanceof RuntimeError ? error.message : '阶段失败；检查上方日志', '错误')
        throw error
      }
    },
  }
}
