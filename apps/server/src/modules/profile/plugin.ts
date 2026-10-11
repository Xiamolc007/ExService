import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { ProfileService } from './service.js'

export interface ProfilePluginOptions { services: ProfileService }

const plugin: FastifyPluginAsync<ProfilePluginOptions> = async (app, options) => {
  app.decorate('profileServices', options.services)
}

export default fp(plugin, {
  name: 'business-profile', fastify: '5.x',
})
