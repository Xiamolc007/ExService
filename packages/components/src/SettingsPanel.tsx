import { useEffect, useId, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert, AlertDescription, Avatar, AvatarFallback, AvatarImage, Button, Dialog,
  DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldContent,
  FieldError, FieldLabel, Input, RadioGroup, RadioGroupItem, Spinner,
} from '@exre/exui'
import Cropper, { type Area, type MediaSize, type Size } from 'react-easy-crop'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { avatarSchema, fivemIdSchema, nicknameSchema, qqSchema } from './profileValidation'
import { cropAvatar, minimumAvatarZoom } from './avatarCrop'
import { ContentAreaState, SettingsContentSkeleton } from './ContentAreaState'
import styles from './SettingsPanel.module.scss'

export type SettingsCategory = 'general' | 'profile' | 'account'
export type SettingsTheme = 'light' | 'dark' | 'system'
export type SettingsField = 'nickname' | 'qq' | 'fivemId'

export interface SettingsPanelProps {
  category: SettingsCategory
  onCategoryChange: (category: SettingsCategory) => void
  theme: SettingsTheme
  onThemeChange: (theme: SettingsTheme) => void
  profile: { email: string; nickname: string; qq: string | null; fivemId: string | null; avatarUrl: string | null } | null
  profileStatus: 'idle' | 'loading' | 'ready' | 'error'
  profileError: string | null
  onRetry: () => void
  onSave: (field: SettingsField, value: string) => Promise<void>
  onUpload: (file: Blob) => Promise<void>
  onRemoveAvatar: () => Promise<void>
  onLogout: () => void
  logoutPending: boolean
  actionPending: boolean
  authMessage?: string
  onRetryAuth?: () => void
}

const categories: { value: SettingsCategory; label: string }[] = [
  { value: 'general', label: '通用' }, { value: 'profile', label: '个人资料' },
  { value: 'account', label: '账号' },
]

export function SettingsPanel(props: SettingsPanelProps) {
  const profile = props.profile
  return <div className={styles.panel}>
    <nav className={styles.navigation} aria-label="设置分类">
      {categories.map(({ value, label }) => <Button key={value} type="button"
        variant={props.category === value ? 'secondary' : 'ghost'}
        aria-current={props.category === value ? 'page' : undefined}
        onClick={() => props.onCategoryChange(value)}>{label}</Button>)}
    </nav>
    <div className={styles.content}>
      {props.category === 'general' ? <ContentAreaState status="ready">
        <h2>通用</h2><section className={styles.card} aria-label="外观">
          <h3>外观</h3><p>选择网站的显示主题。</p>
          <RadioGroup className={styles.themeOptions} aria-label="网站主题" value={props.theme}
            onValueChange={(value) => {
              if (value === 'light' || value === 'dark' || value === 'system') props.onThemeChange(value)
            }}>
            {([['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']] as const)
              .map(([value, label]) => <label className={styles.themeOption} key={value}>
                <RadioGroupItem value={value} />{label}</label>)}
          </RadioGroup>
        </section>
      </ContentAreaState> : props.profileStatus === 'ready' && profile ? <ContentAreaState status="ready">
        {props.authMessage && <Alert variant="destructive" role="alert">
          <AlertDescription>{props.authMessage}</AlertDescription>
          {props.onRetryAuth && <Button type="button" onClick={props.onRetryAuth}>重试登录状态</Button>}
        </Alert>}
        {props.category === 'profile' ? <ProfileContent {...props} profile={profile} /> :
          <AccountContent {...props} profile={profile} />}
      </ContentAreaState> : props.profileStatus === 'error' ? <ContentAreaState status="error"
        errorMessage={props.profileError ?? '无法读取设置资料'} onRetry={props.onRetry} /> :
        <ContentAreaState status="loading" skeleton={<SettingsContentSkeleton />} />}
    </div>
  </div>
}

type ReadyProps = SettingsPanelProps & { profile: NonNullable<SettingsPanelProps['profile']> }

