import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { JoinService } from './applications/service.js'
import type { InvitationService } from './invitations/service.js'

export interface JoinPluginOptions { services: { joinServices: JoinService; invitationServices: InvitationService } }
const plugin: FastifyPluginAsync<JoinPluginOptions> = async (app, { services }) => {
  app.decorate('joinServices', services.joinServices)
  app.decorate('invitationServices', services.invitationServices)
}
export default fp(plugin, { name: 'business-join', fastify: '5.x' })
