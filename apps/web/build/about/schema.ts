import { z } from 'zod'
import { baseComponents, text, slug, httpsUrl, imageSchema } from '../content/schema.ts'
const refs = z.array(slug).refine(values => new Set(values).size === values.length, 'Duplicate reference').optional()
export const relatedSchema = z.strictObject({ communities: refs, projects: refs, members: refs, media: refs, milestones: refs })
const base = { title: text, description: text, eyebrow: text.optional(), draft: z.boolean().default(false) }
const entity = { ...base, slug, order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), cover: imageSchema.optional(), related: relatedSchema.optional() }
export const sectionSchema = z.strictObject(base)
const entryText = z.strictObject({ communities: text.optional(), projects: text.optional(), team: text.optional(), story: text.optional(), media: text.optional(), donations: text.optional() })
export const homeSchema = sectionSchema.extend({
  hero: z.strictObject({ headline: text, summary: text, lead: text.optional(), eyebrow: text.optional(), image: imageSchema.optional() }),
  introHeading: text,
  entryDescriptions: entryText.optional(),
  entryHeadlines: entryText.optional(),
  cardImages: z.strictObject({ communities: imageSchema.optional(), projects: imageSchema.optional(), team: imageSchema.optional(), media: imageSchema.optional(), story: imageSchema.optional(), donations: imageSchema.optional() }).optional(),
})
const donationChannelSchema = z.strictObject({ id: slug, name: text, description: text.optional(), url: httpsUrl.optional(), qrCode: imageSchema.optional(), draft: base.draft })
  .refine(channel => channel.url !== undefined || channel.qrCode !== undefined, 'A donation channel requires a URL or QR code')
const donorSchema = z.strictObject({ id: slug, nickname: text, date: z.iso.date(), draft: base.draft })
export const donationCatalogSchema = z.strictObject({
  channels: z.array(donationChannelSchema).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate donation channel id').default([]),
  donors: z.array(donorSchema).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate donor id').default([]),
})
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
