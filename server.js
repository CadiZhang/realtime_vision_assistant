import Fastify from "fastify";
import FastifyVite from "@fastify/vite";
import fastifyEnv from "@fastify/env";
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'crypto';
import { writeFile, unlink, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import fastifyMultipart from '@fastify/multipart'
import fs from 'fs/promises';
import OpenAI from 'openai';

// Fastify + React + Vite configuration
const server = Fastify({
  logger: {
    transport: {
      target: "@fastify/one-line-logger",
    },
  },
});

const schema = {
  type: "object",
  required: ["OPENAI_API_KEY"],
  properties: {
    OPENAI_API_KEY: {
      type: "string",
    },
  },
};

await server.register(fastifyEnv, { dotenv: true, schema });

await server.register(FastifyVite, {
  root: import.meta.url,
  renderer: "@fastify/react",
});

await server.vite.ready();

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const UPLOAD_DIR = join(__dirname, 'uploads');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Setup upload directory
try {
  await mkdir(UPLOAD_DIR, { recursive: true });
  console.log("Upload directory ready:", UPLOAD_DIR);
} catch (err) {
  console.error("Error creating upload directory:", err);
  process.exit(1); // Exit if we can't create upload directory
}

// Register multipart for file uploads
await server.register(fastifyMultipart);

// Register static file serving
await server.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/',
  logLevel: 'debug'
});

// Server-side API route to return an ephemeral realtime session token
server.get("/token", async (request, reply) => {
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "verse",
        tools: [
          {
            type: "function",
            name: "take_photo",
            description: "Take a photo when the user asks to capture an image or analyze what they're looking at",
            parameters: {
              type: "object",
              strict: true,
              properties: {},
              required: [],
            },
          }
        ],
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get token: ${response.statusText}`);
    }

    const data = await response.json();
    return reply.send(data);
  } catch (error) {
    console.error("Token generation failed:", error);
    return reply.code(500).send({ error: "Failed to generate session token" });
  }
});

// Vision analysis endpoint
server.post("/analyze-image", async (request, reply) => {
  try {
    const { imageData } = request.body;
    if (!imageData) {
      return reply.code(400).send({ error: "Image data is required" });
    }

    console.log("Analyzing image data...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            {
              type: "image_url",
              image_url: {
                url: imageData, // OpenAI API accepts base64 data URLs directly
              },
            },
          ],
        },
      ],
      store: true,
    });

    console.log("Vision analysis response:", response.choices[0]);
    return reply.send(response.choices[0]);
  } catch (error) {
    console.error("Vision analysis failed:", error);
    return reply.code(500).send({ 
      error: "Vision analysis failed",
      details: error.message 
    });
  }
});

// Utility endpoint to check uploads (development only)
if (process.env.NODE_ENV === 'development') {
  server.get('/list-uploads', async (request, reply) => {
    try {
      const files = await readdir(UPLOAD_DIR);
      return reply.send({ 
        uploadDir: UPLOAD_DIR,
        files: files 
      });
    } catch (error) {
      console.error("Error listing uploads:", error);
      return reply.code(500).send({ 
        error: 'Failed to list uploads',
        details: error.message 
      });
    }
  });
}

// Start the server
const port = process.env.PORT || 3000;
try {
  await server.listen({ port });
  console.log(`Server listening on port ${port}`);
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}

