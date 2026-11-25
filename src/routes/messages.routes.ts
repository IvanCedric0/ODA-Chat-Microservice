import {fastify, type FastifyPluginAsync, type RouteShorthandOptions } from "fastify"
import type { CreateMessageInput, MessageDTO } from "../../shared/contracts.js"
import { messageService } from "../services/message.service.js"
import { requireUserAuth } from "../hooks/auth.hooks.js"

export const messageRoutes: FastifyPluginAsync = async (fastify, _options) => {
    
    fastify.addHook('preHandler', requireUserAuth)

    const GetMessagesOpts: RouteShorthandOptions = {
        schema: {
            description: "Retourne l'historique paginé des messages d'un salon",
            tags:["Messages"],
            security: [
                {bearerAuth: []}
            ],
            params: {
                type: 'object',
                required: ['topicId'],
                properties: {
                    topicId: {type: 'integer'},
                }
            },
            querystring: {
                type: 'object',
                properties: {
                    limit: {type: 'integer', default: 50},
                    beforeId: {type: 'integer'}
                }
            },
            response: {
                200: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: {type: 'integer'},
                            topicId: {type: 'integer'},
                            senderId: {type: 'integer'},
                            content: {type: 'string'},
                            isDeleted: {type: 'boolean'},
                            createdAt: {type: 'string'}
                        }
                    }
                }
            }
        }
    }

    fastify.get<{Params: {topicId: string}; Querystring: {limit?: number, beforeId?: number}; Reply: MessageDTO[] | {error: string}}>('/topics/:topicId/messages', GetMessagesOpts, async (req, res) => {
        const topicId = Number(req.params.topicId)
        const userId = req.userId! // Extracted securely from the JWT
        const {limit = 50, beforeId} = req.query

        try{
            const messages = await messageService.getTopicMessages(topicId, userId, limit, beforeId)
            return res.code(200).send(messages)
        } catch (err:any) {
            fastify.log.error(err, "Error getting messages")
            const errorMsg = err.message 
            
            let status
            if(errorMsg === 'TOPIC_NOT_FOUND') {
                status = 404
            } else if(errorMsg === 'FORBIDDEN_NOT_PARTICIPANT'){
                status = 403
            }
            else {
                status = 400
            }

            return res.code(status).send({error: errorMsg})
        }

    })

    const DeleteMessagesOpts: RouteShorthandOptions = {
        schema: {
            description: "Applique un effacement logique après vérification de l'auteur",
            security: [{bearerAuth: []}],
            tags:["Messages"],
            params: {
                type: 'object',
                required: ['messageId'],
                properties: {
                    messageId: {type: 'integer'},
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        id: {type: 'integer'},
                        topicId: {type: 'integer'},
                        senderId: {type: 'integer'},
                        content: {type: 'string'},
                        isDeleted: {type: 'boolean'},
                        createdAt: {type: 'string'}
                    }
                }
            }
        }
    }

    fastify.delete<{Params: {messageId: string}; Reply: MessageDTO | {error: string}}>('/messages/:messageId', DeleteMessagesOpts, async (req, res) => {
        const messageId = Number(req.params.messageId)
        const userId = req.userId!

        try {
            
            const deletedDto = await messageService.deleteMessage(messageId, userId)
            return res.code(200).send(deletedDto)

        } catch (err: any) {

            fastify.log.error(err, "Error deleting messages")
            const errorMsg = err.message 
            
            let status
            if(errorMsg === 'MESSAGE_NOT_FOUND') {
                status = 404
            } else if(errorMsg === 'FORBIDDEN_NOT_AUTHOR'){
                status = 403
            }
            else {
                status = 400
            }

            return res.code(status).send({error: errorMsg})           
        }
    })


}
 