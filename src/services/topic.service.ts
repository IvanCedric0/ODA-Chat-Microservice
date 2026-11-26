import type { CreateTopicInput, TopicDTO } from "../../shared/contracts.js";
import { TopicRepository, topicRepository } from "../repositories/topic.repo.js";
import { toTopicDTO } from "./mapper.js";

export class TopicService {
    public onParticipantRemoved?: ((topicId: number, userId: number) => Promise<void> | void) | undefined;

    constructor(private repo: TopicRepository = topicRepository){}

    async isParticipant(topicId: number, userId: number): Promise<boolean> {
        return this.repo.isParticipant(topicId, userId)
    }

    async ensureParticipant(topicId: number, userId: number): Promise<void> {
        const topic = await this.repo.findTopicById(topicId)
        if (!topic) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        const isMember = await this.repo.isParticipant(topicId, userId)
        if (!isMember) {
            throw new Error('FORBIDDEN_NOT_PARTICIPANT')
        }
    }

    async  createTopic(body:CreateTopicInput): Promise<TopicDTO> {
        
        if(!body.title || !body.serviceName) {
            throw new Error('TITLE_OR_SERVICE_NAME_MISSING')
        }
        const created =  await this.repo.createTopicWithParticipants(body)
        return toTopicDTO(created)
    }
    
    async getTopicById(topicId: number, userId: number):Promise<TopicDTO>{

        const topic = await this.repo.findTopicByIdWithParticipants(topicId)
        if(topic === null) {
            throw new Error('TOPIC_NOT_FOUND')
        }
        
        if(!topic?.participants.map(p => p.userId).includes(userId)) {
            throw new Error('FORBIDDEN_NOT_PARTICIPANT')
        }
        return toTopicDTO(topic)
    }
    
    async addParticipants(topicId: number, participants: number[]): Promise<TopicDTO>{

        const topic = await this.repo.findTopicByIdWithParticipants(topicId)
        if(topic === null) {
            throw new Error('TOPIC_NOT_FOUND')
        }
 
        await this.repo.addParticipants(topicId, participants)

        const updatedTopic = await this.repo.findTopicByIdWithParticipants(topicId)
        if (!updatedTopic) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        return toTopicDTO(updatedTopic)
    }

    async removeParticipant(topicId: number, userId:number): Promise<TopicDTO>{

        const topic = await this.repo.findTopicByIdWithParticipants(topicId)
        if(topic === null) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        await this.repo.deleteParticipant(topicId, userId)
        await this.onParticipantRemoved?.(topicId, userId)

        const updatedTopic = await this.repo.findTopicByIdWithParticipants(topicId)
        if (!updatedTopic) {
            throw new Error('TOPIC_NOT_FOUND')
        }

        return toTopicDTO(updatedTopic)
    }

}
export const topicService  = new TopicService()
