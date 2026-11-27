import { type FastifyPluginAsync, type RouteShorthandOptions } from "fastify"
import type { CreateTopicInput, TopicDTO } from "../../shared/contracts.js"
import { topicService } from "../services/topic.service.js"
import { isUuid } from "../services/auth.service.js"
import { requireServiceAuth } from "../hooks/auth.hooks.js"

function resolveOptionalTenantHeader(headerValue: string | string[] | undefined): string | undefined {
    if (headerValue === undefined) return undefined;
    if (typeof headerValue !== 'string' || !isUuid(headerValue.trim())) {
        throw new Error('INVALID_TENANT_ID');
    }
    return headerValue.trim().toLowerCase();
}

export const topicRoutes: FastifyPluginAsync = async (fastify, _options) => {
 
    fastify.addHook('preHandler', requireServiceAuth)

    const topicResponseSchema = {
        type: 'object',
        properties: {
            id: {type: 'integer'},
            tenantId: {type: 'string', format: 'uuid'},
            serviceName: {type: 'string'},
            title: {type: 'string'},
            participantIds: {type: 'array', items: {type: 'string', format: 'uuid'}}
        }
    }

    const createTopicOpts: RouteShorthandOptions = {
        schema: {
            description: 'Cree un salon prive',
            tags: ['Topics'],
            security: [
                {serviceApiKey: []}
            ],
            body: {
                type: 'object',
                required: ['serviceName', 'title', 'participantIds'],
                properties: {
                   tenantId: {type: 'string', format: 'uuid'},
                   serviceName: {type: 'string', minLength: 1},
                   title: {type: 'string', minLength: 1},
                   participantIds: {type: 'array', items: {type: 'string', format: 'uuid'}, minItems: 1},
                }
            },
            response: {
                201: topicResponseSchema
            }
        }
    }
    
    fastify.post<{Body: Omit<CreateTopicInput, 'tenantId'> & { tenantId?: string }; Reply: TopicDTO | {error: string}}>('/',createTopicOpts ,async (req, res) => {
        try {
            const headerTenant = resolveOptionalTenantHeader(req.headers['x-tenant-id'])
            const bodyTenant = req.body.tenantId?.trim().toLowerCase()

            if (headerTenant && bodyTenant && headerTenant !== bodyTenant) {
                return res.code(400).send({ error: 'TENANT_ID_MISMATCH' })
            }

            const tenantId = headerTenant ?? bodyTenant
            if (!tenantId) {
                return res.code(400).send({ error: 'TENANT_ID_REQUIRED' })
            }

            const topic = await topicService.createTopic({
                ...req.body,
                tenantId,
            })
            return res.code(201).send(topic)
        } catch (err: any) {
            fastify.log.error(err, "Error creating topic")
            return res.code(400).send({error: err.message})
        }
    })

    const AddParticpantsOpts: RouteShorthandOptions = {
        schema: {
            description: "Ajoute une liste d'identifiants à la liste des membres autorisés du salon",
            tags: ['Topics'],
            security: [
                {serviceApiKey: []}
            ],
            params: {
                type: 'object',
                required: ['topicId'],
                properties: {
                    topicId: {type: 'integer', minimum: 1}
                }
            },
            body: {
                type: 'object',
                required: ['userIds'],
                properties: {
                    userIds: {type: 'array', items: {type: 'string', format: 'uuid'}, minItems: 1}
                }
            },
            response: {
                200: topicResponseSchema
            }
        }
    }

    fastify.post<{Params: {topicId: string}; Body: {userIds: string[]}; Reply: TopicDTO | {error: string}}>('/:topicId/participants', AddParticpantsOpts, async (req, res) => {
        const topicId = Number(req.params.topicId)
        const {userIds} = req.body

        try {
            const tenantId = resolveOptionalTenantHeader(req.headers['x-tenant-id'])
            const topic = await topicService.addParticipants(topicId, userIds, tenantId)
            return res.code(200).send(topic)
        } catch (err: any) {
            fastify.log.error(err, "Error adding participants to topic")
            const status = err.message === "TOPIC_NOT_FOUND" ? 404 : 400;
            return res.code(status).send({error: err.message})
        }
    })

    const DeleteParticpantsOpts: RouteShorthandOptions = {
        schema: {
            description: "Supprime un participant à la liste des membres autorisés du salon",
            tags: ['Topics'],
            security: [
                {serviceApiKey: []}
            ],
            params: {
                type: 'object',
                required: ['topicId', 'userId'],
                properties: {
                    topicId: {type: 'integer', minimum: 1},
                    userId: {type: 'string', format: 'uuid'}
                }
            },
            response: {
                200: topicResponseSchema
            }
        }
    }

    fastify.delete<{Params: {topicId: string, userId: string}; Reply: TopicDTO | {error: string}}>('/:topicId/participants/:userId', DeleteParticpantsOpts, async (req, res) => {
        const topicId = Number(req.params.topicId)
        const userId = req.params.userId

        try {
            const tenantId = resolveOptionalTenantHeader(req.headers['x-tenant-id'])
            const topic = await topicService.removeParticipant(topicId, userId, tenantId)
            return res.code(200).send(topic)
        } catch (err: any) {
            fastify.log.error(err, "Error removing participants from topic")
            const status = err.message === "TOPIC_NOT_FOUND" ? 404 : 400;
            return res.code(status).send({error: err.message})
        }
    })

}