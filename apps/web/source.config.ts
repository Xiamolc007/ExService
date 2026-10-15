import { defineCollections } from 'fumadocs-mdx/config'
import { aboutCollections } from './build/about/definition'
import { contentConfig } from './build/content/preset'

const dir = 'content/about'
export const aboutTeam = defineCollections({ type: 'doc', dir, ...aboutCollections.aboutTeam })
export const aboutHome = defineCollections({ type: 'doc', dir, ...aboutCollections.aboutHome })
export const aboutDonationCatalog = defineCollections({ type: 'meta', dir, ...aboutCollections.aboutDonationCatalog })
export const aboutSections = defineCollections({ type: 'doc', dir, ...aboutCollections.aboutSections })
export const aboutCommunities = defineCollections({ type: 'doc', dir, ...aboutCollections.aboutCommunities })
export const aboutProjects = defineCollections({ type: 'doc', dir, ...aboutCollections.aboutProjects })
export const aboutMembers = defineCollections({ type: 'doc', dir, ...aboutCollections.aboutMembers })
export const aboutMedia = defineCollections({ type: 'meta', dir, ...aboutCollections.aboutMedia })
export default contentConfig
