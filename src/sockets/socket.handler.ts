import type { Server } from "socket.io";
import { messageService } from "../services/message.service.js";
import { topicService } from "../services/topic.service.js";
import type {
    ClientToServerEvents,
    MessageDTO,
    ServerToClientEvents,
} from "../../shared/contracts.js";
import type { AuthenticatedSocket, SocketData } from "./socket.auth.js";

export type ChatServer = Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
>;

export type BufferedRoomEvent =
    | { type: "new_message"; payload: MessageDTO }
    | { type: "message_deleted"; payload: { topicId: number; messageId: number } };

// Buffers live events per (roomName -> socketId) while a socket is loading initial history
const joiningBuffers = new Map<string, Map<string, BufferedRoomEvent[]>>();

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

function startJoinBuffer(roomName: string, socketId: string): void {
    let roomBuffers = joiningBuffers.get(roomName);
    if (!roomBuffers) {
        roomBuffers = new Map();
        joiningBuffers.set(roomName, roomBuffers);
    }
    roomBuffers.set(socketId, []);
}

function takeJoinBuffer(roomName: string, socketId: string): BufferedRoomEvent[] {
    const roomBuffers = joiningBuffers.get(roomName);
    if (!roomBuffers) return [];
    const events = roomBuffers.get(socketId) ?? [];
    roomBuffers.delete(socketId);
    if (roomBuffers.size === 0) {
        joiningBuffers.delete(roomName);
    }
    return events;
}

function clearAllJoinBuffersForSocket(socketId: string): void {
    for (const [roomName, roomBuffers] of joiningBuffers.entries()) {
        roomBuffers.delete(socketId);
        if (roomBuffers.size === 0) {
            joiningBuffers.delete(roomName);
        }
    }
}

function emitToTopic(io: ChatServer, roomName: string, event: BufferedRoomEvent): void {
    const roomBuffers = joiningBuffers.get(roomName);
    const bufferingSocketIds: string[] = [];

    if (roomBuffers) {
        for (const [socketId, queue] of roomBuffers.entries()) {
            queue.push(event);
            bufferingSocketIds.push(socketId);
        }
    }

    const target = bufferingSocketIds.length > 0
        ? io.to(roomName).except(bufferingSocketIds)
        : io.to(roomName);

    if (event.type === "new_message") {
        target.emit("new_message", event.payload);
    } else {
        target.emit("message_deleted", event.payload);
    }
}

export function mergeHistoryAndBuffer(
    history: MessageDTO[],
    bufferedEvents: BufferedRoomEvent[]
): MessageDTO[] {
    const byId = new Map<number, MessageDTO>();
    for (const msg of history) {
        byId.set(msg.id, msg);
    }

    for (const event of bufferedEvents) {
        if (event.type === "new_message") {
            // Never overwrite an existing DB history row (e.g. already soft-deleted via REST)
            if (!byId.has(event.payload.id)) {
                byId.set(event.payload.id, event.payload);
            }
        } else {
            const existing = byId.get(event.payload.messageId);
            if (existing) {
                byId.set(existing.id, {
                    ...existing,
                    content: "",
                    isDeleted: true,
                });
            }
        }
    }

    return Array.from(byId.values()).sort((a, b) => b.id - a.id);
}

export function emitMessageDeleted(
    io: ChatServer,
    topicId: number,
    messageId: number
): void {
    emitToTopic(io, `topic_${topicId}`, {
        type: "message_deleted",
        payload: { topicId, messageId },
    });
}

export async function evictUserFromTopic(
    io: ChatServer,
    topicId: number,
    userId: number
): Promise<void> {
    const roomName = `topic_${topicId}`;
    const sockets = await io.in(roomName).fetchSockets();

    for (const s of sockets) {
        if (s.data.userId === userId) {
            takeJoinBuffer(roomName, s.id);
            s.emit("error_event", {
                code: "REMOVED_FROM_TOPIC",
                message: "Vous avez été retiré de ce salon",
            });
            s.leave(roomName);
        }
    }
}

