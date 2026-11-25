import Fastify from "fastify";
import { env } from "./config/env.js";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { healthRoutes } from "./routes/health.routes.js";
import { topicRoutes } from "./routes/topics.routes.js";
import { messageRoutes } from "./routes/messages.routes.js";

const fastify = Fastify({
    logger: true
})

await fastify.register(fastifySwagger, {
    openapi: {
        info: {
            title: 'Chat Microservice',
            version: '1.0.0'
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                },
                serviceApiKey: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-service-key'
                }
            }
        }
    }
})

fastify.register(fastifySwaggerUi, {routePrefix: '/docs',})
fastify.register(healthRoutes)
fastify.register(topicRoutes, {prefix: '/api/v1/topics'})
fastify.register(messageRoutes, {prefix: '/api/v1'})

fastify.listen({port: Number(env.port)}, (error, address) => {
    if (error) {
        fastify.log.error(error)
        process.exit(1)
    }

    fastify.log.info(`server listening on ${address}`)
})