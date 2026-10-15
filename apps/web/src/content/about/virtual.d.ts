declare module 'virtual:content/about' {
  export const data: import('./types').AboutRegistry
  export const assets: Record<string, string>
  export const loaders: Record<string, import('../store').ContentLoader>
}
