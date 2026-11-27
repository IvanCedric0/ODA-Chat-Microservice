import  jwt  from "jsonwebtoken";
import { env } from "../config/env.js";
import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthenticatedUser } from "../../shared/contracts.js";

const jwks = env.jwtJwksUrl ? 
    createRemoteJWKSet(new URL(env.jwtJwksUrl), {
        cacheMaxAge: 10 * 60_000,
        cooldownDuration: 30_000
    }) :
    null


const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
      return typeof value === 'string' && UUID_REGEX.test(value);
}



async function verifyWithJwks(token: string) {
    const {payload} = await jwtVerify(token, jwks!, {
        issuer: env.jwtIssuer,
        audience: env.jwtAudience,
        algorithms: ['RS256'],
        typ: 'at+jwt'
    })

    return payload
}

function extractIdentityUser(payload: Record<string, unknown>): AuthenticatedUser {
    if (payload.token_use !== 'access') {
        throw new Error('UNAUTHORIZED_INVALID_TOKEN_USE');
    }

    if (typeof payload.sub === 'string' && payload.sub === payload.client_id) {
        throw new Error('UNAUTHORIZED_CLIENT_TOKEN_NOT_ALLOWED');
    }

    if (payload.membership === 'VISITOR' && payload.pfa !== true) {
        throw new Error('FORBIDDEN_VISITOR');
    }

    if (!isUuid(payload.sub) || !isUuid(payload.tid)) {
        throw new Error('UNAUTHORIZED_INVALID_CLAIMS');
    }

    return {
        userId: payload.sub.toLowerCase(),
        tenantId: payload.tid.toLowerCase(),
        ...(typeof payload.tenant === 'string' ? { tenantSlug: payload.tenant } : {}),
        ...(isUuid(payload.sid) ? { sessionId: payload.sid.toLowerCase() } : {}),
        roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
        perms: Array.isArray(payload.perms) ? payload.perms.map(String) : [],
        ...(typeof payload.membership === 'string' ? { membership: payload.membership } : {}),
        isPlatformAdmin: payload.pfa === true,
    };
}
                                                          

export async function verifyJwtToken(token: string): Promise<AuthenticatedUser | null> {
    try {
        if (jwks) {
            const payload = await verifyWithJwks(token)
            return extractIdentityUser(payload)
        }

        if (env.nodeEnv === 'production' || !env.jwtSecret) {
            return null
        }

        const payload = jwt.verify(token, env.jwtSecret)
        if (typeof payload === 'object' && payload !== null){
            return extractIdentityUser(payload)
        }
        return null
    } catch (err: unknown)  {
        if (err instanceof Error && err.message === 'FORBIDDEN_VISITOR') {
            throw err
        }
        return null
    }
}

export async function verifyUserToken(authHeader?: string): Promise<AuthenticatedUser>{
    
    if(!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('UNAUTHORIZED_MISSING_TOKEN');
    }
    
    const token = authHeader.slice(7);

    const user = await verifyJwtToken(token) 
    
    if (user === null) {throw new Error('UNAUTHORIZED_MISSING_TOKEN');}
    
    return user
} 

export function verifyServiceKey(apiKeyHeader?: string | string[]): void {
    if (typeof apiKeyHeader !== 'string' ){
        throw new Error('UNAUTHORIZED_INVALID_SERVICE_KEY')
    }
    
    const received = Buffer.from(apiKeyHeader)
    const expected = Buffer.from(env.serviceKey)

    if (received.length !== expected.length || !timingSafeEqual(received, expected)){
        throw new Error('UNAUTHORIZED_INVALID_SERVICE_KEY')
    }
}