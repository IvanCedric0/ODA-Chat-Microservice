import type { Socket } from "socket.io";
import { verifyJwtToken } from "../services/auth.service.js"
import type { ServerToClientEvents, ClientToServerEvents } from "../../shared/contracts.js";

export interface SocketData {
    userId: string,
    tenantId: string,
    sessionId?: string
}

export type AuthenticatedSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
>

export async function socketAuthMiddleware(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void
) {
    const token = socket.handshake.auth?.token

    if(typeof token !== 'string' || !token) {
        return next(new Error('Unauthorized: Missing token'))
    }

    try {
        const user = await verifyJwtToken(token)

        if (!user) return next(new Error('Unauthorized: Invalid token'))

        socket.data.userId = user.userId
        socket.data.tenantId = user.tenantId
        if (user.sessionId) socket.data.sessionId = user.sessionId

        return next()
    } catch (err: unknown) {
        if (err instanceof Error && err.message === 'FORBIDDEN_VISITOR') {
            return next(new Error('Forbidden: VISITOR account'))
        }
        return next(new Error('Unauthorized: Invalid token'))
    }
}
