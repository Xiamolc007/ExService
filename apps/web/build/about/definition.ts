import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ContentDefinition, ContentEntry } from '../content/compiler.ts'
import { aboutComponents, communitySchema, homeSchema, mediaSchema, memberSchema, projectSchema, sectionSchema, relatedSchema } from './schema.ts'
import { httpsUrl } from '../content/schema.ts'
import type { AboutPage, AboutRegistry, AboutSection, RelatedRefs } from '../../src/content/about/types.ts'

export const fixedPages = { 'index.mdx': 'home', 'communities/index.mdx': 'communities', 'projects/index.mdx': 'projects', 'team.mdx': 'team', 'story.mdx': 'story', 'media/index.mdx': 'media' } as const
export const pageUrl = (section: string) => section === 'home' ? '/aboutus' : `/aboutus/${section}`
export const aboutCollections = {
  aboutHome: { files: ['index.mdx'], schema: homeSchema },
  aboutSections: { files: ['communities/index.mdx', 'projects/index.mdx', 'team.mdx', 'story.mdx', 'media/index.mdx'], schema: sectionSchema },
  aboutCommunities: { files: ['communities/*.mdx', '!communities/index.mdx'], schema: communitySchema },
  aboutProjects: { files: ['projects/*.mdx', '!projects/index.mdx'], schema: projectSchema },
  aboutMembers: { files: ['members/*.mdx'], schema: memberSchema },
  aboutMedia: { files: ['media/items.yaml'], schema: mediaSchema },
}

