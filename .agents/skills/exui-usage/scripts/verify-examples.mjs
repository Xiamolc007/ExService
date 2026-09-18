// verify-examples.mjs — the exui-usage example gate.
//
// Contract approved by team-lead on 2026-09-11 (design report and rulings in
// .notes/skill-refine/). The gate discovers every skill example, enforces the
// import allowlist, requires documentation links in both directions (no
// orphan examples, no dangling example links), and compiles all examples in
// an isolated packed consumer with strict TypeScript checks
// (skipLibCheck disabled).
//
// Modes:
//   node skills/exui-usage/scripts/verify-examples.mjs                full gate
//   node skills/exui-usage/scripts/verify-examples.mjs --tarball <p>  reuse a tarball
//   node skills/exui-usage/scripts/verify-examples.mjs --self-test    prove rejections
//
// The --repo and --skill flags override the resolved roots for debugging.
// The gate never writes inside the repository workspace: packing writes the
// tarball to a temp destination, and the isolated consumer lives under
// mkdtemp outside the workspace.
import { spawnSync } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptFile = fileURLToPath(import.meta.url)
const defaultRepositoryRoot = resolve(dirname(scriptFile), "..", "..", "..")
const defaultSkillRoot = resolve(dirname(scriptFile), "..")

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function fail(message) {
  throw new Error(message)
}

function requireCondition(condition, message) {
  if (!condition) {
    fail(message)
  }
}

// Node cannot spawn the .cmd shims for pnpm/npm with the shell disabled on
// Windows, so run their bundled CLI entries with the current Node
// executable instead — the same no-shell discipline update.mjs uses. The
// argument array stays intact (never a shell string), which keeps paths
// containing spaces — usernames, Program Files — correctly quoted.
function windowsCliArguments(command, args) {
  const nodeModulesDirectory = join(dirname(process.execPath), "node_modules")
  if (command === "pnpm") {
    return [join(nodeModulesDirectory, "corepack", "dist", "pnpm.js"), ...args]
  }
  if (command === "npm") {
    return [join(nodeModulesDirectory, "npm", "bin", "npm-cli.js"), ...args]
  }
  return null
}

function run(command, args, cwd, { allowFailure = false } = {}) {
  const cliArguments = process.platform === "win32" ? windowsCliArguments(command, args) : null
  const result = spawnSync(cliArguments ? process.execPath : command, cliArguments ?? args, {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  })
  const label = `${command} ${args.join(" ")}`
  if (result.error) {
    fail(`${label} failed to spawn: ${result.error.message}`)
  }
  if (result.status !== 0 && !allowFailure) {
    fail(`${label} failed (${result.status}):\n${result.stdout ?? ""}\n${result.stderr ?? ""}`)
  }
  return result
}

function toDependencyPath(value) {
  return value.replaceAll("\\", "/")
}

function toPosix(value) {
  return value.split("\\").join("/")
}

function isWithin(base, candidate) {
  const value = relative(base, candidate)
  return value === "" || (!value.startsWith("..") && !value.startsWith(`..${"/"}`) && value !== "..")
}

// ---------------------------------------------------------------------------
// Discovery: recursive examples/**/*.tsx, no manifest
// ---------------------------------------------------------------------------
async function collectExampleFiles(examplesRoot) {
  const stat = await readdir(examplesRoot, { withFileTypes: true }).catch(() => null)
  requireCondition(stat !== null, `examples directory not found: ${examplesRoot}`)

  const discovered = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      requireCondition(
        entry.isFile() && entry.name.endsWith(".tsx"),
        `examples directory contains a non-example file: ${toPosix(relative(examplesRoot, entryPath))} (only .tsx files are allowed)`
      )
      discovered.push(entryPath)
    }
  }
  await walk(examplesRoot)
  requireCondition(discovered.length > 0, "examples directory contains no example files")
  discovered.sort((left, right) => relative(examplesRoot, left).localeCompare(relative(examplesRoot, right), "en"))
  return discovered
}

