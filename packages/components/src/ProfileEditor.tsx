import { useEffect, useId } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, AlertDescription, Avatar, AvatarFallback, AvatarImage, Button, Field, FieldContent,
  FieldError, FieldGroup, FieldLabel, Input, Spinner } from '@exre/exui'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import styles from './ProfileEditor.module.scss'

const textSchema = z.object({
  nickname: z.string().trim().refine((value) => Array.from(value).length >= 1 &&
    Array.from(value).length <= 32 && !/[\u0000-\u001F\u007F-\u009F]/u.test(value), '用户名须为 1 至 32 个有效字符'),
  qq: z.string().refine((value) => value === '' || /^[0-9]{1,20}$/.test(value), 'QQ 须为 1 至 20 位数字'),
  fivemId: z.string().refine((value) => value === '' ||
    (value.length <= 64 && /^fivem:[0-9]+$/.test(value)), 'FiveM ID 须为 fivem:数字ID'),
})

const avatarSchema = z.object({
  image: z.custom<FileList>((value) => typeof value === 'object' && value !== null &&
    'length' in value && value.length === 1 && 'item' in value && typeof value.item === 'function' &&
    value.item(0) instanceof File && value.item(0)!.size <= 2 * 1024 * 1024 &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(value.item(0)!.type),
  '请选择不超过 2 MiB 的 PNG、JPEG 或 WebP 图片'),
})

export type ProfileTextValues = z.infer<typeof textSchema>

export interface ProfileEditorProps {
  initial: ProfileTextValues
  avatarUrl: string | null
  onSave: (values: Partial<ProfileTextValues>) => Promise<void>
  onUpload: (file: File) => Promise<void>
  onRemoveAvatar: () => Promise<void>
}

export function ProfileEditor({ initial, avatarUrl, onSave, onUpload, onRemoveAvatar }: ProfileEditorProps) {
  const id = useId()
  const textForm = useForm<ProfileTextValues>({ resolver: zodResolver(textSchema), defaultValues: initial })
  const imageForm = useForm<z.infer<typeof avatarSchema>>({ resolver: zodResolver(avatarSchema) })
  const { dirtyFields } = textForm.formState

  useEffect(() => {
    textForm.reset(initial)
  }, [initial.nickname, initial.qq, initial.fivemId, textForm.reset])

  const save = textForm.handleSubmit(async (values) => {
    textForm.clearErrors('root.server')
    try {
      const changed = Object.fromEntries(
        (Object.keys(values) as Array<keyof ProfileTextValues>)
          .filter((field) => dirtyFields[field])
          .map((field) => [field, values[field]]),
      ) as Partial<ProfileTextValues>
      if (Object.keys(changed).length > 0) await onSave(changed)
    } catch (error) {
      textForm.setError('root.server', { type: 'server', message: error instanceof Error ? error.message : '保存失败' })
    }
  })
  const upload = imageForm.handleSubmit(async ({ image }) => {
    imageForm.clearErrors('root.server')
    try {
      await onUpload(image.item(0)!)
      imageForm.reset()
    } catch (error) {
      imageForm.setError('root.server', { type: 'server', message: error instanceof Error ? error.message : '上传失败' })
    }
  })

  return (
    <div className={styles.editor}>
      <section className={styles.avatarSection} aria-label="头像设置">
        <Avatar className={styles.avatar}>
          {avatarUrl && <AvatarImage src={avatarUrl} alt="当前头像" />}
          <AvatarFallback>{Array.from(initial.nickname)[0] ?? '?'}</AvatarFallback>
        </Avatar>
        <form onSubmit={upload} noValidate>
          <Field data-invalid={imageForm.formState.errors.image ? true : undefined}>
            <FieldContent>
              <FieldLabel htmlFor={`${id}-avatar`}>上传头像</FieldLabel>
              <Input id={`${id}-avatar`} type="file" accept="image/png,image/jpeg,image/webp"
                {...imageForm.register('image')} aria-invalid={imageForm.formState.errors.image ? true : undefined} />
              {imageForm.formState.errors.image && <FieldError>{imageForm.formState.errors.image.message}</FieldError>}
            </FieldContent>
          </Field>
          {imageForm.formState.errors.root?.server && <Alert variant="destructive" role="alert">
            <AlertDescription>{imageForm.formState.errors.root.server.message}</AlertDescription>
          </Alert>}
          <div className={styles.actions}>
            <Button type="submit" disabled={imageForm.formState.isSubmitting}>
              {imageForm.formState.isSubmitting && <Spinner aria-hidden="true" />}上传图片
            </Button>
            {avatarUrl && <Button type="button" variant="outline" onClick={() => {
              void onRemoveAvatar().catch((error: unknown) => {
                imageForm.setError('root.server', {
                  type: 'server', message: error instanceof Error ? error.message : '移除失败',
                })
              })
            }}>移除头像</Button>}
          </div>
        </form>
      </section>

      <form onSubmit={save} noValidate className={styles.textForm}>
        {textForm.formState.errors.root?.server && <Alert variant="destructive" role="alert">
          <AlertDescription>{textForm.formState.errors.root.server.message}</AlertDescription>
        </Alert>}
        <FieldGroup>
          <Field data-invalid={textForm.formState.errors.nickname ? true : undefined}>
            <FieldContent>
              <FieldLabel htmlFor={`${id}-nickname`}>用户名</FieldLabel>
              <Input id={`${id}-nickname`} autoComplete="nickname" {...textForm.register('nickname')}
                aria-invalid={textForm.formState.errors.nickname ? true : undefined} />
              {textForm.formState.errors.nickname && <FieldError>{textForm.formState.errors.nickname.message}</FieldError>}
            </FieldContent>
          </Field>
          <Field data-invalid={textForm.formState.errors.qq ? true : undefined}>
            <FieldContent>
              <FieldLabel htmlFor={`${id}-qq`}>QQ</FieldLabel>
              <Input id={`${id}-qq`} inputMode="numeric" {...textForm.register('qq')}
                aria-invalid={textForm.formState.errors.qq ? true : undefined} />
              {textForm.formState.errors.qq && <FieldError>{textForm.formState.errors.qq.message}</FieldError>}
            </FieldContent>
          </Field>
          <Field data-invalid={textForm.formState.errors.fivemId ? true : undefined}>
            <FieldContent>
              <FieldLabel htmlFor={`${id}-fivem`}>FiveM ID</FieldLabel>
              <Input id={`${id}-fivem`} placeholder="fivem:12345" {...textForm.register('fivemId')}
                aria-invalid={textForm.formState.errors.fivemId ? true : undefined} />
              {textForm.formState.errors.fivemId && <FieldError>{textForm.formState.errors.fivemId.message}</FieldError>}
            </FieldContent>
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={textForm.formState.isSubmitting}>
          {textForm.formState.isSubmitting && <Spinner aria-hidden="true" />}保存资料
        </Button>
      </form>
    </div>
  )
}
