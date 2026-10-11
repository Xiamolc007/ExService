import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { StorageServices } from './factory.js'

export interface StoragePluginOptions { services: StorageServices }

const plugin: FastifyPluginAsync<StoragePluginOptions> = async (app, options) => {
  app.decorate('storageServices', options.services)
}

export default fp(plugin, {
  name: 'business-storage', fastify: '5.x',
})
