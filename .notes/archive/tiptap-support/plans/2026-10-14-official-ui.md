# Tiptap Official UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the custom toolbar with free official UI Components and one approved custom text-color panel.

**Architecture:** Vendor the MIT source dependency closure with provenance. Adapt primitives to public ExUI exports and scope styling through CSS Modules; keep the existing document schema and lifecycle. Compose official components in a small internal toolbar.

**Tech Stack:** React 19, Tiptap 3.32.0, ExUI 0.8, Lucide, RHF/Zod, Vitest and Playwright.

**Spec:** `.notes/tiptap-support/specs/2026-10-14-official-ui-design.md`

## Global Constraints

- Free official components; custom text color is the only feature-panel exception.
- Preserve unrelated dirty work, document schema, conversion policy and async generations.
- No second Radix instance, global token layer, API change or deployment.
- Toolbar background and positioning remain caller-owned.
- No commits requested in this task.

### Task 1: Official toolbar and host adapters

**Files:** Create `packages/components/src/tiptap/official/`; replace `packages/components/src/tiptap/toolbar/TiptapToolbar.tsx`; retain selection/color utilities only where needed.

**Interfaces:** Consumes `Editor`, `TiptapLifecycle` and `uploadEnabled`; produces the existing internal `TiptapToolbar` component and themed official controls.

- [x] Add real-editor regression asserting removed controls disappear and official marks update the selected text.
- [x] Run `pnpm exec vitest run packages/components/src/tiptap/official-toolbar.test.tsx`; observe failure against the old controls.
- [x] Import the free official component dependency closure, record upstream revision/license, use relative imports and public ExUI primitives.
- [x] Compose history, headings/lists, blockquote/code, marks, colors/link, alignment and image upload. Map upload through `runtime.upload(file)` and generation-safe selection.
- [x] Run component typecheck and focused tests.

### Task 2: Safe color/link integration and legacy removal

**Files:** official link/highlight/upload adapters, `toolbar/TextColorPopover.tsx`, selection/color tests, wrapper/component/browser tests.

**Interfaces:** `ToolbarSession.run(command)` restores mapped selection and validates accepted transactions; `resolveToolbarColor(host, css)` produces normalized literal colors.

- [x] Add failing tests for literal highlighter JSON/Markdown, safe link submission, stale popovers and obsolete upload pickers.
- [x] Integrate RHF/Zod into the official link content; close generation-invalid panels and retain failed input.
- [x] Build the approved text-color panel using official button and ExUI popover; share resolved ExUI color presets with highlight.
- [x] Remove old layout/state/focus/forms/buttons and their implementation-specific tests. Preserve behavior-focused lifecycle, selection and conversion regressions.
- [x] Run `pnpm exec vitest run packages/components/src/tiptap`.

### Task 3: Verification and durable documentation

**Files:** `tests/browser/tiptap-toolbar.mjs`, official provenance README and `.ai/knowledge/components/tiptap-content-boundaries.md`.

- [x] Run `pnpm typecheck`, `pnpm test`, `pnpm build` and inspect results.
- [x] Exercise `/dev/tiptap` in a real browser: theme, keyboard, links/colors/upload, readonly, mobile and zoom geometry.
- [x] Record verified official integration boundaries and update superseded toolbar design references.
- [x] Review changes and `git diff --check`; report automatic and browser results separately.
