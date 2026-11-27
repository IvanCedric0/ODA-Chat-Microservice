import type { MessageDTO } from "../../shared/contracts.js";
import { messageRepository } from "../repositories/message.repo.js";
import { topicRepository } from "../repositories/topic.repo.js";
import { toMessageDTO } from "./mapper.js";

export class MessageService {
    public onMessageDeleted?: ((topicId: number, messageId: number) => Promise<void> | void) | undefined;

    constructor(private messageRepo = messageRepository, private topicRepo=topicRepository){}
    
    private async verifyUserTopicParticipation(userId: string, topicId: number, tenantId?: string){

        const topic = await this.topicRepo.findTopicById(topicId, tenantId)
        if (!topic || (tenantId && topic.tenantId !== tenantId)) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        const isMember = await this.topicRepo.isParticipant(topicId, userId.toLowerCase())
        if (!isMember) {
            throw new Error('FORBIDDEN_NOT_PARTICIPANT')
        }
        
    }
    
    async getTopicMessages(topicId: number, userId: string, limit: number, cursor?: number, tenantId?: string): Promise<MessageDTO[]> {
        
        await this.verifyUserTopicParticipation(userId, topicId, tenantId)
        const normalized = Number.isFinite(limit) ? Math.trunc(limit) : 50 
        
        const safeLimit = Math.min(Math.max(Math.trunc(normalized), 1), 100);

        const messages = await this.messageRepo.findMessagesByTopic({topicId, limit: safeLimit, beforeId: cursor})

        const mappedMessages = messages.map((m) => toMessageDTO(m))

        return mappedMessages
    }

    async postMessage(topicId: number, senderId: string, content: string, tenantId?: string): Promise<MessageDTO> {
        const trimedContent = content.trim()
        if (!trimedContent) {
            throw new Error('EMPTY_MESSAGE')
        }

        const normalizedSenderId = senderId.toLowerCase()
        await this.verifyUserTopicParticipation(normalizedSenderId, topicId, tenantId)

        const message = await this.messageRepo.createMessage({topicId, senderId: normalizedSenderId, content: trimedContent})
        
        return toMessageDTO(message)

    }

    async deleteMessage(messageId: number, userId: string, tenantId?: string){
        
        const message = await this.messageRepo.findMessageById(messageId)
       
        if(!message) {
            throw new Error('MESSAGE_NOT_FOUND')
        }

        if (tenantId) {
            const topic = await this.topicRepo.findTopicById(message.topicId, tenantId)
            if (!topic || topic.tenantId !== tenantId) {
                throw new Error('MESSAGE_NOT_FOUND')
            }
        }

        if(message.senderId !== userId.toLowerCase()) {
            throw new Error('FORBIDDEN_NOT_AUTHOR')
        }

        const updatedMessage  = await this.messageRepo.softDeleteMessage(messageId)
        const dto = toMessageDTO(updatedMessage)

        await this.onMessageDeleted?.(dto.topicId, dto.id)

        return dto

    }
}

export const messageService = new MessageService()