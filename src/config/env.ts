import 'dotenv/config'

function getEnv(key:string, fallback?: string):string {
    const value = process.env[key] ?? fallback
    if(value === undefined) {
        throw new Error(`Missing required environment variable: ${key}`)
    }
    return value
}

const rawOrigins = getEnv('ALLOWED_ORIGINS', 'http://localhost:5173')

export const env = {
    nodeEnv: getEnv('NODE_ENV', 'development'),
    port: getEnv('PORT', '3000'),
    host: getEnv('HOST', '0.0.0.0'),
    databaseUrl: getEnv('DATABASE_URL'),
    jwtSecret: getEnv('JWT_SECRET'),
    serviceKey: getEnv('SERVICE_API_KEY'),
    allowedOrigins: rawOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
} as const