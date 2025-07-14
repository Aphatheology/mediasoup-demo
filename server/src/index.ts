import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import os from "os";
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

// mediasoup Workers array
const mediasoupWorkers: mediasoup.types.Worker<mediasoup.types.AppData>[] = [];

// Index of next mediasoup Worker to use (round-robin)
let nextMediasoupWorkerIdx = 0;

const createWorker = async (workerIndex: number): Promise<mediasoup.types.Worker<mediasoup.types.AppData>> => {
  // Calculate port range for this worker to avoid conflicts
  const portRange = 100; // 100 ports per worker
  const rtcMinPort = 2000 + (workerIndex * portRange);
  const rtcMaxPort = rtcMinPort + portRange - 1;

  console.log(`Creating worker ${workerIndex} with RTC ports ${rtcMinPort}-${rtcMaxPort}`);

  const newWorker = await mediasoup.createWorker({
    rtcMinPort,
    rtcMaxPort,
  });

  newWorker.on("died", () => {
    console.error(`Worker ${workerIndex} died, exiting in 5 seconds... [pid:${newWorker.pid}]`);
    setTimeout(() => process.exit(1), 5000);
  });

  return newWorker;
};

// Get next worker using round-robin
const getMediasoupWorker = (): mediasoup.types.Worker<mediasoup.types.AppData> => {
  const worker = mediasoupWorkers[nextMediasoupWorkerIdx];
  
  if (++nextMediasoupWorkerIdx === mediasoupWorkers.length) {
    nextMediasoupWorkerIdx = 0;
  }
  
  return worker;
};

// Initialize multiple workers
const runMediasoupWorkers = async (): Promise<void> => {
  const numWorkers = os.cpus().length;
  
  console.log(`Running ${numWorkers} mediasoup Workers...`);
  
  for (let i = 0; i < numWorkers; i++) {
    const worker = await createWorker(i);
    mediasoupWorkers.push(worker);
    
    // Log worker resource usage every 2 minutes
    setInterval(async () => {
      try {
        const usage = await worker.getResourceUsage();
        // console.log(`Worker ${i} resource usage [pid:${worker.pid}]:`, usage);
      } catch (error) {
        console.error(`Error getting worker ${i} usage:`, error);
      }
    }, 120000);
  }
  
  console.log(`Successfully created ${mediasoupWorkers.length} workers`);
};

// Initialize workers
await runMediasoupWorkers();

// Setup socket handlers with worker selection
peers.on("connection", (socket) => {
  setupSocketHandlers(socket, getMediasoupWorker);
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});