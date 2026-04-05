import "dotenv/config";

import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { Server as SocketIOServer } from "socket.io";

import { execute } from "./config/db.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import adminRouter from "./routes/admin.routes.js";
import routes from "./routes/index.js";
import { startNotificationAutomation } from "./services/notificationAutomation.service.js";
import { setRealtimeServer } from "./services/realtimeGateway.service.js";
import { registerLigueSockets } from "./sockets/ligue.socket.js";
import { registerNotificationSockets } from "./sockets/notification.socket.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  await fs.mkdir(path.join(__dirname, "public", "uploads", "users"), {
    recursive: true,
  });

  const app = express();

  if (env.TRUST_PROXY) {
    app.set("trust proxy", 1);
  }

  app.disable("x-powered-by");
  app.set("views", path.join(__dirname, "views"));
  app.set("view engine", "ejs");

  const corsOrigins =
    env.CORS_ORIGIN === "*"
      ? true
      : env.CORS_ORIGIN.split(",").map((s) => s.trim());

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.use(express.static(path.join(__dirname, "public")));

  app.get("/", (_req, res) => res.redirect("/admin"));
  app.use("/admin", adminRouter);
  app.use("/api", routes);
  app.use("/", routes);

  app.use(notFound);
  app.use(errorHandler);

  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
  });

  setRealtimeServer(io);
  registerLigueSockets(io);
  registerNotificationSockets(io);
  startNotificationAutomation();

  httpServer.listen(env.PORT, "0.0.0.0", async () => {
    console.log(
      `ishiine-online API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
    );

    try {
      await execute("SELECT 1 AS ok", []);
      console.log("[db] connecte");
    } catch (err) {
      console.error("[db] erreur de connexion");

      if (env.DB_DEBUG) {
        console.error("[db] details", {
          code: err?.code,
          message: err?.message,
          host: env.DB_HOST,
          port: env.DB_PORT,
          user: env.DB_USER,
          database: env.DB_NAME,
        });
      }
    }
  });
}

start().catch((err) => {
  console.error("[bootstrap] startup failed", {
    code: err?.code,
    message: err?.message,
    stack: err?.stack,
  });
  process.exit(1);
});

