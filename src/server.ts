import 'dotenv/config';
import { env } from './config/env.js';
import { buildChatServer } from './app.js';

const { app } = buildChatServer();

await app.listen({ port: env.port, host: env.host });
