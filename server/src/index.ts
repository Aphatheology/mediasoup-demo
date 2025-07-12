import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mediasoup from "mediasoup";
import { setupSocketHandlers } from "./socket.js";

const app = express();
const port = 4000;
const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

app.get('/', (_, res) => {
  res.send('🎉 Mediasoup server is up and running!');
});

const io = new Server(server, {
  cors: {
    origin: "*",
    credentials: true,
  },
});

const peers = io.of("/mediasoup");

let worker: mediasoup.types.Worker<mediasoup.types.AppData>;

const createWorker = async (): Promise<mediasoup.types.Worker<mediasoup.types.AppData>> => {
  const newWorker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2100,
  });
  newWorker.on("died", () => {
    console.error("Worker died, exiting...");
    setTimeout(() => process.exit(1), 2000);
  });
  return newWorker;
};

// Initialize worker
worker = await createWorker();

// Setup socket handlers
peers.on("connection", (socket) => {
  setupSocketHandlers(socket, worker);
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});