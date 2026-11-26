import type { Socket } from "socket.io";
import { verifyJwtToken } from "../services/auth.service.js"
import type { ServerToClientEvents, ClientToServerEvents } from "../../shared/contracts.js";

export interface SocketData {
    userId: number
}

export type AuthenticatedSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
>

export function socketAuthMiddleware(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void
) {
    const token = socket.handshake.auth?.token

    if(typeof token !== 'string' || !token) {
        return next(new Error('Unauthorized: Missing token'))
    }

    const userId = verifyJwtToken(token)
    if (!userId) {
        return next(new Error('Unauthorized: Invalid token'))
    }

    socket.data.userId = userId
    return next()
}
