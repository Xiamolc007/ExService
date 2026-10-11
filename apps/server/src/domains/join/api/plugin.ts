import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { registerJoinTransport } from './transport.js'

const plugin: FastifyPluginAsync = async (app) => {
  app.getDecorator('joinServices')
  app.getDecorator('invitationServices')
  registerJoinTransport(app)
}

export default fp(plugin, {
  name: 'api-join', fastify: '5.x',
  dependencies: ["business-join","api-auth"],
  decorators: { fastify: ["joinServices","invitationServices"], request: ["authSession"] },
})
