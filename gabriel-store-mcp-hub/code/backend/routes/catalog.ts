import type { FastifyInstance } from 'fastify'
import { catalog } from '../data/catalog.js'

export function registerCatalogRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/catalog', async () => catalog)
}
