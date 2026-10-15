import config from '../../public/config.json'
import routes from 'virtual:team-routes'
import { parseTeamConfig } from './team'

export const teamConfig = parseTeamConfig(config, routes)
