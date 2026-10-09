import { forwardRef, useId, useImperativeHandle, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@exre/exui";
import type { AuthFormHandle } from "@components/src/auth/AuthForm";
import { nicknameSchema } from "@components/src/profileValidation";
import { ExIcon } from "@components/src/ExIcon";
import styles from "@components/src/auth/AuthForm.module.scss";

export const invitationEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
      Array.from(value).length <= 254,
    "请输入有效的邮箱地址",
  );
const emailSchema = z.object({ email: invitationEmailSchema });
const codeSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, "请输入 6 位验证码"),
});
const profileSchema = z.object({
  nickname: nicknameSchema,
  password: z
    .string()
    .refine(
      (value) =>
        Array.from(value).length >= 8 && Array.from(value).length <= 64,
      "密码必须为 8 至 64 个字符",
    ),
});
export type InvitationProfileValues = z.infer<typeof profileSchema>;

interface EmailProps {
  initialEmail: string;
  busy: boolean;
  onSubmit: (email: string) => Promise<void>;
  onEmailChange: () => void;
  onLogin: () => void;
  onJoin: () => void;
}
export const InvitationEmailForm = forwardRef<AuthFormHandle, EmailProps>(
  function InvitationEmailForm(
    { initialEmail, busy, onSubmit, onEmailChange, onLogin, onJoin },
    ref,
  ) {
    const id = useId();
    const form = useForm({
      resolver: zodResolver(emailSchema),
      defaultValues: { email: initialEmail },
    });
    useImperativeHandle(ref, () => ({
      setServerErrors: (e) => {
        if (e.email) form.setError("email", { message: e.email });
        if (e.form) form.setError("root.server", { message: e.form });
      },
      clearServerErrors: () => form.clearErrors(),
    }));
    const disabled = busy || form.formState.isSubmitting;
    const email = form.register("email");
    return (
      <form
        className={`${styles.form} ${styles.loginForm}`}
        noValidate
        aria-busy={disabled}
        onSubmit={form.handleSubmit(({ email }) => onSubmit(email))}
      >
        <div className={`${styles.intro} ${styles.loginIntro}`}>
          <ExIcon size="6rem" className={styles.authIcon} />
          <h2>注册Exre账号</h2>
          <p>请使用申请获批的邮箱继续。</p>
          <p className={styles.registrationLinks}>
            <span>
              还没有申请？
              <Button type="button" variant="link" onClick={onJoin}>
                申请加入
              </Button>
            </span>
            <span>
              已经有账号？
              <Button type="button" variant="link" onClick={onLogin}>
                登录
              </Button>
            </span>
          </p>
        </div>
        {form.formState.errors.root?.server && (
          <Alert variant="destructive">
            <AlertDescription>
              {form.formState.errors.root.server.message}
            </AlertDescription>
          </Alert>
        )}
        <Field data-invalid={!!form.formState.errors.email}>
          <FieldContent>
            <FieldLabel htmlFor={id}>邮箱</FieldLabel>
            <Input
              {...email}
              onChange={(event) => {
                email.onChange(event);
                onEmailChange();
                form.clearErrors();
              }}
              id={id}
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={!!form.formState.errors.email}
              aria-describedby={
                form.formState.errors.email ? `${id}-error` : undefined
              }
            />
            {form.formState.errors.email && (
              <FieldError id={`${id}-error`}>
                {form.formState.errors.email.message}
              </FieldError>
            )}
          </FieldContent>
        </Field>
        <Button type="submit" disabled={disabled}>
          {disabled ? "检查中" : "继续"}
        </Button>
      </form>
    );
  },
);

