import type { CreateTopicInput, TopicDTO } from "../../shared/contracts.js";
import { TopicRepository, topicRepository } from "../repositories/topic.repo.js";
import { isUuid } from "./auth.service.js";
import { toTopicDTO } from "./mapper.js";

export class TopicService {
    public onParticipantRemoved?: ((topicId: number, userId: string) => Promise<void> | void) | undefined;

    constructor(private repo: TopicRepository = topicRepository){}

    async isParticipant(topicId: number, userId: string): Promise<boolean> {
        return this.repo.isParticipant(topicId, userId.toLowerCase())
    }

    async ensureParticipant(topicId: number, userId: string, tenantId?: string): Promise<void> {
        const topic = await this.repo.findTopicById(topicId, tenantId)
        if (!topic || (tenantId && topic.tenantId !== tenantId)) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        const isMember = await this.repo.isParticipant(topicId, userId.toLowerCase())
        if (!isMember) {
            throw new Error('FORBIDDEN_NOT_PARTICIPANT')
        }
    }

    async createTopic(body: CreateTopicInput): Promise<TopicDTO> {
        if (!body.title?.trim() || !body.serviceName?.trim()) {
            throw new Error('TITLE_OR_SERVICE_NAME_MISSING')
        }
        if (!isUuid(body.tenantId)) {
            throw new Error('INVALID_TENANT_ID')
        }
        if (!Array.isArray(body.participantIds) || body.participantIds.length === 0) {
            throw new Error('PARTICIPANTS_REQUIRED')
        }
        const normalizedParticipants = body.participantIds.map((id) => {
            if (!isUuid(id)) {
                throw new Error('INVALID_PARTICIPANT_ID')
            }
            return id.toLowerCase()
        })

        const created = await this.repo.createTopicWithParticipants({
            ...body,
            tenantId: body.tenantId.toLowerCase(),
            serviceName: body.serviceName.trim(),
            title: body.title.trim(),
            participantIds: normalizedParticipants,
        })
        return toTopicDTO(created)
    }
    
    async getTopicById(topicId: number, userId: string, tenantId?: string): Promise<TopicDTO> {
        const normalizedUserId = userId.toLowerCase()
        const topic = await this.repo.findTopicByIdWithParticipants(topicId, tenantId)
        if (!topic || (tenantId && topic.tenantId !== tenantId)) {
            throw new Error('TOPIC_NOT_FOUND')
        }
        
        if (!topic.participants.some((p) => p.userId === normalizedUserId)) {
            throw new Error('FORBIDDEN_NOT_PARTICIPANT')
        }
        return toTopicDTO(topic)
    }
    
    async addParticipants(topicId: number, participants: string[], tenantId?: string): Promise<TopicDTO> {
        if (!Array.isArray(participants) || participants.length === 0) {
            throw new Error('PARTICIPANTS_REQUIRED')
        }
        const normalizedParticipants = participants.map((id) => {
            if (!isUuid(id)) {
                throw new Error('INVALID_PARTICIPANT_ID')
            }
            return id.toLowerCase()
        })

        const topic = await this.repo.findTopicByIdWithParticipants(topicId, tenantId)
        if (!topic || (tenantId && topic.tenantId !== tenantId)) {
            throw new Error('TOPIC_NOT_FOUND')
        }
 
        await this.repo.addParticipants(topicId, normalizedParticipants)

        const updatedTopic = await this.repo.findTopicByIdWithParticipants(topicId, tenantId)
        if (!updatedTopic) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        return toTopicDTO(updatedTopic)
    }

    async removeParticipant(topicId: number, userId: string, tenantId?: string): Promise<TopicDTO> {
        if (!isUuid(userId)) {
            throw new Error('INVALID_USER_ID')
        }
        const normalizedUserId = userId.toLowerCase()

        const topic = await this.repo.findTopicByIdWithParticipants(topicId, tenantId)
        if (!topic || (tenantId && topic.tenantId !== tenantId)) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        await this.repo.deleteParticipant(topicId, normalizedUserId)
        await this.onParticipantRemoved?.(topicId, normalizedUserId)

        const updatedTopic = await this.repo.findTopicByIdWithParticipants(topicId, tenantId)
        if (!updatedTopic) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        return toTopicDTO(updatedTopic)
    }

}
export const topicService = new TopicService()
