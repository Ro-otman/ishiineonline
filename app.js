import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { Server as SocketIOServer } from "socket.io";

dotenv.config();

const { env } = await import("./config/env.js");
const { execute } = await import("./config/db.js");
const routes = (await import("./routes/index.js")).default;
const { notFound } = await import("./middlewares/notFound.js");
const { errorHandler } = await import("./middlewares/errorHandler.js");
const { registerLigueSockets } = await import("./sockets/ligue.socket.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await fs.mkdir(path.join(__dirname, "public", "uploads", "users"), {
  recursive: true,
});

const app = express();

if (env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

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

// Static (uploads)
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => res.redirect("/health"));

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

registerLigueSockets(io);

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
