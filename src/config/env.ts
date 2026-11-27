import 'dotenv/config'

function getEnv(key:string, fallback?: string):string {
    const value = process.env[key] ?? fallback
    if(value === undefined) {
        throw new Error(`Missing required environment variable: ${key}`)
    }
    return value
}

function getOptionalEnv(key: string): string | undefined {
    const value = process.env[key]?.trim()
    return value ? value : undefined
}

const nodeEnv = getEnv('NODE_ENV', 'development')
const rawOrigins = getEnv('ALLOWED_ORIGINS', 'http://localhost:5173')
const jwtJwksUrl = getOptionalEnv('JWT_JWKS_URL')
const jwtSecret = getOptionalEnv('JWT_SECRET')

if (nodeEnv === 'production' && !jwtJwksUrl) {
    throw new Error('Missing required environment variable in production: JWT_JWKS_URL')
}

if (!jwtJwksUrl && !jwtSecret) {
    throw new Error('Missing JWT configuration: set JWT_JWKS_URL (or JWT_SECRET for non-production fallback)')
}

export const env = {
    nodeEnv,
    port: getEnv('PORT', '3000'),
    host: getEnv('HOST', '0.0.0.0'),
    databaseUrl: getEnv('DATABASE_URL'),
    jwtSecret,
    serviceKey: getEnv('SERVICE_API_KEY'),
    allowedOrigins: rawOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
    jwtJwksUrl,
    jwtIssuer: getEnv('JWT_ISSUER', 'http://localhost/api/identity'),
    jwtAudience: getEnv('JWT_AUDIENCE', 'odc-campus')
} as const