function project(entries: ContentEntry[]): AboutRegistry {
  const fail = (entry: ContentEntry, reason: string): never => { throw new Error(`about/${entry.id}: ${reason}`) }
  for (const path of Object.keys(fixedPages)) {
    const entry = entries.find(item => item.id === path)
    if (!entry || entry.draft) throw new Error(`about/${path}: Fixed page must exist and be public`)
  }
  const byKind = new Map<string, Map<string, { draft: boolean }>>()
  const add = (kind: string, id: string, draft: boolean, entry: ContentEntry) => {
    const group = byKind.get(kind) ?? new Map<string, { draft: boolean }>()
    if (group.has(id)) fail(entry, `Duplicate ${kind} id: ${id}`)
    group.set(id, { draft }); byKind.set(kind, group)
  }
  const mediaEntry = entries.find(entry => entry.collection === 'aboutMedia')
  if (!mediaEntry) throw new Error('about/media/items.yaml: Missing media catalog')
  const media = mediaSchema.parse(mediaEntry.data).items
  for (const item of media) add('media', item.id, item.draft, mediaEntry)
  for (const entry of entries) {
    const kind = { aboutCommunities: 'communities', aboutProjects: 'projects', aboutMembers: 'members' }[entry.collection]
    if (kind) {
      const id = String(entry.data.slug)
      if (basename(entry.id, '.mdx') !== id) fail(entry, 'slug must match the file basename')
      add(kind, id, entry.draft, entry)
    }
    for (const component of entry.analysis.components) if (component.name === 'Milestone') {
      if (entry.id !== 'story.mdx') fail(entry, 'Milestone belongs to story.mdx')
      add('milestones', String(component.props.id), entry.draft, entry)
    }
  }
  const reference = (entry: ContentEntry, kind: string, id: string, draft = entry.draft) => {
    const target = byKind.get(kind)?.get(id)
    if (!target || (!draft && target.draft)) fail(entry, `Missing or unpublished ${kind}:${id}`)
  }
  const related = (entry: ContentEntry, value: unknown, draft = entry.draft) => {
    if (value === undefined) return
    for (const [kind, ids] of Object.entries(relatedSchema.parse(value))) for (const id of ids ?? []) reference(entry, kind, id, draft)
  }
  const urls = new Map(entries.filter(entry => entry.collection !== 'aboutMembers' && entry.collection !== 'aboutMedia').map(entry => {
    const section = fixedPages[entry.id as keyof typeof fixedPages]
    const url = section ? pageUrl(section) : `/aboutus/${entry.collection === 'aboutCommunities' ? 'communities' : 'projects'}/${entry.data.slug}`
    return [url, entry] as const
  }))
  const link = (entry: ContentEntry, url: string) => {
    if (httpsUrl.safeParse(url).success || url === '/join/rifling-911') return
    if (!url.startsWith('/') && !url.startsWith('#')) fail(entry, `Invalid link: ${url}`)
    const hash = url.indexOf('#')
    const path = hash < 0 ? url : url.slice(0, hash)
    let anchor = ''
    if (hash >= 0) {
      try { anchor = decodeURIComponent(url.slice(hash + 1)) }
      catch { fail(entry, `Invalid anchor encoding: ${url}`) }
    }
    const target = path ? urls.get(path) : entry
    if (!target || (!entry.draft && target.draft)) fail(entry, `Unknown internal link: ${url}`)
    if (anchor && !(target!.analysis.headings.includes(anchor) || (target!.id === 'story.mdx' && anchor.startsWith('milestone-') && byKind.get('milestones')?.has(anchor.slice(10))) || (target!.id === 'media/index.mdx' && anchor.startsWith('media-') && byKind.get('media')?.get(anchor.slice(6))?.draft === false))) fail(entry, `Unknown anchor: ${url}`)
  }
  for (const entry of entries) {
    related(entry, entry.data.related)
    for (const url of entry.analysis.links) link(entry, url)
    for (const component of entry.analysis.components) {
      related(entry, component.props.related)
      if (component.name === 'MemberButton') reference(entry, 'members', String(component.props.slug))
      if (component.name === 'AboutLink') {
        const [kind, id, ...extra] = String(component.props.target).split(':')
        if (!id || extra.length) fail(entry, 'Invalid AboutLink target')
        if (kind === 'page') { if (!Object.values(fixedPages).includes(id as AboutSection)) fail(entry, `Unknown page:${id}`) }
        else {
          const group = { community: 'communities', project: 'projects', media: 'media', milestone: 'milestones' }[kind ?? '']
          if (!group) fail(entry, 'Unknown AboutLink target kind')
          reference(entry, group!, id!)
        }
      }
    }
  }
  for (const item of media) related(mediaEntry, item.related, item.draft)
  const pages: AboutPage[] = []
  for (const entry of entries.filter(item => !item.draft)) {
    const section = fixedPages[entry.id as keyof typeof fixedPages]
    if (section === 'home') {
      const { draft: _, ...data } = homeSchema.parse(entry.data)
      pages.push({ ...data, id: entry.id, url: '/aboutus', section, kind: 'home' })
    } else if (section) {
      const { draft: _, ...data } = sectionSchema.parse(entry.data)
      pages.push({ ...data, id: entry.id, url: pageUrl(section), section, kind: 'section' })
    } else if (entry.collection === 'aboutCommunities') {
      const { draft: _, ...data } = communitySchema.parse(entry.data)
      pages.push({ ...data, id: entry.id, url: `/aboutus/communities/${data.slug}`, section: 'communities', kind: 'community' })
    } else if (entry.collection === 'aboutProjects') {
      const { draft: _, ...data } = projectSchema.parse(entry.data)
      pages.push({ ...data, id: entry.id, url: `/aboutus/projects/${data.slug}`, section: 'projects', kind: 'project' })
    }
  }
  return {
    pages,
    members: entries.filter(entry => !entry.draft && entry.collection === 'aboutMembers').map(entry => {
      const { draft: _, ...data } = memberSchema.parse(entry.data)
      return { ...data, id: entry.id }
    }).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)),
    media: media.filter(item => !item.draft).map(({ draft: _, ...item }) => item).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    milestones: [...(byKind.get('milestones')?.keys() ?? [])],
  }
}

export const aboutDefinition: ContentDefinition = {
  namespace: 'about', root: resolve(dirname(fileURLToPath(import.meta.url)), '../../content/about'), components: aboutComponents,
  classify(file) {
    if (file === 'index.mdx') return { collection: 'aboutHome', schema: homeSchema }
    if (Object.hasOwn(fixedPages, file)) return { collection: 'aboutSections', schema: sectionSchema }
    if (/^communities\/[a-z0-9-]+\.mdx$/.test(file)) return { collection: 'aboutCommunities', schema: communitySchema }
    if (/^projects\/[a-z0-9-]+\.mdx$/.test(file)) return { collection: 'aboutProjects', schema: projectSchema }
    if (/^members\/[a-z0-9-]+\.mdx$/.test(file)) return { collection: 'aboutMembers', schema: memberSchema }
    if (file === 'media/items.yaml') return { collection: 'aboutMedia', schema: mediaSchema }
    return undefined
  },
  project,
}
