export type AboutSection = 'home' | 'communities' | 'projects' | 'team' | 'story' | 'media'
export type ContentImageData = import('@workspace/components').ContentImageProps['image']
export interface RelatedRefs { communities?: string[]; projects?: string[]; members?: string[]; media?: string[]; milestones?: string[] }
export type CommunityStatus = 'active' | 'archived' | 'planned' | 'unknown'
export type ProjectStatus = 'concept' | 'development' | 'released' | 'archived' | 'unknown'
interface PageBase { id: string; url: string; section: AboutSection; title: string; description: string; eyebrow?: string }
export type AboutPage = PageBase & (
  | { kind: 'home'; hero: { headline: string; summary: string; lead?: string; eyebrow?: string; image?: ContentImageData }; introHeading: string; entryDescriptions?: Partial<Record<Exclude<AboutSection, 'home'>, string>>; entryHeadlines?: Partial<Record<Exclude<AboutSection, 'home'>, string>>; cardImages?: Partial<Record<Exclude<AboutSection, 'home'>, ContentImageData>> }
  | { kind: 'section' }
  | { kind: 'community'; slug: string; status: CommunityStatus; order: number; cover?: ContentImageData; related?: RelatedRefs; joinUrl?: string }
  | { kind: 'project'; slug: string; status: ProjectStatus; order: number; cover?: ContentImageData; related?: RelatedRefs; publicUrl?: string }
)
export interface AboutMember { id: string; slug: string; title: string; role: string; summary: string; kind: 'member' | 'contributor'; order: number; avatar?: ContentImageData; related?: RelatedRefs; links: { label: string; url: string }[] }
export interface AboutMedia { id: string; type: 'music' | 'video'; title: string; creator: string; usage: string; order: number; sourceUrl?: string; cover?: ContentImageData; related?: RelatedRefs }
export interface AboutRegistry { pages: AboutPage[]; members: AboutMember[]; media: AboutMedia[]; milestones: string[] }
