import {fastify, type FastifyPluginAsync, type RouteShorthandOptions } from "fastify"
import type { CreateTopicInput, TopicDTO } from "../../shared/contracts.js"
import { topicService } from "../services/topic.service.js"
import { requireServiceAuth } from "../hooks/auth.hooks.js"

export const topicRoutes: FastifyPluginAsync = async (fastify, _options) => {
 
    fastify.addHook('preHandler', requireServiceAuth)

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
                   serviceName: {type: 'string', minLength: 1},
                   title: {type: 'string', minLength: 1},
                   participantIds: {type: 'array', items: {type: 'integer'}, minItems: 1},
                }
            },
            response: {
                201: {
                    type: 'object',
                    properties: {
                        id: {type: 'integer'},
                        serviceName: {type: 'string'},
                        title: {type: 'string'},
                        participantIds: {type: 'array', items: {type: 'integer'}}
                    }
                }
            }
        }
    }
    
    fastify.post<{Body: CreateTopicInput; Reply: TopicDTO | {error: string}}>('/',createTopicOpts ,async (req, res) => {
        const body = req.body

        try {
            const topic = await topicService.createTopic(body)
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
                    userIds: {type: 'array', items: {type: 'integer'}, minItems: 1}
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        id: {type: 'integer'},
                        serviceName: {type: 'string'},
                        title: {type: 'string'},
                        participantIds: {type: 'array', items: {type: 'integer'}}
                    }
                }
            }
        }
    }

    fastify.post<{Params: {topicId: string}; Body: {userIds: number[]}; Reply: TopicDTO | {error: string}}>('/:topicId/participants', AddParticpantsOpts, async (req, res) => {
        const topicId = Number(req.params.topicId)
        const {userIds} = req.body

        try {
            const topic = await topicService.addParticipants(topicId, userIds)
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
                    userId: {type: 'integer', minimum: 1}
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        id: {type: 'integer'},
                        serviceName: {type: 'string'},
                        title: {type: 'string'},
                        participantIds: {type: 'array', items: {type: 'integer'}}
                    }
                }
            }
        }
    }

    fastify.delete<{Params: {topicId: string, userId: string}; Reply: TopicDTO | {error: string}}>('/:topicId/participants/:userId', DeleteParticpantsOpts, async (req, res) => {
        const topicId = Number(req.params.topicId)
        const userId = Number(req.params.userId)

        try {
            const topic = await topicService.removeParticipant(topicId, userId)
            return res.code(200).send(topic)
        } catch (err: any) {
            fastify.log.error(err, "Error removing participants from topic")
            const status = err.message === "TOPIC_NOT_FOUND" ? 404 : 400;
            return res.code(status).send({error: err.message})
        }
    })

}