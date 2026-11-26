import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import { healthRoutes } from "./routes/health.routes.js";
import { topicRoutes } from "./routes/topics.routes.js";
import { messageRoutes } from "./routes/messages.routes.js";
import { socketAuthMiddleware } from "./sockets/socket.auth.js";
import { emitMessageDeleted, evictUserFromTopic, registerChathandlers, type ChatServer } from "./sockets/socket.handler.js";
import { topicService } from "./services/topic.service.js";
import { messageService } from "./services/message.service.js";

function toCorsOriginList(origins: readonly string[]): (string | RegExp)[] {
    return origins.map((origin) => {
        if (!origin.includes("*")) return origin;
        const escaped = origin.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+");
        return new RegExp(`^${escaped}$`);
    });
}

export async function buildServer(options: { logger?: boolean } = {}) {
    const fastify = Fastify({
        logger: options.logger ?? true,
    });

    const corsOrigins = toCorsOriginList(env.allowedOrigins);
    const frameAncestors = ["'self'", ...env.allowedOrigins].join(" ");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = fs.existsSync(path.resolve(__dirname, "../package.json"))
        ? path.resolve(__dirname, "..")
        : path.resolve(__dirname, "../..");
    const publicDir = path.resolve(projectRoot, "public");

    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }

    await fastify.register(fastifyCors, {
        origin: corsOrigins,
        credentials: true,
    });

    await fastify.register(fastifySwagger, {
        openapi: {
            info: {
                title: "Chat Microservice",
                version: "1.0.0",
            },
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT",
                    },
                    serviceApiKey: {
                        type: "apiKey",
                        in: "header",
                        name: "x-service-key",
                    },
                },
            },
        },
    });

    await fastify.register(fastifySwaggerUi, { routePrefix: "/docs" });

    // Protection contre le Clickjacking sur le widget /embed/
    fastify.addHook("onSend", async (request, reply, payload) => {
        if (request.url.startsWith("/embed")) {
            reply.header("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
        }
        return payload;
    });

    await fastify.register(fastifyStatic, {
        root: publicDir,
        prefix: "/embed/",
    });

    await fastify.register(healthRoutes);
    await fastify.register(topicRoutes, { prefix: "/api/v1/topics" });
    await fastify.register(messageRoutes, { prefix: "/api/v1" });

    const io: ChatServer = new Server(fastify.server, {
        cors: {
            origin: corsOrigins,
            credentials: true,
        },
    });

    io.use(socketAuthMiddleware);
    registerChathandlers(io);

    topicService.onParticipantRemoved = (topicId, userId) =>
        evictUserFromTopic(io, topicId, userId);
    messageService.onMessageDeleted = (topicId, messageId) =>
        emitMessageDeleted(io, topicId, messageId);

    fastify.addHook("onClose", async () => {
        topicService.onParticipantRemoved = undefined;
        messageService.onMessageDeleted = undefined;
        await io.close();
    });

    return { fastify, io };
}

const isMainModule =
    Boolean(process.argv[1]) &&
    path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);

async function start() {
    try {
        const { fastify } = await buildServer();
        const address = await fastify.listen({
            port: Number(env.port),
            host: env.host,
        });
        fastify.log.info(`server listening on ${address}`);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

if (isMainModule) {
    void start();
}
