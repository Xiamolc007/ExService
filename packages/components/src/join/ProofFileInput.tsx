import { useId } from 'react'
import { Controller, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import { Button, Field, FieldContent, FieldDescription, FieldError, FieldLabel, Input } from '@exre/exui'
import { proofExtensions, proofFilesSchema } from '@components/src/join/applicationSchemas'
import styles from '@components/src/join/CompleteJoinApplication.module.scss'

export function ProofFileInput<T extends FieldValues, O extends FieldValues>({ form, disabled }: { form: UseFormReturn<T, unknown, O>; disabled: boolean }) {
  const id = useId()
  const name = 'proofs' as Path<T>
  const { error } = form.getFieldState(name, form.formState)
  return <Field data-invalid={!!error}><FieldContent>
    <FieldLabel htmlFor={id}>证明文件（可选）</FieldLabel>
    <FieldDescription id={`${id}-hint`}>最多 5 个文件，每个 1 字节至 10 MiB。可选择、拖放或粘贴文件。支持 {proofExtensions.map(extension => `.${extension}`).join('、')}。文件仅供审核下载，不会在页面内预览。</FieldDescription>
    <Controller name={name} control={form.control} render={({ field }) => {
      const files: File[] = Array.isArray(field.value) ? field.value : []
      function add(incoming: File[]) {
        if (disabled || incoming.length === 0) return
        const candidate = [...files, ...incoming]
        const parsed = proofFilesSchema.safeParse(candidate)
        if (!parsed.success) { form.setError(name, { message: parsed.error.issues[0]?.message ?? '证明文件不符合要求' }); return }
        field.onChange(parsed.data)
        form.clearErrors(name)
      }
      return <div className={styles.dropArea} role="group" aria-label="证明文件输入" aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} tabIndex={disabled ? -1 : 0}
        onDragOver={event => { event.preventDefault() }} onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)) }}
        onPaste={event => { const incoming = Array.from(event.clipboardData.files); if (incoming.length > 0) { event.preventDefault(); add(incoming) } }}>
        <Input id={id} ref={field.ref} type="file" multiple accept={proofExtensions.map(extension => `.${extension}`).join(',')} disabled={disabled} aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} onBlur={field.onBlur} onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <p>也可将文件拖到此处，或聚焦此区域后粘贴文件。</p>
        {files.length === 0 ? <p>未选择证明文件。</p> : <ul className={styles.files}>{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}<small>{(file.size / (1024 * 1024)).toFixed(2)} MiB</small></span><Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`移除 ${file.name}`} onClick={() => { field.onChange(files.filter((_, position) => position !== index)); form.clearErrors(name) }}>移除</Button></li>)}</ul>}
      </div>
    }} />
    {error && <FieldError id={`${id}-error`}>{error.message}</FieldError>}
  </FieldContent></Field>
}
