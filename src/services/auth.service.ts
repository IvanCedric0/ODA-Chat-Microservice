import  jwt  from "jsonwebtoken";
import { env } from "../config/env.js";
import { timingSafeEqual } from "node:crypto";

export function verifyJwtToken(token: string): number | null {
    try {
        const decoded = jwt.verify(token, env.jwtSecret)
        if (typeof decoded === 'object' && decoded !== null){
            const rawId = decoded.sub ?? decoded.userId
            const userId = Number(rawId)
            return !Number.isNaN(userId) ? userId : null
        }
        return null
    } catch (err: any)  {
        return null
    }
}

export function verifyUserToken(authHeader?: string): number{
    if(!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('UNAUTHORIZED_MISSING_TOKEN');
    }
    
    const token = authHeader.slice(7);
    const userId = verifyJwtToken(token) 
    
    if (!userId) throw new Error('UNAUTHORIZED_MISSING_TOKEN');
    return userId
} 

export function verifyServiceKey(apiKeyHeader?: string | string[]): void {
    if (typeof apiKeyHeader !== 'string' ){
        throw new Error('UNAUTHORIZED_INVALID_SERVICE_KEY')
    }
    
    const received = Buffer.from(apiKeyHeader)
    const expected = Buffer.from(env.serviceKey)

    if (received.length !== expected.length || timingSafeEqual(received, expected)){
        throw new Error('UNAUTHORIZED_INVALID_SERVICE_KEY')
    }
}