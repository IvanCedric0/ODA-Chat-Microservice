import type{ Topic, TopicParticipant, Message } from "../generated/prisma/client.js";
import type { TopicDTO, MessageDTO } from "../../shared/contracts.js";

type TopicWithParticipants = Topic & {participants: TopicParticipant[]}

export function toTopicDTO(topic: TopicWithParticipants): TopicDTO {
    return {
        id: topic.id,
        tenantId: topic.tenantId,
        serviceName: topic.serviceName,
        title: topic.title,
        participantIds: topic.participants.map((p) => p.userId) ?? []
    }
}

export function toMessageDTO(message: Message): MessageDTO {
    return {
        id: Number(message.id),
        topicId: message.topicId,
        senderId: message.senderId,
        content: message.isDeleted ? '' : message.content,
        isDeleted: message.isDeleted,
        createdAt: message.createdAt.toISOString()
    }
}