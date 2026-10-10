/** Literal names are verified against execution reports, with one disposable database per case. */
export const outlineServerTests = Object.freeze([
  { file: 'server/identity/config.test.ts', cases: ['accepts explicit HTTPS deployment without legacy defaults', 'rejects HTTP, mismatched origins, missing values and normalized paths'] },
  { file: 'server/identity/readiness.test.ts', cases: ['refuses the disposable test database identity before touching preparation records', 'refuses disabling integration for an existing marked workspace without changing data'] },
  { file: 'server/identity/readinessCli.test.ts', databaseName: 'outline', cases: ['runs the real readiness CLI successfully against a migrated bootstrapped outline database without writes', 'rejects missing migration column issuer administrator provider identity and authentication without repairing data'] },
  { file: 'server/identity/websiteProvisioner.test.ts', cases: ['creates integrated users in Chinese and preserves saved English on profile refresh'] },
  { file: 'server/identity/websiteOidc.test.ts', cases: ['keeps only local docs paths and strips fragments'] },
  { file: 'server/identity/SessionGuard.test.ts', cases: ['checks every protected HTTP request and refuses a mismatched binding', 'never renews a real-time lease from a late response after invalidation'] },
  { file: 'server/identity/syncWebsiteProfile.test.ts', cases: ['applies newer profiles and ignores late older checks'] },
  { file: 'server/identity/expiredAccessTokens.test.ts', cases: ['removes encrypted access tokens after their 60 second lifetime while keeping current tokens'] },
  { file: 'server/routes/auth/websiteOidcFlow.test.ts', cases: ['binds a genuine signed OIDC flow to its initiating cookie jar before consuming state', 'rejects actual code nonce PKCE issuer audience signature and userinfo-subject failures', 'restores the safe public document after discovery token userinfo and provisioning outages'] },
])
export const outlineFrontendTests = Object.freeze([
  'app/utils/websiteThemePreference.test.ts', 'app/utils/websiteOidcAttempt.test.ts',
  'app/stores/RootStore.public.test.ts', 'app/stores/PublicDocsStore.test.ts', 'app/scenes/WebsitePublic.test.tsx',
  'app/scenes/Document/components/PublicOnlyGate.test.tsx', 'app/components/Collection/CollectionForm.test.tsx',
  'app/components/Editor.public.test.tsx', 'app/components/WebsiteSessionProbe.test.tsx',
  'app/components/WebsiteLanguageProjection.test.tsx', 'app/components/WebsiteIdentityController.test.tsx',
  'shared/utils/websiteIntegrationConfig.test.ts', 'shared/utils/publicPath.test.ts',
  'shared/styles/websiteInitialTheme.test.ts', 'shared/editor/commands/insertFiles.test.ts',
])
