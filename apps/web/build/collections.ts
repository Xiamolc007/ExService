import { aboutDefinition } from './about/definition.ts'
import { supportDefinition } from './support/definition.ts'
// The Website owns registration; the content engine stays unaware of business modules.
export const contentDefinitions = [aboutDefinition, supportDefinition]
