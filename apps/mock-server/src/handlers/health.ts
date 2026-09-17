/**
 * `GET /health`（经 Glue 注册后实际为 `GET /api/health`）的 operation handler。
 *
 * `operationId: getHealth` 由 `src/app.ts` 的 `serviceHandlers: { getHealth }` 显式映射，
 * 文件名不参与自动解析。handler 只实现行为，method、路径、输入校验与响应 schema 来自
 * `api/openapi.yaml`。
 */
export async function getHealth(): Promise<{ status: 'ok' }> {
  return { status: 'ok' }
}
