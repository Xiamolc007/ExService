export type Medium = 'file' | 'cos'
export type UploadData = Blob | Uint8Array

export interface UploadOptions {
  medium?: Medium
  contentType?: string
}

export interface CosCredentials {
  tmpSecretId: string
  tmpSecretKey: string
  securityToken: string
  startTime: number
  expiredTime: number
}

export interface CosPutInput {
  bucket: string
  region: string
  key: string
  /** 已归一化的字节，单次调用快照。 */
  bytes: Uint8Array
  contentType: string
  credentials: CosCredentials
}

/** 环境相关的 COS 传输实现；浏览器与 Node 各自提供，共享逻辑不感知具体 SDK。 */
export interface CosTransport {
  putObject(input: CosPutInput): Promise<void>
}

export interface Storage { upload(key: string, data: UploadData, options?: UploadOptions): Promise<string> }
