import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyUserToken, verifyServiceKey } from "../services/auth.service.js";

declare module 'fastify' {
    interface FastifyRequest {
        userId?: number
    }
}

// Guard 1: For End-User routes (messages.routes.ts)
export async function requireUserAuth(request: FastifyRequest, reply: FastifyReply) {
   try {
    request.userId = verifyUserToken(request.headers.authorization)
   } catch {
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