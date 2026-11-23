
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import {prisma} from "../config/prisma.js"
import type { CreateMessageInput, FindMessageQuery } from "../../shared/contracts.js";

export class MessageRepository {
    constructor(private db: PrismaClient = prisma){}

    async createMessage(input: CreateMessageInput){ 
        return this.db.message.create({
            data: {
                topicId: input.topicId,
                senderId: input.senderId,
                content: input.content
            }
        })
    }

    async findMessagesByTopic(query: FindMessageQuery){
       
        const where: Prisma.MessageWhereInput = {
            topicId: query.topicId
        }
        
        // 2. Si beforeId est fourni, on filtre les messages avec un ID strictement inférieur (<)
        if (query.beforeId !== undefined) {
            where.id = {lt: BigInt(query.beforeId)}
        }

        return this.db.message.findMany({
            where: where,
            orderBy: {id: 'desc'},
            take: query.limit ?? 50,
        })
    }

    // Pour permettre au service de vérifier si le message existe et si l'utilisateur qui demande la suppression en est bien l'auteur (senderId === currentUserId).
    async findMessageById(messageId: bigint | number){
        return this.db.message.findUnique({
            where: {id: messageId}
        })
    }

    async softDeleteMessage(messageId: bigint | number){
        return this.db.message.update({
            where: {id: messageId},
            data: {isDeleted: true}
        })
    }

}
 export const messageRepository = new MessageRepository()