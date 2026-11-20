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

export interface ClientToServerEvents {
    send_message: (payload: {topicId: number; content: string}) => void;
    join_topic: (payload: {topicId: number}) =>  void;
    delete_message: (payload : {topicId: number; messageId: number}) => void;
}

export interface ServerToClientEvents {
    new_message: (message: MessageDTO) => void;
    room_joined: (payload: {topicId: number; history: MessageDTO[]}) =>  void;
    message_deleted: (payload : {topicId: number; messageId: number}) => void;
    error_event: (payload: {code: string; message: string}) => void;
}

export interface CreateTopicInput {
    serviceName: string;
    title: string;
    participants: number[]
}
export interface CreateMessageInput {
    topicId: number;
    senderId:number;
    content: string;
}

export interface FindMessageQuery{
    topicId: number;
    limit?: number;
    beforeId?: bigint   | number;
}