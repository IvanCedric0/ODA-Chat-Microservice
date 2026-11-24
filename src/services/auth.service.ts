import  jwt  from "jsonwebtoken";
import { env } from "../config/env.js";

export function decodeUserId(token: string): number | null {
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