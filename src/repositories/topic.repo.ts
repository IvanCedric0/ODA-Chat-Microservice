import type { PrismaClient } from "../generated/prisma/client.js";
import {prisma} from "../config/prisma.js"
import type { CreateTopicInput } from "../../shared/contracts.js";

// Add findTopicsByServiceName for sercices calling

export class TopicRepository {
    constructor(private db: PrismaClient = prisma){}

        async createTopicWithParticipants(body: CreateTopicInput) {
            return this.db.topic.create({
                data: {
                    serviceName: body.serviceName,
                    title: body.title,
                    participants: {
                        create: (body.participantIds ?? []).map((userId) => ({
                            userId: userId
                        }))
                    }
                },
                include: {
                    participants: true
                }
            })
        }

        async findTopicById(id: number) {
            return this.db.topic.findUnique({
                where : {id: id} 
            })
        }

        async findTopicByIdWithParticipants(id: number) {
            return this.db.topic.findUnique({
                where : {id: id},
                include: {
                    participants: true
                } 
            })
        }


        async isParticipant(topicId: number, userId: number) {
            const participant = await this.db.topicParticipant.findUnique({
                where: {
                    topicId_userId: {topicId, userId}
                }
            })
            return participant !==null
        }

        async addParticipants(topicId: number, userIds: number[]){
            return this.db.topicParticipant.createMany({
                data: (userIds ?? []).map((userId) => ({
                    topicId, userId
                })),
                skipDuplicates: true, // PostgreSQL ignore silencieusement les doublons (ON CONFLICT DO NOTHING) ! 
            })
        }

        async deleteParticipant(topicId: number, userId: number){
            return this.db.topicParticipant.deleteMany({
                where: {
                    topicId,
                    userId
                }
            })
        }
}
export  const topicRepository = new TopicRepository()