function ProfileContent(props: ReadyProps) {
  const [editField, setEditField] = useState<SettingsField | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const editTrigger = useRef<HTMLButtonElement | null>(null)
  const cropTrigger = useRef<HTMLButtonElement | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const id = useId()
  const imageForm = useForm<{ image: FileList }>({ resolver: zodResolver(avatarSchema) })
  const selectImage = imageForm.handleSubmit(({ image }, event) => {
    cropTrigger.current = (event?.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLButtonElement | null
    setCropFile(image.item(0))
  })
  const closeEdit = () => { setEditField(null); requestAnimationFrame(() => editTrigger.current?.focus()) }
  const closeCrop = () => { setCropFile(null); imageForm.reset(); requestAnimationFrame(() => cropTrigger.current?.focus()) }

  return <>
    <h2>个人资料</h2><section className={styles.card} aria-label="公开资料">
      <h3>公开资料</h3>
      <div className={styles.avatarRow}>
        <Avatar className={styles.avatar}>
          {props.profile.avatarUrl && <AvatarImage src={props.profile.avatarUrl} alt="当前头像" />}
          <AvatarFallback>{Array.from(props.profile.nickname)[0] ?? '?'}</AvatarFallback>
        </Avatar>
        <form onSubmit={selectImage} noValidate className={styles.avatarForm}>
          <Field data-invalid={imageForm.formState.errors.image ? true : undefined}>
            <FieldContent><FieldLabel htmlFor={`${id}-image`}>头像图片</FieldLabel>
              <Input id={`${id}-image`} type="file" accept="image/png,image/jpeg,image/webp"
                {...imageForm.register('image')} aria-invalid={imageForm.formState.errors.image ? true : undefined} />
              {imageForm.formState.errors.image && <FieldError>{imageForm.formState.errors.image.message}</FieldError>}
            </FieldContent>
          </Field>
          <div className={styles.rowActions}>
            <Button type="submit" disabled={props.actionPending}>裁剪并上传</Button>
            {props.profile.avatarUrl && <Button type="button" variant="outline" disabled={props.actionPending || removing}
              onClick={() => { setRemoving(true); setRemoveError(null); void props.onRemoveAvatar()
                .catch((error: unknown) => setRemoveError(message(error, '移除头像失败')))
                .finally(() => setRemoving(false)) }}>移除头像</Button>}
          </div>
          {removeError && <p role="alert">{removeError}</p>}
        </form>
      </div>
      <SettingRow label="用户名" value={props.profile.nickname} onEdit={(trigger) => {
        editTrigger.current = trigger; setEditField('nickname') }} />
      <SettingRow label="QQ" value={props.profile.qq ?? '未设置'} onEdit={(trigger) => {
        editTrigger.current = trigger; setEditField('qq') }} />
    </section>
    {editField && <EditDialog field={editField}
      initial={props.profile[editField] ?? ''} onClose={closeEdit}
      onSave={props.onSave} disabled={props.actionPending || Boolean(props.authMessage)} />}
    {cropFile && <CropDialog file={cropFile} onClose={closeCrop}
      onUpload={props.onUpload} disabled={props.actionPending || Boolean(props.authMessage)} />}
  </>
}

function AccountContent(props: ReadyProps) {
  const [edit, setEdit] = useState(false)
  const editTrigger = useRef<HTMLButtonElement | null>(null)
  return <>
    <h2>账号</h2>
    <section className={styles.card} aria-label="登录信息"><h3>登录信息</h3>
      <div className={styles.row}><span>登录邮箱</span><strong>{props.profile.email}</strong></div>
      <p>当前不可修改登录邮箱。</p>
    </section>
    <section className={styles.card} aria-label="关联信息"><h3>关联信息</h3>
      <SettingRow label="FiveM ID" value={props.profile.fivemId ?? '未设置'} onEdit={(trigger) => {
        editTrigger.current = trigger; setEdit(true) }} />
      <p>未验证。此信息由用户手填，不用于身份认证、社区组归属或权限判断。</p>
    </section>
    <section className={styles.card} aria-label="会话"><h3>会话</h3>
      <Button type="button" variant="outline" disabled={props.logoutPending}
        onClick={props.onLogout}>{props.logoutPending ? <Spinner aria-hidden="true" /> : null}退出登录</Button>
    </section>
    {edit && <EditDialog field="fivemId" initial={props.profile.fivemId ?? ''}
      onClose={() => { setEdit(false); requestAnimationFrame(() => editTrigger.current?.focus()) }} onSave={props.onSave}
      disabled={props.actionPending || Boolean(props.authMessage)} />}
  </>
}

function SettingRow({ label, value, onEdit }: { label: string; value: string;
  onEdit: (trigger: HTMLButtonElement) => void }) {
  return <div className={styles.row}><div><span>{label}</span><strong>{value}</strong></div>
    <Button type="button" variant="outline" onClick={(event) => onEdit(event.currentTarget)}>
      编辑{label}</Button></div>
}

function EditDialog({ field, initial, onClose, onSave, disabled }: {
  field: SettingsField; initial: string; onClose: () => void
  onSave: SettingsPanelProps['onSave']; disabled: boolean
}) {
  const label = field === 'nickname' ? '用户名' : field === 'qq' ? 'QQ' : 'FiveM ID'
  const schema = z.object({ value: field === 'nickname' ? nicknameSchema : field === 'qq' ? qqSchema : fivemIdSchema })
  const form = useForm<{ value: string }>({ resolver: zodResolver(schema), defaultValues: { value: initial } })
  const id = useId()
  const submit = form.handleSubmit(async ({ value }) => {
    form.clearErrors('root.server')
    try { await onSave(field, value); onClose() }
    catch (error) { form.setError('root.server', { message: message(error, '保存失败') }) }
  })
  return <Dialog open onOpenChange={(open) => { if (!open && !form.formState.isSubmitting) onClose() }}>
    <DialogContent className={styles.editDialog}>
      <DialogHeader><DialogTitle>编辑{label}</DialogTitle>
        <DialogDescription>保存后更新你的设置资料。</DialogDescription></DialogHeader>
      <form onSubmit={submit} noValidate className={styles.editForm}>
        <Field data-invalid={form.formState.errors.value ? true : undefined}><FieldContent>
          <FieldLabel htmlFor={`${id}-value`}>{label}</FieldLabel>
          <Input id={`${id}-value`} {...form.register('value')}
            aria-invalid={form.formState.errors.value ? true : undefined} />
          {form.formState.errors.value && <FieldError>{form.formState.errors.value.message}</FieldError>}
        </FieldContent></Field>
        {form.formState.errors.root?.server && <p role="alert">{form.formState.errors.root.server.message}</p>}
        <div className={styles.rowActions}>
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={disabled || form.formState.isSubmitting}>保存</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}

function CropDialog({ file, onClose, onUpload, disabled }: {
  file: File; onClose: () => void; onUpload: (image: Blob) => Promise<void>; disabled: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [minZoom, setMinZoom] = useState(1)
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null)
  const [cropSize, setCropSize] = useState<Size | null>(null)
  const [area, setArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  useEffect(() => {
    if (!mediaSize || !cropSize) return
    const minimum = minimumAvatarZoom(mediaSize, cropSize)
    const maximum = Math.max(3, minimum * 3)
    setMinZoom(minimum)
    setZoom((current) => Math.min(Math.max(current, minimum), maximum))
  }, [mediaSize, cropSize])
  const save = async () => {
    if (!url || !area || saving) return
    setSaving(true); setError(null)
    try { await onUpload(await cropAvatar(url, area)); onClose() }
    catch (cause) { setError(message(cause, '头像上传失败')) }
    finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
    <DialogContent className={styles.cropDialog}>
      <DialogHeader><DialogTitle>裁剪头像</DialogTitle>
        <DialogDescription>拖动并缩放图片，预览最终正方形范围。</DialogDescription></DialogHeader>
      <div className={styles.cropArea}>{url && <Cropper image={url} crop={crop}
        zoom={zoom} minZoom={minZoom} maxZoom={Math.max(3, minZoom * 3)} aspect={1}
        onCropChange={setCrop} onZoomChange={setZoom}
        setMediaSize={setMediaSize} setCropSize={setCropSize}
        onCropComplete={(_, pixels) => setArea(pixels)} />}</div>
      <label htmlFor="avatar-zoom">缩放</label>
      <input className={styles.zoomSlider} type="range" id="avatar-zoom" min={minZoom}
        max={Math.max(3, minZoom * 3)} step={0.01} value={zoom}
        onChange={(event) => setZoom(Number(event.currentTarget.value))} />
      {error && <p role="alert">{error}</p>}
      <div className={styles.rowActions}>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>取消</Button>
        <Button type="button" onClick={() => void save()} disabled={!url || !area || disabled || saving}>
          {saving && <Spinner aria-hidden="true" />}确认并上传</Button>
      </div>
    </DialogContent>
  </Dialog>
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
