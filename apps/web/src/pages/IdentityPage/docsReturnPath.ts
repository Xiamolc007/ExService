/** Result distinguishes a malformed hint from a valid directory return. */
export interface DocsReturnTarget {
  valid: boolean;
  path: string;
}

/** Validates a reading-only target before URL normalization.
 *
 * @param value the untrusted requested path.
 * @param origin the configured Website origin.
 * @returns validity and a sanitized path, defaulting to the public directory.
 */
export function parseDocsReturnPath(value: unknown, origin: string): DocsReturnTarget {
  const invalid = { valid: false, path: "/docs/" };
  if (typeof value !== "string" || value.length > 2048 ||
      !value.startsWith("/docs") || /%(?![0-9a-f]{2})/i.test(value) || (value.includes("\\") || Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) ||
      /%(?:2f|5c|2e|25|00|0a|0d)/i.test(value) || /\/(?:\.|\.\.)(?:\/|$|[?#])/.test(value)) {
    return invalid;
  }
  try {
    const url = new URL(value, origin);
    const pathname = url.pathname;
    const root = pathname === "/docs" || pathname === "/docs/";
    const nakedUuid = /^\/docs\/doc\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname);
    const document = !nakedUuid && /^\/docs\/doc\/[0-9a-zA-Z_~-]*-[a-zA-Z0-9]{10,15}$/.test(pathname);
    const collection = /^\/docs\/public\/collection\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname);
    const search = pathname === "/docs/search";
    if (url.origin !== origin || !(root || document || collection || search)) {
      return invalid;
    }
    const queries = url.searchParams.getAll("q");
    const searchQuery = queries[0];
    if (queries.length > 1 || (searchQuery && (searchQuery.length > 200 || (searchQuery.includes("\\") || Array.from(searchQuery).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))))) {
      return invalid;
    }
    const scopes = url.searchParams.getAll("collectionId");
    const collectionScope = scopes[0];
    if (scopes.length > 1 || (collectionScope && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collectionScope)) || collectionScope === "") { return invalid; }
    const params = new URLSearchParams();
    if ((search || document) && searchQuery !== undefined) { params.set("q", searchQuery); }
    if (search && collectionScope !== undefined) { params.set("collectionId", collectionScope); }
    const query = params.size ? `?${params.toString()}` : "";
    return { valid: true, path: `${root ? "/docs/" : pathname}${query}` };
  } catch {
    return invalid;
  }
}

/** Returns the sanitized reading path or the public directory.
 *
 * @param value the requested return path.
 * @param origin the configured Website origin.
 * @returns a safe reading target.
 */
export function docsReturnPath(value: unknown, origin: string): string {
  return parseDocsReturnPath(value, origin).path;
}
