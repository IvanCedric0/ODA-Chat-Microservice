import type { MessageDTO } from "../../shared/contracts.js";
import { messageRepository } from "../repositories/message.repo.js";
import { topicRepository } from "../repositories/topic.repo.js";
import { toMessageDTO } from "./mapper.js";

export class MessageService {
    constructor(private messageRepo = messageRepository, private topicRepo=topicRepository){}
    
    private async verifyUserTopicParticipation(userId: number, topicId: number){

        const topic = await this.topicRepo.findTopicById(topicId)
        if (!topic) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        const isMember = await this.topicRepo.isParticipant(topicId, userId)
        if (!isMember) {
            throw new Error('FORBIDDEN_NOT_PARTICIPANT')
        }
        
    }
    
    async getTopicMessages(topicId: number, userId: number, limit: number, cursor?: number): Promise<MessageDTO[]> {
        
        await this.verifyUserTopicParticipation(userId, topicId)

        const messages = await this.messageRepo.findMessagesByTopic({topicId, limit, beforeId: cursor})

        const mappedMessages = messages.map((m) => toMessageDTO(m))

        return mappedMessages
    }

    async postMessage(topicId: number, senderId: number, content: string): Promise<MessageDTO> {
        const trimedContent = content.trim()
        if (!trimedContent) {
            throw new Error('EMPTY_MESSAGE')
        }

        await this.verifyUserTopicParticipation(senderId, topicId)

        const message = await this.messageRepo.createMessage({topicId, senderId, content: trimedContent})
        
        return toMessageDTO(message)

    }

    async deleteMessage(messageId: number, userId: number){
        
        const message = await this.messageRepo.findMessageById(messageId)
       
        if(!message) {
            throw new Error('MESSAGE_NOT_FOUND')
        }

        if(message.senderId !== userId) {
            throw new Error('FORBIDDEN_NOT_AUTHOR')
        }

        const updatedMessage  = await this.messageRepo.softDeleteMessage(messageId)

        return toMessageDTO(updatedMessage)

    }
}

export const messageService = new MessageService()