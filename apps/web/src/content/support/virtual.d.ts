declare module 'virtual:content/support' {
  export const data: import('./types').SupportRegistry
  export const assets: Record<string, string>
  export const loaders: Record<string, import('../store').ContentLoader>
}
