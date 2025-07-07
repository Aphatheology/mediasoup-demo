import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mediasoup from "mediasoup";

const app = express();
const port = 4000;
const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

const io = new Server(server, {
  cors: {
    origin: "*",
    credentials: true,
  },
});

const peers = io.of("/mediasoup");

let worker: mediasoup.types.Worker<mediasoup.types.AppData>;

// Room management
interface Room {
  router: mediasoup.types.Router<mediasoup.types.AppData>;
  peers: Map<string, PeerInfo>;
}

interface PeerInfo {
  socketId: string;
  peerId: string;
  producerTransport?: mediasoup.types.WebRtcTransport<mediasoup.types.AppData>;
  consumerTransports: Map<string, mediasoup.types.WebRtcTransport<mediasoup.types.AppData>>;
  producers: {
    video?: mediasoup.types.Producer<mediasoup.types.AppData>;
    audio?: mediasoup.types.Producer<mediasoup.types.AppData>;
  };
  consumers: Map<string, {
    video?: mediasoup.types.Consumer<mediasoup.types.AppData>;
    audio?: mediasoup.types.Consumer<mediasoup.types.AppData>;
  }>;
}

const rooms = new Map<string, Room>();

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

const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    preferredPayloadType: 96,
    rtcpFeedback: [
      { type: "nack" },
      { type: "nack", parameter: "pli" },
    ],
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 1000 },
    preferredPayloadType: 97,
    rtcpFeedback: [
      { type: "nack" },
      { type: "ccm", parameter: "fir" },
      { type: "goog-remb" },
    ],
  },
  {
    kind: "video",
    mimeType: "video/h264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "4d0032",
    },
    preferredPayloadType: 98,
    rtcpFeedback: [
      { type: "nack" },
      { type: "ccm", parameter: "fir" },
      { type: "goog-remb" },
    ],
  },
];

const getOrCreateRoom = async (roomId: string): Promise<Room> => {
  if (rooms.has(roomId)) {
    return rooms.get(roomId)!;
  }

  const router = await worker.createRouter({ mediaCodecs });
  const room: Room = {
    router,
    peers: new Map(),
  };

  rooms.set(roomId, room);
  console.log(`Created room: ${roomId}`);
  return room;
};

const createWebRtcTransport = async (
  router: mediasoup.types.Router<mediasoup.types.AppData>,
  callback: (arg0: { params: { id: string; iceParameters: mediasoup.types.IceParameters; iceCandidates: mediasoup.types.IceCandidate[]; dtlsParameters: mediasoup.types.DtlsParameters; } | { error: unknown; }; }) => void
) => {
  try {
    const webRtcTransportOptions = {
      listenIps: [{ ip: "0.0.0.0" }], // Removed announcedIp: null
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    const transport = await router.createWebRtcTransport(webRtcTransportOptions);
    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") transport.close();
    });
    transport.on("@close", () => {
      console.log("Transport closed");
    });

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    });

    return transport;
  } catch (error) {
    console.error("Error creating WebRTC transport:", error);
    callback({ params: { error } });
  }
};

// Initialize worker
worker = await createWorker();

