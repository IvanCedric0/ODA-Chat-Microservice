import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyUserToken, verifyServiceKey } from "../services/auth.service.js";
import type { AuthenticatedUser } from "../../shared/contracts.js";

declare module 'fastify' {
    interface FastifyRequest {
        userId?: string,
        authUser?: AuthenticatedUser 
    }
}

// Guard 1: For End-User routes (messages.routes.ts)
export async function requireUserAuth(request: FastifyRequest, reply: FastifyReply) {
   try {

    const user = await verifyUserToken(request.headers.authorization)
    request.userId = user.userId
    request.authUser = user
   } catch (err: unknown) {
    if (err instanceof Error && err.message === 'FORBIDDEN_VISITOR') {
        return reply.code(403).send({error: 'FORBIDDEN_VISITOR'})
    }
    return reply.code(401).send({error: 'Invalid or missing user JWT'})
   }
}

// Guard 2: For Service-to-Service routes (topics.routes.ts)
export async function requireServiceAuth(request: FastifyRequest, reply: FastifyReply) {
   try {
        const key = request.headers['x-service-key'] 
        verifyServiceKey(key)
    } catch {
        return reply.code(401).send({error: 'Invalid or missing service API key'})
    }
}