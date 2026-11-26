import type { Server } from "socket.io";
import { messageService } from "../services/message.service.js";
import type { ClientToServerEvents, ServerToClientEvents } from "../../shared/contracts.js";
import type { AuthenticatedSocket, SocketData } from "./socket.auth.js";

export type ChatServer = Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
>;

function parsePositiveInt(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const num = Number(value);
    return Number.isInteger(num) && num > 0 ? num : null;
}

function asRecord(payload: unknown): Record<string, unknown> | null {
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
}

export function registerChathandlers(io: ChatServer){
    io.on('connection', (socket: AuthenticatedSocket) => {
        const userId = socket.data.userId

        socket.on('join_topic', async (payload) => {
            try {
                const data = asRecord(payload)
                const topicId = parsePositiveInt(data?.topicId)
                if (!topicId) {
                    socket.emit('error_event', {
                        code: "INVALID_PAYLOAD",
                        message: "topicId invalide"
                    })
                    return
                }

                const history = await messageService.getTopicMessages(topicId, userId, 50)
                const roomName = `topic_${topicId}`

                await socket.join(roomName)
                socket.emit('room_joined', {topicId, history})

            } catch (err:any) {
                socket.emit('error_event', {
                    code: err?.message || "JOIN_TOPIC_ERROR",
                    message: "Impossible de rejoindre ce salon"
                })
            } 
        })

        socket.on('send_message', async (payload) => {
            try {
                const data = asRecord(payload)
                const topicId = parsePositiveInt(data?.topicId)
                const content = typeof data?.content === 'string' ? data.content : null

                if (!topicId || content === null) {
                    socket.emit('error_event', {
                        code: "INVALID_PAYLOAD",
                        message: "topicId et content requis"
                    })
                    return
                }

                const messageDto = await messageService.postMessage(topicId, userId, content) 

                const roomName = `topic_${messageDto.topicId}`
                io.to(roomName).emit('new_message', messageDto)
            } catch(err: any) {
                socket.emit('error_event', {
                    code: err?.message || "SEND_MESSAGE_ERROR",
                    message: "Impossible d'envoyer le message"
                })
            }
        })

        socket.on('delete_message', async (payload) => {
            try {
                const data = asRecord(payload)
                const messageId = parsePositiveInt(data?.messageId)
                if (!messageId) {
                    socket.emit('error_event', {
                        code: "INVALID_PAYLOAD",
                        message: "messageId invalide"
                    })
                    return
                }

                const deletedMessageDto = await messageService.deleteMessage(messageId, userId)
                const roomName = `topic_${deletedMessageDto.topicId}`

                io.to(roomName).emit('message_deleted', {topicId: deletedMessageDto.topicId, messageId: deletedMessageDto.id})
            } catch(err: any) {
                socket.emit('error_event', {
                    code: err?.message || "DELETE_MESSAGE_ERROR",
                    message: "Impossible de supprimer le message"
                })
            }
        })
    })
}