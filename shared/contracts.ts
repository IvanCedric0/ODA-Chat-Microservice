export interface MessageDTO {
    id: number;
    topicId: number;
    senderId: number;
    content: string;
    isDeleted: boolean;
    createdAt: string;
}

export interface TopicDTO {
    id: number;
    serviceName: string;
    title: string;
    particpantsIds: number[]
}