/** Builds a root entry so Outline can verify the target before SPA navigation. */
export function docsResumeUrl(target: string): string {
  return `/docs/?${new URLSearchParams({ docsResume: target }).toString()}`
}

/** Replaces the confirmation page with the Outline reading resume controller. */
export function replaceDocsResume(target: string): void {
  window.location.replace(docsResumeUrl(target))
}
