import { type FastifyPluginAsync, type RouteShorthandOptions } from "fastify"
import { prisma } from "../config/prisma.js";

export interface HealthRoutesOptions {
    hideFromDocs?: boolean;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (fastify, options) => {
    const healtOpts: RouteShorthandOptions = {
        schema: {
            hide: Boolean(options.hideFromDocs),
            description: 'Get server status',
            response: {
                200: {
                    type: 'object',
                    properties: {
                        status: {type: 'string'},
                        database: {type: 'string'},
                        timestamp: {type: 'string'}
                    }
                }
            }
        }
    }
    fastify.get('/health', healtOpts ,async (_req, res) => {
        try {
            await prisma.$queryRaw`SELECT 1 as ping`
            
            return res.code(200).send({
                status: 'ok',
                database: 'connected',
                timestamp: new Date().toISOString(),
            })
        } catch (err) {
            fastify.log.error(err, 'Health check database ping failed')

            return res.code(503).send({
                status: 'error',
                database: 'disconnected'
            })
        }
    })
}