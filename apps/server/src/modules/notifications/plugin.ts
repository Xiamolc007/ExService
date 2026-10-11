import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { NotificationModule } from './factory.js'

export interface NotificationsPluginOptions { services: NotificationModule }

const plugin: FastifyPluginAsync<NotificationsPluginOptions> = async (app, options) => {
  app.decorate('notifications', options.services)
}

export default fp(plugin, {
  name: 'business-notifications', fastify: '5.x',
})
