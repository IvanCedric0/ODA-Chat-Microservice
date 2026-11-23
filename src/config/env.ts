import 'dotenv/config'

function getEnv(key:string, fallback?: string):string {
    const value = process.env[key] ?? fallback
    if(value === undefined) {
        throw new Error(`Missing required environment variable: ${key}`)
    }
    return value
}

export const env = {
    nodeEnv: getEnv('NODE_ENV', 'development'),
    port: getEnv('PORT', '3000'),
    databaseUrl: getEnv('DATABASE_URL')
} as const