export function registerChathandlers(io: ChatServer) {
    io.on("connection", (socket: AuthenticatedSocket) => {
        const userId = socket.data.userId;

        socket.on("disconnect", () => {
            clearAllJoinBuffersForSocket(socket.id);
        });

        socket.on("join_topic", async (payload) => {
            let roomName: string | null = null;
            try {
                const data = asRecord(payload);
                const topicId = parsePositiveInt(data?.topicId);
                if (!topicId) {
                    socket.emit("error_event", {
                        code: "INVALID_PAYLOAD",
                        message: "topicId invalide",
                    });
                    return;
                }

                // 1. Vérifier l'accès avant de souscrire ou de mettre en tampon
                await topicService.ensureParticipant(topicId, userId);

                const targetRoom = `topic_${topicId}`;
                if (joiningBuffers.get(targetRoom)?.has(socket.id)) {
                    return;
                }

                roomName = targetRoom;

                // 2. Activer le buffer AVANT les awaits suivants et rejoindre la room
                startJoinBuffer(roomName, socket.id);
                await socket.join(roomName);

                // 3. Charger l'historique pendant que les événements temps réel sont mis en tampon
                const history = await messageService.getTopicMessages(topicId, userId, 50);

                // 4. Re-vérifier l'accès après les opérations asynchrones (retrait en cours)
                const stillMember = await topicService.isParticipant(topicId, userId);
                if (!stillMember || !socket.connected || !socket.rooms.has(roomName)) {
                    takeJoinBuffer(roomName, socket.id);
                    await socket.leave(roomName);
                    socket.emit("error_event", {
                        code: "FORBIDDEN_NOT_PARTICIPANT",
                        message: "Accès refusé à ce salon",
                    });
                    return;
                }

                // 5. Fusionner l'historique et les événements bufferisés par ID (sans await ici)
                const bufferedEvents = takeJoinBuffer(roomName, socket.id);
                const mergedHistory = mergeHistoryAndBuffer(history, bufferedEvents);

                socket.emit("room_joined", { topicId, history: mergedHistory });
            } catch (err: any) {
                if (roomName) {
                    takeJoinBuffer(roomName, socket.id);
                    await socket.leave(roomName);
                }
                socket.emit("error_event", {
                    code: err?.message || "JOIN_TOPIC_ERROR",
                    message: "Impossible de rejoindre ce salon",
                });
            }
        });

        socket.on("send_message", async (payload) => {
            try {
                const data = asRecord(payload);
                const topicId = parsePositiveInt(data?.topicId);
                const content = typeof data?.content === "string" ? data.content : null;

                if (!topicId || content === null) {
                    socket.emit("error_event", {
                        code: "INVALID_PAYLOAD",
                        message: "topicId et content requis",
                    });
                    return;
                }

                const messageDto = await messageService.postMessage(topicId, userId, content);
                const roomName = `topic_${messageDto.topicId}`;

                emitToTopic(io, roomName, { type: "new_message", payload: messageDto });
            } catch (err: any) {
                socket.emit("error_event", {
                    code: err?.message || "SEND_MESSAGE_ERROR",
                    message: "Impossible d'envoyer le message",
                });
            }
        });

        socket.on("delete_message", async (payload) => {
            try {
                const data = asRecord(payload);
                const messageId = parsePositiveInt(data?.messageId);
                if (!messageId) {
                    socket.emit("error_event", {
                        code: "INVALID_PAYLOAD",
                        message: "messageId invalide",
                    });
                    return;
                }

                const deletedMessageDto = await messageService.deleteMessage(messageId, userId);

                if (!messageService.onMessageDeleted) {
                    emitMessageDeleted(io, deletedMessageDto.topicId, deletedMessageDto.id);
                }
            } catch (err: any) {
                socket.emit("error_event", {
                    code: err?.message || "DELETE_MESSAGE_ERROR",
                    message: "Impossible de supprimer le message",
                });
            }
        });
    });
}