peers.on("connection", async (socket) => {
  console.log(`New connection: ${socket.id}`);
  socket.emit("connection-success", { socketId: socket.id });

  let currentRoom: Room | null = null;
  let currentRoomId: string | null = null;
  let currentPeer: PeerInfo | null = null;

  socket.on("join-room", async ({ roomId, peerId }, callback) => {
    try {
      console.log(`Peer ${peerId} joining room ${roomId}`);

      const room = await getOrCreateRoom(roomId);
      currentRoom = room;
      currentRoomId = roomId;

      // Check if peer already exists and remove old instance
      if (room.peers.has(peerId)) {
        const existingPeer = room.peers.get(peerId);
        if (existingPeer) {
          // Clean up old peer
          existingPeer.producerTransport?.close();
          existingPeer.consumerTransports.forEach(transport => transport.close());
          existingPeer.consumers.forEach(consumerGroup => {
            consumerGroup.video?.close();
            consumerGroup.audio?.close();
          });
          existingPeer.producers.video?.close();
          existingPeer.producers.audio?.close();
        }
        room.peers.delete(peerId);
      }

      // Create peer info
      const peerInfo: PeerInfo = {
        socketId: socket.id,
        peerId,
        consumerTransports: new Map(),
        consumers: new Map(),
        producers: {},
      };

      room.peers.set(peerId, peerInfo);
      currentPeer = peerInfo;

      // Join socket to room
      socket.join(roomId);

      // Notify other peers in the room
      socket.to(roomId).emit("peer-joined", { peerId, socketId: socket.id });

      // Send list of existing peers
      const existingPeers = Array.from(room.peers.keys()).filter(id => id !== peerId);

      callback({ success: true, peers: existingPeers });
      console.log(`Peer ${peerId} joined room ${roomId}. Room now has ${room.peers.size} peers.`);
    } catch (error: unknown) {
      console.error("Error joining room:", error);
      callback({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("getRouterRtpCapabilities", ({ roomId }, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: "Room not found" });
      return;
    }
    callback({ routerRtpCapabilities: room.router.rtpCapabilities });
  });

  socket.on("createTransport", async ({ sender, roomId, peerId, producerPeerId }, callback) => {
    const room = rooms.get(roomId);
    const peer = room?.peers.get(peerId);

    if (!room || !peer) {
      callback({ params: { error: "Room or peer not found" } });
      return;
    }

    if (sender) {
      // Create producer transport (one transport can handle both audio and video)
      const transport = await createWebRtcTransport(room.router, callback);
      if (transport) {
        peer.producerTransport = transport;
        console.log(`Producer transport created for peer ${peerId}`);
      }
    } else {
      // Create consumer transport for a specific producer peer
      const transportKey = producerPeerId;
      const transport = await createWebRtcTransport(room.router, callback);
      if (transport && producerPeerId) {
        peer.consumerTransports.set(transportKey, transport);
        console.log(`Consumer transport created for peer ${peerId} consuming from ${producerPeerId}`);
      }
    }
  });

  socket.on("connectProducerTransport", async ({ dtlsParameters, roomId, peerId }) => {
    const room = rooms.get(roomId);
    const peer = room?.peers.get(peerId);

    if (peer?.producerTransport) {
      await peer.producerTransport.connect({ dtlsParameters });
      console.log(`Producer transport connected for peer ${peerId}`);
    }
  });

  socket.on("transport-produce", async ({ kind, rtpParameters, roomId, peerId }, callback) => {
    const room = rooms.get(roomId);
    const peer = room?.peers.get(peerId);

    if (!room || !peer?.producerTransport) {
      callback({ error: "Transport not found" });
      return;
    }

    try {
      const producer = await peer.producerTransport.produce({ kind, rtpParameters });

      // Store producer by kind (video or audio)
      if (kind === 'video') {
        peer.producers.video = producer;
      } else if (kind === 'audio') {
        peer.producers.audio = producer;
      }

      producer.on("transportclose", () => {
        console.log(`Producer transport closed for peer ${peerId}, kind: ${kind}`);
        producer.close();
      });

      callback({ id: producer.id });

      // Notify other peers in the room about new producer - with delay
      setTimeout(() => {
        socket.to(roomId).emit("new-producer", { producerPeerId: peerId, kind });
        console.log(`Notified room about new ${kind} producer from ${peerId}`);
      }, 500);

      console.log(`Producer created for peer ${peerId}, kind: ${kind}`);
    } catch (error: unknown) {
      console.error("Error creating producer:", error);
      callback({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  socket.on("connectConsumerTransport", async ({ dtlsParameters, roomId, peerId, producerPeerId }) => {
    const room = rooms.get(roomId);
    const peer = room?.peers.get(peerId);

    if (peer) {
      const transportKey = producerPeerId;
      const consumerTransport = peer.consumerTransports.get(transportKey);
      if (consumerTransport) {
        await consumerTransport.connect({ dtlsParameters });
        console.log(`Consumer transport connected for peer ${peerId} consuming from ${producerPeerId}`);
      } else {
        console.error(`Consumer transport not found for key: ${transportKey}`);
      }
    }
  });

  socket.on("consumeMedia", async ({ rtpCapabilities, roomId, peerId, producerPeerId, kind }, callback) => {
    const room = rooms.get(roomId);
    const peer = room?.peers.get(peerId);
    const producerPeer = room?.peers.get(producerPeerId);

    if (!room || !peer || !producerPeer) {
      callback({ params: { error: "Room, peer, or producer peer not found" } });
      return;
    }

    // Get the specific producer for the requested kind
    const producer = kind === 'video' ? producerPeer.producers.video : producerPeer.producers.audio;

    if (!producer) {
      callback({ params: { error: `Producer for ${kind} not found for peer ${producerPeerId}` } });
      return;
    }

    console.log(`Attempting to consume ${kind} from ${producerPeerId} for ${peerId}`);
    console.log(`Producer ID: ${producer.id}`);
    console.log(`Router can consume:`, room.router.canConsume({
      producerId: producer.id,
      rtpCapabilities
    }));

    try {
      if (room.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        const transportKey = producerPeerId;
        const consumerTransport = peer.consumerTransports.get(transportKey);
        if (!consumerTransport) {
          callback({ params: { error: `Consumer transport not found for ${transportKey}` } });
          return;
        }

        const consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: kind === "video", // Pause video by default
        });

        // Store consumer by producer peer ID and kind
        if (!peer.consumers.has(producerPeerId)) {
          peer.consumers.set(producerPeerId, {});
        }
        const peerConsumers = peer.consumers.get(producerPeerId)!;
        if (kind === 'video') {
          peerConsumers.video = consumer;
        } else if (kind === 'audio') {
          peerConsumers.audio = consumer;
        }

        consumer.on("transportclose", () => {
          console.log(`Consumer transport closed for peer ${peerId}, kind: ${kind}`);
          consumer.close();
        });

        consumer.on("producerclose", () => {
          console.log(`Producer closed for consumer ${peerId}, kind: ${kind}`);
          consumer.close();
        });

        callback({
          params: {
            producerId: producer.id,
            id: consumer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          },
        });

        console.log(`Consumer created: ${peerId} consuming ${kind} from ${producerPeerId}`);
      } else {
        console.error("Cannot consume - detailed check:");
        console.error("Producer codecs:", producer.rtpParameters?.codecs);
        console.error("Router codecs:", room.router.rtpCapabilities.codecs);
        console.error("Client capabilities codecs:", rtpCapabilities.codecs);
        callback({ params: { error: "Cannot consume – router capabilities mismatch" } });
      }
    } catch (error: unknown) {
      console.error("Error creating consumer:", error);
      callback({ params: { error: error instanceof Error ? error.message : String(error) } });
    }
  });

  socket.on("resumePausedConsumer", async ({ roomId, peerId, producerPeerId, kind }) => {
    const room = rooms.get(roomId);
    const peer = room?.peers.get(peerId);

    if (peer) {
      const peerConsumers = peer.consumers.get(producerPeerId);
      if (peerConsumers) {
        const consumer = kind === 'video' ? peerConsumers.video : peerConsumers.audio;
        if (consumer && consumer.paused) {
          await consumer.resume();
          console.log(`Consumer resumed for peer ${peerId} consuming ${kind} from ${producerPeerId}`);
        }
      }
    }
  });

  socket.on("getExistingProducers", ({ roomId, peerId }, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback({ producers: [] });
      return;
    }

    const producers: Array<{ peerId: string; kind: 'video' | 'audio' }> = [];

    room.peers.forEach((peer, id) => {
      if (id !== peerId) {
        if (peer.producers.video) {
          producers.push({ peerId: id, kind: 'video' });
        }
        if (peer.producers.audio) {
          producers.push({ peerId: id, kind: 'audio' });
        }
      }
    });

    console.log(`Returning ${producers.length} existing producers for peer ${peerId} in room ${roomId}:`);
    producers.forEach(p => console.log(`  - ${p.peerId}: ${p.kind}`));
    callback({ producers });
  });

  socket.on("disconnect", () => {
    console.log(`Peer disconnected: ${socket.id}`);

    if (currentRoom && currentPeer) {
      // Clean up peer
      currentPeer.producerTransport?.close();
      currentPeer.consumerTransports.forEach(transport => transport.close());
      currentPeer.consumers.forEach(consumerGroup => {
        consumerGroup.video?.close();
        consumerGroup.audio?.close();
      });
      currentPeer.producers.video?.close();
      currentPeer.producers.audio?.close();

      // Remove from room
      currentRoom.peers.delete(currentPeer.peerId);

      // Notify other peers
      if (currentRoomId) {
        socket.to(currentRoomId).emit("peer-left", { peerId: currentPeer.peerId });
      }

      console.log(`Peer ${currentPeer.peerId} left room. Room now has ${currentRoom.peers.size} peers.`);

      // Clean up empty room
      if (currentRoom.peers.size === 0) {
        currentRoom.router.close();
        if (currentRoomId) {
          rooms.delete(currentRoomId);
          console.log(`Room ${currentRoomId} cleaned up as it became empty`);
        }
      }
    }
  });
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});