interface CodeProps {
  email: string;
  busy: boolean;
  retry: boolean;
  resendSeconds: number;
  lockedSeconds: number;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<boolean>;
  onBack: () => void;
}
export const InvitationCodeForm = forwardRef<AuthFormHandle, CodeProps>(
  function InvitationCodeForm(
    {
      email,
      busy,
      retry,
      resendSeconds,
      lockedSeconds,
      onVerify,
      onResend,
      onBack,
    },
    ref,
  ) {
    const id = useId();
    const form = useForm({
      resolver: zodResolver(codeSchema),
      defaultValues: { code: "" },
    });
    const lastAttempt = useRef<string | null>(null);
    const submitting = useRef(false);
    useImperativeHandle(ref, () => ({
      setServerErrors: (e) => {
        if (e.code) form.setError("code", { message: e.code });
        if (e.form) form.setError("root.server", { message: e.form });
      },
      clearServerErrors: () => form.clearErrors(),
    }));
    const disabled = busy || form.formState.isSubmitting || lockedSeconds > 0;
    const submit = form.handleSubmit(async ({ code }) => {
      if (busy || lockedSeconds > 0 || submitting.current) return;
      submitting.current = true;
      lastAttempt.current = code;
      form.clearErrors();
      try {
        await onVerify(code);
      } finally {
        submitting.current = false;
      }
    });
    return (
      <form
        className={`${styles.form} ${styles.loginForm}`}
        noValidate
        aria-busy={busy}
        onSubmit={submit}
      >
        <div className={`${styles.intro} ${styles.loginIntro}`}>
          <ExIcon size="6rem" className={styles.authIcon} />
          <h2>验证邮箱</h2>
          <p>{email}</p>
          <p>请输入邀请邮件中的六位验证码</p>
        </div>
        {form.formState.errors.root?.server && (
          <Alert variant="destructive">
            <AlertDescription>
              {form.formState.errors.root.server.message}
            </AlertDescription>
          </Alert>
        )}
        <Field data-invalid={!!form.formState.errors.code}>
          <FieldContent>
            <FieldLabel htmlFor={id}>6 位验证码</FieldLabel>
            <Controller
              control={form.control}
              name="code"
              render={({ field }) => (
                <InputOTP
                  {...field}
                  id={id}
                  maxLength={6}
                  autoFocus
                  disabled={disabled}
                  aria-invalid={!!form.formState.errors.code}
                  aria-describedby={
                    form.formState.errors.code ? `${id}-error` : undefined
                  }
                  onChange={(value) => {
                    const digits = value.replace(/\D/g, "").slice(0, 6);
                    field.onChange(digits);
                    form.clearErrors();
                    if (digits.length < 6) lastAttempt.current = null;
                    if (
                      digits.length === 6 &&
                      lastAttempt.current !== digits &&
                      !disabled &&
                      !submitting.current
                    ) {
                      lastAttempt.current = digits;
                      void submit();
                    }
                  }}
                >
                  <InputOTPGroup>
                    {Array.from({ length: 6 }, (_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              )}
            />
            {form.formState.errors.code && (
              <FieldError id={`${id}-error`}>
                {form.formState.errors.code.message}
              </FieldError>
            )}
          </FieldContent>
        </Field>
        {lockedSeconds > 0 && (
          <p role="status">验证暂时锁定，{lockedSeconds} 秒后重试</p>
        )}
        {retry && (
          <Button type="submit" disabled={disabled}>
            重试验证
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || resendSeconds > 0}
          onClick={async () => {
            if (await onResend()) {
              form.reset({ code: "" });
              lastAttempt.current = null;
            }
          }}
        >
          {resendSeconds > 0 ? `${resendSeconds} 秒后重发` : "重新发送验证码"}
        </Button>
        <Button type="button" variant="link" onClick={onBack}>
          返回修改邮箱
        </Button>
      </form>
    );
  },
);

interface ProfileProps {
  email: string;
  nickname: string;
  busy: boolean;
  onSubmit: (values: InvitationProfileValues) => Promise<void>;
  onBack: () => void;
}
export const InvitationProfileForm = forwardRef<AuthFormHandle, ProfileProps>(
  function InvitationProfileForm(
    { email, nickname, busy, onSubmit, onBack },
    ref,
  ) {
    const id = useId();
    const form = useForm({
      resolver: zodResolver(profileSchema),
      defaultValues: { nickname, password: "" },
    });
    useImperativeHandle(ref, () => ({
      setServerErrors: (e) => {
        if (e.nickname) form.setError("nickname", { message: e.nickname });
        if (e.password) form.setError("password", { message: e.password });
        if (e.form) form.setError("root.server", { message: e.form });
      },
      clearServerErrors: () => form.clearErrors(),
    }));
    const disabled = busy || form.formState.isSubmitting;
    return (
      <form
        className={`${styles.form} ${styles.loginForm}`}
        noValidate
        aria-busy={disabled}
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <div className={`${styles.intro} ${styles.loginIntro}`}>
          <ExIcon size="6rem" className={styles.authIcon} />
          <h2>完善账号</h2>
          <p>{email}</p>
        </div>
        {form.formState.errors.root?.server && (
          <Alert variant="destructive">
            <AlertDescription>
              {form.formState.errors.root.server.message}
            </AlertDescription>
          </Alert>
        )}
        {(["nickname", "password"] as const).map((name) => (
          <Field key={name} data-invalid={!!form.formState.errors[name]}>
            <FieldContent>
              <FieldLabel htmlFor={`${id}-${name}`}>
                {name === "nickname" ? "用户名" : "密码"}
              </FieldLabel>
              <Input
                {...form.register(name)}
                id={`${id}-${name}`}
                type={name === "password" ? "password" : "text"}
                autoComplete={name === "password" ? "new-password" : "nickname"}
                autoFocus={name === "nickname"}
                disabled={disabled}
                aria-invalid={!!form.formState.errors[name]}
                aria-describedby={
                  form.formState.errors[name]
                    ? `${id}-${name}-error`
                    : undefined
                }
              />
              {form.formState.errors[name] && (
                <FieldError id={`${id}-${name}-error`}>
                  {form.formState.errors[name]?.message}
                </FieldError>
              )}
            </FieldContent>
          </Field>
        ))}
        <Button type="submit" disabled={disabled}>
          {disabled ? "提交中" : "完成注册"}
        </Button>
        <Button type="button" variant="link" onClick={onBack}>
          返回修改邮箱
        </Button>
      </form>
    );
  },
);