// ---------------------------------------------------------------------------
// Import allowlist: static scan for clear, named rejections
// ---------------------------------------------------------------------------
const ALLOWED_IMPORT_SPECIFIERS = new Set([
  "react",
  "@exre/exui",
  "@exre/exui/style.css",
  "@exre/exui/tokens",
  "@exre/exui/tokens/style.css",
  "@exre/exui/tokens/font.css",
  "lucide-react",
])

function isAllowedImportSpecifier(specifier) {
  if (ALLOWED_IMPORT_SPECIFIERS.has(specifier)) {
    return true
  }
  // The automatic JSX runtime imports react/jsx-runtime without appearing in
  // example source; typed react subpath imports stay allowed as well.
  return specifier.startsWith("react/")
}

function extractImportSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?[^;'"()]*?from\s*["']([^"']+)["']/g,
    /(?:^|[\s;}])import\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1])
    }
  }
  return specifiers
}

async function scanExampleImports(examplesRoot, exampleFiles) {
  const violations = []
  for (const file of exampleFiles) {
    const source = await readFile(file, "utf8")
    for (const specifier of extractImportSpecifiers(source)) {
      if (!isAllowedImportSpecifier(specifier)) {
        violations.push(
          `${toPosix(relative(examplesRoot, file))}: import "${specifier}" is not allowed. ` +
            `Examples may import only react, @exre/exui public entries, and lucide-react.`
        )
      }
    }
  }
  requireCondition(violations.length === 0, `forbidden example imports:\n${violations.join("\n")}`)
}

// ---------------------------------------------------------------------------
// Documentation links: every example must be linked; every linked example
// must exist. The updater validates the doc set it knows about; this scan
// covers every markdown file under the skill root, including new guides that
// the updater does not (yet) register.
// ---------------------------------------------------------------------------
function extractRelativeLinks(markdown) {
  const links = []
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g
  let match
  while ((match = pattern.exec(markdown)) !== null) {
    if (!match[1].startsWith("#") && !/^[a-z]+:/i.test(match[1])) {
      links.push(match[1])
    }
  }
  return links
}

async function collectMarkdownFiles(skillRoot) {
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue
      }
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath)
      }
    }
  }
  await walk(skillRoot)
  return files
}

async function collectDocumentedExamplesWithExistence(skillRoot, examplesRoot, knownExamples) {
  const documented = new Set()
  const dangling = []
  for (const markdownFile of await collectMarkdownFiles(skillRoot)) {
    const markdown = await readFile(markdownFile, "utf8")
    for (const link of extractRelativeLinks(markdown)) {
      const pathOnly = link.split("#", 1)[0]
      if (!pathOnly) {
        continue
      }
      const resolved = resolve(dirname(markdownFile), pathOnly)
      if (!isWithin(examplesRoot, resolved)) {
        continue
      }
      const relativeExample = toPosix(relative(examplesRoot, resolved))
      documented.add(relativeExample)
      if (!knownExamples.has(relativeExample)) {
        dangling.push(`${toPosix(relative(skillRoot, markdownFile))} links to a missing example: ${link}`)
      }
    }
  }
  return { documented, dangling }
}

async function checkExampleDocumentation(skillRoot, examplesRoot, exampleFiles) {
  const known = new Set(exampleFiles.map((file) => toPosix(relative(examplesRoot, file))))
  const { documented, dangling } = await collectDocumentedExamplesWithExistence(skillRoot, examplesRoot, known)
  requireCondition(
    dangling.length === 0,
    `documents link to examples that do not exist:\n${dangling.join("\n")}`
  )
  const orphans = [...known].filter((example) => !documented.has(example)).sort()
  requireCondition(
    orphans.length === 0,
    `examples are not linked from any skill document (add a relative link from SKILL.md or references/):\n${orphans.join("\n")}`
  )
}

