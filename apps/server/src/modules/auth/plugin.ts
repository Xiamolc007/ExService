import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { AuthService } from './service.js'

export interface AuthPluginOptions { services: AuthService }

const plugin: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  app.decorate('authServices', options.services)
}

export default fp(plugin, {
  name: 'business-auth', fastify: '5.x',
})
