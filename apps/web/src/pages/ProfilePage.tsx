import { useEffect, useState } from 'react'
import { Button, Spinner } from '@exre/exui'
import type { components } from '@workspace/api-client'
import { ProfileEditor, type ProfileTextValues } from '@workspace/components'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { readToken } from '../auth/storage'
import styles from './ProfilePage.module.scss'

type CurrentUser = components['schemas']['CurrentUser']
type AvatarMediaType = components['schemas']['UploadAvatarRequest']['mediaType']

export function ProfilePage() {
  const auth = useAuth()
  const [profile, setProfile] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (auth.state.status === 'anonymous') auth.openModal('login')
  }, [auth.state.status, auth.openModal])

  useEffect(() => {
    if (auth.state.status !== 'authenticated') {
      setProfile(null)
      return
    }
    let active = true
    setProfile(null)
    setLoading(true)
    setError(null)
    const load = async () => {
      let token: string | null = null
      try {
        token = requireToken()
        const result = await api.GET('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        if (result.error?.error.code === 'SESSION_INVALID') auth.invalidateSession(token)
        if (result.error !== undefined) throw new Error(result.error.error.message)
        if (active) {
          setProfile(result.data)
          setError(null)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取资料')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [auth.state.status, auth.invalidateSession, retry])

  async function save(values: Partial<ProfileTextValues>) {
    const token = requireToken()
    const result = await api.PATCH('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        nickname: values.nickname,
        qq: values.qq === undefined ? undefined : values.qq === '' ? null : values.qq,
        fivemId: values.fivemId === undefined ? undefined : values.fivemId === '' ? null : values.fivemId,
      },
    })
    if (result.error !== undefined) {
      if (result.error.error.code === 'SESSION_INVALID') auth.invalidateSession(token)
      throw new Error(result.error.error.message)
    }
    setProfile(result.data)
    await auth.refreshProfile()
  }

  async function upload(file: File) {
    const mediaType = avatarMediaType(file.type)
    if (file.size > 2 * 1024 * 1024) throw new Error('图片不得超过 2 MiB')
    const token = requireToken()
    const result = await api.POST('/auth/me/avatar', {
      headers: { Authorization: `Bearer ${token}` },
      body: { imageBase64: await toBase64(file), mediaType },
    })
    if (result.error !== undefined) {
      if (result.error.error.code === 'SESSION_INVALID') auth.invalidateSession(token)
      throw new Error(result.error.error.message)
    }
    setProfile(result.data)
    await auth.refreshProfile()
  }

  async function removeAvatar() {
    const token = requireToken()
    // openapi-fetch 的 Writable<T> 会把值仅为 null 的属性误判成 readOnly 并过滤；
    // body 本身仍由生成的 Contract 类型校验，调用时只绕过这一处过滤。
    const body: components['schemas']['UpdateCurrentUserRequest'] = { avatar: null }
    const result = await api.PATCH('/auth/me', {
      headers: { Authorization: `Bearer ${token}` }, body: body as never,
    })
    if (result.error !== undefined) {
      if (result.error.error.code === 'SESSION_INVALID') auth.invalidateSession(token)
      throw new Error(result.error.error.message)
    }
    setProfile(result.data)
    await auth.refreshProfile()
  }

  if (auth.state.status === 'anonymous') {
    return <main className={styles.page}><h1>个人资料</h1><p>登录后可以编辑资料。</p>
      <Button onClick={() => auth.openModal('login')}>登录</Button></main>
  }
  if (auth.state.status === 'loading') {
    return <main className={styles.page}><Spinner aria-label="正在读取登录状态" /></main>
  }
  if (auth.state.status === 'unavailable') {
    return <main className={styles.page}><h1>个人资料</h1><p role="alert">{auth.state.message}</p>
      <Button onClick={auth.retrySession}>重试</Button></main>
  }
  return <main className={styles.page}>
    <header className={styles.heading}>
      <h1>个人资料</h1>
      <p>管理用户名、QQ、FiveM ID 和头像。邮箱用于登录，不能在这里修改。</p>
    </header>
    {error && <p role="alert">{error}</p>}
    {profile === null ? loading ? <Spinner aria-label="正在读取个人资料" /> :
      <Button onClick={() => setRetry((value) => value + 1)}>重试读取资料</Button> : <ProfileEditor
      initial={{ nickname: profile.nickname, qq: profile.qq ?? '', fivemId: profile.fivemId ?? '' }}
      avatarUrl={profile.avatarUrl ?? null}
      onSave={save}
      onUpload={upload}
      onRemoveAvatar={removeAvatar}
    />}
  </main>
}

function requireToken(): string {
  const token = readToken(window.localStorage)
  if (token === null) throw new Error('登录已失效，请重新登录')
  return token
}

function avatarMediaType(value: string): AvatarMediaType {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value
  throw new Error('只支持 PNG、JPEG 或 WebP 图片')
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}