// ---------------------------------------------------------------------------
// Isolated compile: packed consumer + strict tsc with skipLibCheck disabled
// ---------------------------------------------------------------------------
const fixtureReactVersion = "19.2.7"
const fixtureLucideVersion = "1.23.0"
const fixtureTypescriptVersion = "~6.0.2"

async function packComponents(repositoryRoot, destination) {
  const output = run("pnpm", ["pack", "--json", "--pack-destination", destination], join(repositoryRoot, "packages", "components"))
  return JSON.parse(output.stdout.trim()).filename
}

async function compileExamples({ tarballPath, examplesRoot, exampleFiles, temporaryRoot }) {
  const fixtureRoot = join(temporaryRoot, "consumer")
  await mkdir(join(fixtureRoot, "examples"), { recursive: true })
  await writeFile(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "exui-example-gate-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@exre/exui": `file:${toDependencyPath(tarballPath)}`,
          react: fixtureReactVersion,
          "react-dom": fixtureReactVersion,
          "lucide-react": fixtureLucideVersion,
        },
        devDependencies: {
          "@types/node": "^24",
          "@types/react": "^19",
          typescript: fixtureTypescriptVersion,
        },
      },
      null,
      2
    )}\n`
  )
  for (const file of exampleFiles) {
    const relativeExample = relative(examplesRoot, file)
    const target = join(fixtureRoot, "examples", relativeExample)
    await mkdir(dirname(target), { recursive: true })
    await cp(file, target)
  }
  await writeFile(
    join(fixtureRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          target: "ES2023",
          lib: ["ES2023", "DOM", "DOM.Iterable"],
        },
        include: ["examples/**/*.tsx"],
      },
      null,
      2
    )}\n`
  )

  run("npm", ["install", "--no-fund", "--no-audit"], fixtureRoot)
  const result = runFixtureTsc(fixtureRoot)
  requireCondition(
    result.status === 0,
    `example compilation failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
  )
  return { fixtureRoot }
}

function runFixtureTsc(fixtureRoot) {
  const tsc = join(fixtureRoot, "node_modules", "typescript", "bin", "tsc")
  return run("node", [tsc, "-p", "tsconfig.json"], fixtureRoot, { allowFailure: true })
}

// ---------------------------------------------------------------------------
// Gate orchestration
// ---------------------------------------------------------------------------
async function runGate({ repositoryRoot, skillRoot, tarballPath, report }) {
  const examplesRoot = join(skillRoot, "examples")
  const exampleFiles = await collectExampleFiles(examplesRoot)
  await scanExampleImports(examplesRoot, exampleFiles)
  await checkExampleDocumentation(skillRoot, examplesRoot, exampleFiles)

  const temporaryRoot = await mkdtemp(join(tmpdir(), "exui-example-gate-"))
  try {
    const resolvedTarball = tarballPath ?? (await packComponents(repositoryRoot, temporaryRoot))
    await compileExamples({ tarballPath: resolvedTarball, examplesRoot, exampleFiles, temporaryRoot })
    report(`verified ${exampleFiles.length} example(s) against ${toPosix(relative(repositoryRoot, resolvedTarball)) || "packed tarball"}`)
  } finally {
    await import("node:fs/promises").then((fs) => fs.rm(temporaryRoot, { recursive: true, force: true }))
  }
}

// ---------------------------------------------------------------------------
// Self-test: prove the gate rejects bad input on temporary copies
// ---------------------------------------------------------------------------
async function expectRejection(action, expectedMessage) {
  let rejected = false
  try {
    await action()
  } catch (error) {
    rejected = true
    requireCondition(
      String(error.message).includes(expectedMessage),
      `expected rejection containing "${expectedMessage}", received: ${error.message}`
    )
  }
  requireCondition(rejected, `expected rejection containing "${expectedMessage}"`)
}

async function writeSelfTestSkill(root, { withDocs = true } = {}) {
  await mkdir(join(root, "examples"), { recursive: true })
  await mkdir(join(root, "references", "components"), { recursive: true })
  await writeFile(
    join(root, "examples", "button-basic.tsx"),
    `import "@exre/exui/style.css"
import { Button } from "@exre/exui"

export default function ButtonBasic() {
  return <Button variant="default">Basic button</Button>
}
`
  )
  await writeFile(
    join(root, "examples", "sonner-notifications.tsx"),
    `import * as React from "react"
import "@exre/exui/style.css"
import { Button, ThemeProvider, Toaster, toast } from "@exre/exui"

export default function SonnerNotifications() {
  return (
    <ThemeProvider defaultTheme="dark">
      <Button onClick={() => toast.success("Saved")}>Save</Button>
      <Toaster position="bottom-right" />
    </ThemeProvider>
  )
}
`
  )
  if (withDocs) {
    await writeFile(join(root, "SKILL.md"), `[button](examples/button-basic.tsx)\n`, "utf8")
    await writeFile(
      join(root, "references", "components", "Button.md"),
      `[完整示例](../../examples/button-basic.tsx)\n`,
      "utf8"
    )
    await writeFile(
      join(root, "references", "components", "Sonner.md"),
      `[完整示例](../../examples/sonner-notifications.tsx)\n`,
      "utf8"
    )
  }
}

async function runSelfTest({ repositoryRoot, tarballPath }) {
  const root = await mkdtemp(join(tmpdir(), "exui-example-gate-self-test-"))
  const temporaryRoot = await mkdtemp(join(tmpdir(), "exui-example-gate-"))
  try {
    // Positive control: the synthetic skill passes every gate stage.
    await writeSelfTestSkill(root)
    const skillRoot = root
    const examplesRoot = join(skillRoot, "examples")
    const exampleFiles = await collectExampleFiles(examplesRoot)
    await scanExampleImports(examplesRoot, exampleFiles)
    await checkExampleDocumentation(skillRoot, examplesRoot, exampleFiles)
    const { fixtureRoot } = await compileExamples({
      tarballPath,
      examplesRoot,
      exampleFiles,
      temporaryRoot,
    })

    // Negative 1: a forbidden import must be rejected by the static scan.
    await writeFile(
      join(root, "examples", "bad-import.tsx"),
      `import { toast as foreignToast } from "sonner"
export default function BadImport() {
  return <button onClick={() => foreignToast("nope")}>bad</button>
}
`
    )
    const filesAfterBadImport = await collectExampleFiles(examplesRoot)
    await expectRejection(
      () => scanExampleImports(examplesRoot, filesAfterBadImport),
      'import "sonner" is not allowed'
    )
    await import("node:fs/promises").then((fs) => fs.rm(join(root, "examples", "bad-import.tsx"), { force: true }))

    // Negative 2: an orphan example (no document links it) must be rejected.
    await writeFile(
      join(root, "examples", "orphan.tsx"),
      `import { Badge } from "@exre/exui"
export default function Orphan() {
  return <Badge>orphan</Badge>
}
`
    )
    const filesAfterOrphan = await collectExampleFiles(examplesRoot)
    await scanExampleImports(examplesRoot, filesAfterOrphan)
    await expectRejection(
      () => checkExampleDocumentation(skillRoot, examplesRoot, filesAfterOrphan),
      "not linked from any skill document"
    )
    await import("node:fs/promises").then((fs) => fs.rm(join(root, "examples", "orphan.tsx"), { force: true }))

    // Negative 3: a scanner-clean, documented example with a type error must
    // fail the compile stage. Reuses the already-installed fixture: the file
    // enters through the normal example set (discovery, import scan, and doc
    // link check all pass), and only the compiler rejects it.
    await writeFile(
      join(root, "examples", "bad-types.tsx"),
      `import { Button } from "@exre/exui"
export default function BadTypes() {
  return <Button variant="not-a-real-variant">broken</Button>
}
`
    )
    await writeFile(
      join(root, "SKILL.md"),
      `[button](examples/button-basic.tsx)\n[broken](examples/bad-types.tsx)\n`,
      "utf8"
    )
    const filesAfterBadTypes = await collectExampleFiles(examplesRoot)
    await scanExampleImports(examplesRoot, filesAfterBadTypes)
    await checkExampleDocumentation(skillRoot, examplesRoot, filesAfterBadTypes)
    await cp(join(root, "examples", "bad-types.tsx"), join(fixtureRoot, "examples", "bad-types.tsx"))
    const brokenResult = runFixtureTsc(fixtureRoot)
    requireCondition(
      brokenResult.status !== 0,
      "expected the compiler to reject the type-broken example, but compilation passed"
    )
    requireCondition(
      String(brokenResult.stdout ?? "").includes("bad-types.tsx"),
      "expected the compiler diagnostic to point at the broken example file"
    )
    await import("node:fs/promises").then((fs) => fs.rm(join(root, "examples", "bad-types.tsx"), { force: true }))
    await import("node:fs/promises").then((fs) => fs.rm(join(fixtureRoot, "examples", "bad-types.tsx"), { force: true }))
    await writeFile(join(root, "SKILL.md"), `[button](examples/button-basic.tsx)\n`, "utf8")

    // Negative 4: a document link to a missing example must be rejected.
    await writeFile(
      join(root, "references", "components", "Sonner.md"),
      `[完整示例](../../examples/sonner-missing.tsx)\n`,
      "utf8"
    )
    const filesAfterCleanup = await collectExampleFiles(examplesRoot)
    await expectRejection(
      () => checkExampleDocumentation(skillRoot, examplesRoot, filesAfterCleanup),
      "links to a missing example"
    )

    process.stdout.write("verify-examples self-test passed\n")
  } finally {
    await import("node:fs/promises").then((fs) => {
      fs.rm(root, { recursive: true, force: true })
      fs.rm(temporaryRoot, { recursive: true, force: true })
    })
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArguments(argumentList) {
  const mode = { selfTest: false, tarball: null, repositoryRoot: null, skillRoot: null }
  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index]
    if (argument === "--self-test") {
      mode.selfTest = true
    } else if (argument === "--tarball") {
      mode.tarball = argumentList[index + 1]
      requireCondition(typeof mode.tarball === "string" && mode.tarball.length > 0, "--tarball requires a path")
      index += 1
    } else if (argument === "--repo") {
      mode.repositoryRoot = argumentList[index + 1]
      requireCondition(typeof mode.repositoryRoot === "string" && mode.repositoryRoot.length > 0, "--repo requires a path")
      index += 1
    } else if (argument === "--skill") {
      mode.skillRoot = argumentList[index + 1]
      requireCondition(typeof mode.skillRoot === "string" && mode.skillRoot.length > 0, "--skill requires a path")
      index += 1
    } else {
      fail(`unknown argument: ${argument}\nusage: node verify-examples.mjs [--tarball <path>] [--repo <path>] [--skill <path>] [--self-test]`)
    }
  }
  return mode
}

async function main() {
  const mode = parseArguments(process.argv.slice(2))
  const repositoryRoot = mode.repositoryRoot ?? defaultRepositoryRoot
  const skillRoot = mode.skillRoot ?? defaultSkillRoot
  const report = (message) => process.stdout.write(`[verify-examples] ${message}\n`)

  if (mode.selfTest) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "exui-example-gate-pack-"))
    try {
      const tarballPath = mode.tarball ?? (await packComponents(repositoryRoot, temporaryRoot))
      await runSelfTest({ repositoryRoot, tarballPath })
    } finally {
      await import("node:fs/promises").then((fs) => fs.rm(temporaryRoot, { recursive: true, force: true }))
    }
    return
  }

  await runGate({ repositoryRoot, skillRoot, tarballPath: mode.tarball, report })
  process.stdout.write("exui-usage example gate passed\n")
}

main().catch((error) => {
  process.stderr.write(`verify-examples failed: ${error.message}\n`)
  process.exitCode = 1
})