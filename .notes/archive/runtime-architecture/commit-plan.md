# Local commit plan

Identity: `wojzj57 <wojzj57@gmail.com>` from repository Git configuration. Branch: `refactor/docs`. All commits use DCO sign-off; no push.

Keep all `.notes/` task records and review snapshots local. The following four commits include only the tested code and two stable `.ai/` pages.

## 1. fix: stabilize Hydra client failure classification

```text
fix: stabilize Hydra client failure classification

Classify Hydra verification failures at their source so runtime startup
does not depend on English error messages.

- Add immutable error kinds and safe HTTP, JSON and network failures
- Map trusted kinds and allowlisted network codes in the runtime adapter
- Preserve read-only verification and explicit idempotent registration
- Cover HTTP fixtures, wording changes, redaction and native checks
```

Files:

- `scripts/runtime/hydra-client.mjs`
- `scripts/runtime/applications.mjs`
- `scripts/runtime/hydra-client.test.mjs`
- `tests/runtime/native-health.test.ts`
- `scripts/runtime/settings.test.mjs`: Hydra imports and startup classification tests

## 2. refactor: centralize complete identity configuration validation

```text
refactor: centralize complete identity configuration validation

Use one pure Node configuration assembler for Server and runtime while
preserving source selection, diagnostics and deployment binding v2.

- Add the explicit aggregate parser and matching immutable types
- Keep environment reading, switches and runtime topology in adapters
- Preserve cleanup-only isolation and identity key diagnostic priority
- Pin old receipt bytes and verify cross-adapter binding semantics
- Retain Node-only exports and Vite browser rejection coverage
```

Files:

- `packages/common/src/node/identity-config/index.mjs`
- `packages/common/src/node/identity-config/index.d.mts`
- `packages/common/test/config.test.mjs`
- `packages/common/test/entry.test.mjs`
- `apps/server/src/modules/identity/config.ts`
- `scripts/runtime/settings.mjs`
- `scripts/runtime/deployment.test.mjs`
- `tests/auth/identity-config.test.ts`
- `tests/auth/deployment-binding.test.ts`
- `scripts/runtime/settings.test.mjs`: identity key diagnostic tests

## 3. refactor: share container ownership proof calculation

```text
refactor: share container ownership proof calculation

Move the existing Docker inspect digest into a pure runtime module so
service management and retirement use an explicit shared entry point.

- Replace the Services method and prototype borrowing with normal imports
- Keep full mount fields, ordering and the three DNS normalization rules
- Preserve proof compatibility and stop/delete authorization checks
- Cover both consumers, inspect drift and unchanged proof/plan files
```

Files:

- `scripts/runtime/container-proof.mjs`
- `scripts/runtime/services.mjs`
- `scripts/runtime/retire-outline.mjs`
- `scripts/runtime/retire-outline.test.mjs`
- `scripts/runtime/settings.test.mjs`: proof import, literal digest, Services start/stop and drift tests

## 4. docs: document shared runtime validation boundaries

```text
docs: document shared runtime validation boundaries

Document the implemented validation and proof boundaries without
changing identity protocol or runtime maintenance instructions.

- Describe the shared identity parser and adapter responsibilities
- Record stable Hydra error categories and safe failure diagnostics
- Explain receipt comparison semantics and the shared proof entry point
```

Files:

- `.ai/architectures/identity/integration-boundaries.md`
- `.ai/architectures/runtime/runtime-boundaries.md`

Shared-file patches were applied in order to a temporary mirror and compose exactly to the current final file. All three intermediate settings files pass Node syntax checks. The real Git index is unchanged. The 20-file worktree still matches the independently reviewed candidate whose full API check, typecheck, tests and build passed.
