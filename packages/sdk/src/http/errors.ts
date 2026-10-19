export type ExAxiosErrorKind =
  | "config"
  | "network"
  | "timeout"
  | "cancelled"
  | "http";
export class ExAxiosError extends Error {
  readonly kind: ExAxiosErrorKind;
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  constructor(
    kind: ExAxiosErrorKind,
    code: string,
    message: string,
    extra: {
      status?: number;
      requestId?: string;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "ExAxiosError";
    this.kind = kind;
    this.code = code;
    this.status = extra.status;
    this.requestId = extra.requestId;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
  toJSON() {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(this.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: this.retryAfterSeconds }),
    };
  }
}
