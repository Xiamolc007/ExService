import { afterEach, expect, it } from 'vitest'
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { parse, stringify } from 'yaml'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aboutDefinition } from '@web/build/about/definition'
import { readContent } from '@web/build/content/compiler'
import type { AboutRegistry } from '@web/src/content/about/types'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'exwebsite-about-'))
  roots.push(root)
  await cp(aboutDefinition.root, root, { recursive: true })
  return { ...aboutDefinition, root }
}
async function homeFields(definition: typeof aboutDefinition, fields: Record<string, unknown>) {
  const path = join(definition.root, 'index.mdx')
  const source = await readFile(path, 'utf8')
  await writeFile(path, source.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_, frontmatter: string) => `---\n${stringify({ ...parse(frontmatter), ...fields })}---`))
}
it('keeps the new home fields optional in the real registry projection', async () => {
  const definition = await fixture()
  await homeFields(definition, { hero: { headline: 'Headline', summary: 'Summary' }, entryHeadlines: undefined, cardImages: undefined })
  const registry = (await readContent(definition)).data as AboutRegistry
  const home = registry.pages.find(page => page.kind === 'home')!
  expect(home).toMatchObject({ kind: 'home', hero: { headline: 'Headline', summary: 'Summary' } })
  expect('cardImages' in home).toBe(false)
  expect('entryHeadlines' in home).toBe(false)
})
it('projects the new home metadata and validates nested image resources with the real compiler', async () => {
  const definition = await fixture()
  await mkdir(join(definition.root, 'assets'), { recursive: true })
  await writeFile(join(definition.root, 'assets/home.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
  const image = { src: 'assets/home.png', alt: 'Community scene', width: 1, height: 1, position: { x: 20, y: 80 } }
  await homeFields(definition, { hero: { headline: 'Headline', summary: 'Summary', lead: 'Lead' }, entryHeadlines: { communities: 'Custom headline' }, cardImages: { communities: image } })
  const result = await readContent(definition)
  expect((result.data as AboutRegistry).pages.find(page => page.kind === 'home')).toMatchObject({ hero: { lead: 'Lead' }, entryHeadlines: { communities: 'Custom headline' }, cardImages: { communities: image } })
  expect(result.assets['assets/home.png']).toBe(await realpath(join(definition.root, 'assets/home.png')))
})
it.each([
  { entryHeadlines: { belief: 'Not a linked section' } },
  { entryHeadlines: { communities: ' ' } },
  { cardImages: { unknown: { src: 'assets/home.png', alt: 'Image', width: 1, height: 1 } } },
  { cardImages: { belief: { src: 'assets/home.png', alt: 'Image', width: 1, height: 1 } } },
  { hero: { headline: 'Title', summary: 'Summary', lead: ' ' } },
])('rejects invalid home metadata with the source filename: %j', async fields => {
  const definition = await fixture()
  await homeFields(definition, fields)
  await expect(readContent(definition)).rejects.toThrow('about/index.mdx')
})
it.each(['assets/missing.png', '../outside.png'])('rejects missing or escaped nested card assets: %s', async src => {
  const definition = await fixture()
  await homeFields(definition, { cardImages: { communities: { src, alt: 'Image', width: 1, height: 1 } } })
  await expect(readContent(definition)).rejects.toThrow(/about\/index.mdx.*(asset|资源)/)
})
it('projects the real published pages and keeps member bodies separate from routes', async () => {
  const { data } = await readContent(aboutDefinition)
  const registry = data as { pages: { url: string }[]; members: { id: string }[] }
  expect(registry.pages.map(page => page.url)).toContain('/aboutus/communities/caep')
  expect(registry.pages.some(page => page.url.includes('members'))).toBe(false)
  expect(registry.members[0]?.id).toBe('members/example-contributor.mdx')
})
it('rejects a missing fixed page', async () => {
  const definition = await fixture()
  await rm(join(definition.root, 'team.mdx'))
  await expect(readContent(definition)).rejects.toThrow('team.mdx')
})
it('rejects a public reference to a draft member', async () => {
  const definition = await fixture()
  await writeFile(join(definition.root, 'members/example-contributor.mdx'), '---\ntitle: Private\nslug: example-contributor\nrole: Design\nsummary: Draft\nkind: contributor\ndraft: true\n---\nText')
  await expect(readContent(definition)).rejects.toThrow('unpublished members:example-contributor')
})
it('rejects duplicate milestone ids', async () => {
  const definition = await fixture()
  await writeFile(join(definition.root, 'story.mdx'), '---\ntitle: Story\ndescription: Intro\n---\n<Timeline>\n<Milestone id="same" title="A" dateLabel="Unknown">A</Milestone>\n<Milestone id="same" title="B" dateLabel="Unknown">B</Milestone>\n</Timeline>')
  await expect(readContent(definition)).rejects.toThrow('Duplicate milestones id: same')
})
it('does not export resources used only by a draft media item', async () => {
  const definition = await fixture()
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(definition.root, 'assets'))
  await writeFile(join(definition.root, 'assets/private.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(join(definition.root, 'media/items.yaml'), 'items:\n  - id: private-video\n    type: video\n    title: Private\n    creator: Unknown\n    usage: Private\n    draft: true\n    cover:\n      src: assets/private.svg\n      alt: Private\n      width: 10\n      height: 10')
  const result = await readContent(definition)
  expect((result.data as { media: unknown[] }).media).toEqual([])
  expect(result.assets).toEqual({})
})
it('rejects unresolved author and markdown links', async () => {
  const definition = await fixture()
  await writeFile(join(definition.root, 'projects/example-project.mdx'), '---\ntitle: Example\ndescription: Intro\nslug: example-project\nstatus: unknown\n---\n<AboutLink target="community:no-such-community">Read</AboutLink>')
  await expect(readContent(definition)).rejects.toThrow('communities:no-such-community')
  await writeFile(join(definition.root, 'projects/example-project.mdx'), '---\ntitle: Example\ndescription: Intro\nslug: example-project\nstatus: unknown\n---\n[Read](/aboutus/story#no-such-anchor)')
  await expect(readContent(definition)).rejects.toThrow('Unknown anchor')
})
it.each([
  '<Milestone id="creating" title="Example" dateLabel="Unknown" related={{projects:[" example-project "]}}>Text</Milestone>',
  '<Milestone id=" creating " title="Example" dateLabel="Unknown">Text</Milestone>',
])('rejects non-canonical static slugs before publishing broken links or anchors', async body => {
  const definition = await fixture()
  await writeFile(join(definition.root, 'story.mdx'), `---\ntitle: Story\ndescription: Intro\n---\n<Timeline>${body}</Timeline>`)
  await expect(readContent(definition)).rejects.toThrow(/story.mdx/)
})
it('checks the complete fragment instead of discarding an extra hash', async () => {
  const definition = await fixture()
  await writeFile(join(definition.root, 'projects/example-project.mdx'), '---\ntitle: Example\ndescription: Intro\nslug: example-project\nstatus: unknown\n---\n[Read](/aboutus/story#milestone-creating#junk)')
  await expect(readContent(definition)).rejects.toThrow('Unknown anchor')
})
it('accepts an encoded fragment using the same decoded anchor as the browser', async () => {
  const definition = await fixture()
  await writeFile(join(definition.root, 'story.mdx'), '---\ntitle: Story\ndescription: Intro\n---\n## 开始\n\n故事正文')
  await writeFile(join(definition.root, 'projects/example-project.mdx'), '---\ntitle: Example\ndescription: Intro\nslug: example-project\nstatus: unknown\n---\n[Read](/aboutus/story#%E5%BC%80%E5%A7%8B)')
  await expect(readContent(definition)).resolves.toBeDefined()
})
