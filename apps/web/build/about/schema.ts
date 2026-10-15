import { z } from 'zod'
import { baseComponents, text, slug, httpsUrl, imageSchema } from '../content/schema.ts'
const refs = z.array(slug).refine(values => new Set(values).size === values.length, 'Duplicate reference').optional()
export const relatedSchema = z.strictObject({ communities: refs, projects: refs, members: refs, media: refs, milestones: refs })
const base = { title: text, description: text, eyebrow: text.optional(), draft: z.boolean().default(false) }
const entity = { ...base, slug, order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), cover: imageSchema.optional(), related: relatedSchema.optional() }
export const sectionSchema = z.strictObject(base)
export const homeSchema = sectionSchema.extend({ hero: z.strictObject({ headline: text, summary: text, eyebrow: text.optional(), image: imageSchema.optional() }), introHeading: text, entryDescriptions: z.strictObject({ communities: text.optional(), projects: text.optional(), team: text.optional(), story: text.optional(), media: text.optional() }).optional() })
export const communitySchema = z.strictObject({ ...entity, status: z.enum(['active', 'archived', 'planned', 'unknown']), joinUrl: text.optional() }).superRefine((value, context) => {
  if (value.joinUrl && (value.status !== 'active' || (value.joinUrl !== '/join/rifling-911' && !httpsUrl.safeParse(value.joinUrl).success))) context.addIssue({ code: 'custom', path: ['joinUrl'], message: 'Join URL requires active status and an existing/HTTPS target' })
})
export const projectSchema = z.strictObject({ ...entity, status: z.enum(['concept', 'development', 'released', 'archived', 'unknown']), publicUrl: httpsUrl.optional() })
export const memberSchema = z.strictObject({ title: text, slug, role: text, summary: text, kind: z.enum(['member', 'contributor']), order: entity.order, draft: base.draft, avatar: imageSchema.optional(), related: relatedSchema.optional(), links: z.array(z.strictObject({ label: text, url: httpsUrl })).default([]) })
export const mediaItemSchema = z.strictObject({ id: slug, type: z.enum(['music', 'video']), title: text, creator: text, usage: text, order: entity.order, draft: base.draft, sourceUrl: httpsUrl.optional(), cover: imageSchema.optional(), related: relatedSchema.optional() })
export const mediaSchema = z.strictObject({ items: z.array(mediaItemSchema) })
export const aboutComponents = {
  ...baseComponents,
  AboutLink: z.strictObject({ target: text }),
  MemberButton: z.strictObject({ slug }),
  Timeline: z.strictObject({}),
  Milestone: z.strictObject({ id: slug, dateLabel: text, title: text, related: relatedSchema.optional(), image: imageSchema.optional() }),
}
