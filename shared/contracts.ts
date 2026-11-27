export interface MessageDTO {
    id: number;
    topicId: number;
    senderId: string;
    content: string;
    isDeleted: boolean;
    createdAt: string;
}

export interface TopicDTO {
    id: number;
    tenantId: string;
    serviceName: string;
    title: string;
    participantIds: string[];
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
    tenantId: string;
    serviceName: string;
    title: string;
    participantIds: string[];
}
export interface CreateMessageInput {
    topicId: number;
    senderId: string;
    content: string;
}

export interface FindMessageQuery{
    topicId: number;
    limit?: number;
    beforeId?: bigint | number | undefined;
}

export interface AuthenticatedUser {
  userId: string;      // payload.sub (UUID)
  tenantId: string;    // payload.tid (UUID)
  tenantSlug?: string; // payload.tenant
  sessionId?: string;  // payload.sid (UUID, utile pour révocation)
  roles: string[];
  perms: string[];
  membership?: string; // 'ACADEMICIAN' | 'VISITOR'
  isPlatformAdmin: boolean; // Boolean(payload.pfa)
}