// 未确认社区地址时不渲染入口；部署时可在站点环境配置已核对的 QQ/KOOK 地址。
function configuredLink(label: string, value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') return []
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? [{ label, url: url.href }] : []
  } catch { return [] }
}
export const communityLinks = [
  ...configuredLink('QQ 社区', import.meta.env.VITE_COMMUNITY_QQ_URL),
  ...configuredLink('KOOK 社区', import.meta.env.VITE_COMMUNITY_KOOK_URL),
]
