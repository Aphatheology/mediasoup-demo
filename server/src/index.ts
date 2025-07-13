import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import https from "https";
import url from "url";
import os from "os";
import cors from "cors";
import mediasoup from "mediasoup";
import protoo from "protoo-server";
import { setupProtooHandlers } from "./protoo.js";

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

// Protoo WebSocket server
let protooWebSocketServer: protoo.WebSocketServer;

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

// Initialize protoo WebSocket server
const runProtooWebSocketServer = async (): Promise<void> => {
  console.log('Running protoo WebSocketServer...');

  // Create the protoo WebSocket server
  protooWebSocketServer = new protoo.WebSocketServer(server, {
    maxReceivedFrameSize: 960000, // ~960 KBytes
    maxReceivedMessageSize: 960000,
    fragmentOutgoingMessages: false,
    fragmentationThreshold: Infinity,
  });

  // Handle protoo connection requests
  protooWebSocketServer.on('connectionrequest', (info, accept, reject) => {
    const u = url.parse(info.request.url, true);
    const roomId = u.query['roomId'] as string;
    const peerId = u.query['peerId'] as string;

    if (!roomId || !peerId) {
      reject(400, 'Connection request without roomId and/or peerId');
      return;
    }

    console.log(
      'protoo connection request [roomId:%s, peerId:%s, address:%s, origin:%s]',
      roomId, peerId, info.socket.remoteAddress, info.origin
    );

    try {
      // Accept the protoo WebSocket connection
      const protooWebSocketTransport = accept();
      setupProtooHandlers(protooWebSocketTransport, roomId, peerId, getMediasoupWorker);
    } catch (error) {
      console.error('Error accepting protoo connection:', error);
      reject(500, 'Internal server error');
    }
  });
};

// Setup protoo WebSocket server
await runProtooWebSocketServer();

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});