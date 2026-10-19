import COS from 'cos-nodejs-sdk-v5'
import type { CosPutInput, CosTransport } from './types.js'

/** 与服务端一致的云操作截止时间。 */
const COS_TIMEOUT_MS = 120_000

/**
 * Node COS 传输：只用 PutObject，不调用 uploadFile 等可隐式分块的高级方法。
 * 显式提供 ContentLength，避免 SDK 对 Buffer 走流式上传。
 */
export const transport: CosTransport = {
  async putObject(input: CosPutInput): Promise<void> {
    const client = new COS({
      SecretId: input.credentials.tmpSecretId,
      SecretKey: input.credentials.tmpSecretKey,
      SecurityToken: input.credentials.securityToken,
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([
      client.putObject({
        Bucket: input.bucket,
        Region: input.region,
        Key: input.key,
        Body: Buffer.from(input.bytes),
        ContentLength: input.bytes.byteLength,
        ContentType: input.contentType,
        ContentDisposition: 'attachment',
        CacheControl: 'no-store',
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('COS PutObject timed out')
          error.name = 'TimeoutError'
          reject(error)
        }, COS_TIMEOUT_MS)
        timer.unref?.()
      }),
    ]) } finally { if (timer) clearTimeout(timer) }
  },
}
