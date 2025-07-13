import { Socket } from "socket.io";
import mediasoup from "mediasoup";
import { 
  getOrCreateRoom, 
  getRoom, 
  addPeerToRoom, 
  removePeerFromRoom, 
  getRoomPeers,
  getExistingProducers 
} from "./room.js";
import { createWebRtcTransport } from "./transport.js";
import { PeerInfo } from "./types.js";

export const setupSocketHandlers = (
  socket: Socket,
  getWorker: () => mediasoup.types.Worker<mediasoup.types.AppData>
) => {
  console.log(`New connection: ${socket.id}`);
  socket.emit("connection-success", { socketId: socket.id });

  let currentRoomId: string | null = null;
  let currentPeer: PeerInfo | null = null;

  // Join room handler
  socket.on("join-room", async ({ roomId, peerId }, callback) => {
    try {
      console.log(`Peer ${peerId} joining room ${roomId}`);

      const room = await getOrCreateRoom(roomId, getWorker());
      const peerInfo = addPeerToRoom(roomId, peerId, socket.id);
      
      currentRoomId = roomId;
      currentPeer = peerInfo;

      // Join socket to room
      socket.join(roomId);

      // Notify other peers in the room
      socket.to(roomId).emit("peer-joined", { peerId, socketId: socket.id });

      // Send list of existing peers
      const existingPeers = getRoomPeers(roomId).filter(id => id !== peerId);

      callback({ success: true, peers: existingPeers });
      console.log(`Peer ${peerId} joined room ${roomId}. Room now has ${room.peers.size} peers.`);
    } catch (error: unknown) {
      console.error("Error joining room:", error);
      callback({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Get router RTP capabilities
  socket.on("getRouterRtpCapabilities", ({ roomId }, callback) => {
    const room = getRoom(roomId);
    if (!room) {
      callback({ error: "Room not found" });
      return;
    }
    callback({ routerRtpCapabilities: room.router.rtpCapabilities });
  });

  // Create transport
  socket.on("createTransport", async ({ sender, roomId, peerId, producerPeerId }, callback) => {
    try {
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (!room || !peer) {
        callback({ params: { error: "Room or peer not found" } });
        return;
      }

      if (sender) {
        // Create producer transport
        const transport = await createWebRtcTransport(room.router, callback);
        if (transport) {
          peer.producerTransport = transport;
          console.log(`Producer transport created for peer ${peerId}`);
        }
      } else {
        // Create consumer transport
        const transportKey = producerPeerId;
        const transport = await createWebRtcTransport(room.router, callback);
        if (transport && producerPeerId) {
          peer.consumerTransports.set(transportKey, transport);
          console.log(`Consumer transport created for peer ${peerId} consuming from ${producerPeerId}`);
        }
      }
    } catch (error) {
      console.error("Error creating transport:", error);
      callback({ params: { error: error instanceof Error ? error.message : String(error) } });
    }
  });

  // Connect producer transport
  socket.on("connectProducerTransport", async ({ dtlsParameters, roomId, peerId }) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(peerId);

    if (peer?.producerTransport) {
      await peer.producerTransport.connect({ dtlsParameters });
      console.log(`Producer transport connected for peer ${peerId}`);
    }
  });

  // Transport produce
  socket.on("transport-produce", async ({ kind, rtpParameters, roomId, peerId }, callback) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(peerId);

    if (!room || !peer?.producerTransport) {
      callback({ error: "Transport not found" });
      return;
    }

    try {
      const producer = await peer.producerTransport.produce({ kind, rtpParameters });

      // Store producer by kind
      if (kind === 'video') {
        peer.producers.video = producer;
      } else if (kind === 'audio') {
        peer.producers.audio = producer;
      }

      producer.on("transportclose", () => {
        console.log(`Producer transport closed for peer ${peerId}, kind: ${kind}`);
        producer.close();
      });

      // MediaSoup producers don't have pause/resume events
      // We'll handle mute/unmute through track enabling/disabling on the client side

      callback({ id: producer.id });

      // Notify other peers about new producer
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

  // Connect consumer transport
  socket.on("connectConsumerTransport", async ({ dtlsParameters, roomId, peerId, producerPeerId }) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(peerId);

    if (peer) {
      const transportKey = producerPeerId;
      const consumerTransport = peer.consumerTransports.get(transportKey);
      if (consumerTransport) {
        try {
          await consumerTransport.connect({ dtlsParameters });
          console.log(`Consumer transport connected for peer ${peerId} consuming from ${producerPeerId}`);
        } catch (error: any) {
          if (error.message.includes('already called')) {
            console.log(`Consumer transport already connected for peer ${peerId} consuming from ${producerPeerId}`);
          } else {
            console.error(`Error connecting consumer transport: ${error.message}`);
          }
        }
      } else {
        console.error(`Consumer transport not found for key: ${transportKey}`);
      }
    }
  });

  // Consume media
  socket.on("consumeMedia", async ({ rtpCapabilities, roomId, peerId, producerPeerId, kind }, callback) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(peerId);
    const producerPeer = room?.peers.get(producerPeerId);

    if (!room || !peer || !producerPeer) {
      callback({ params: { error: "Room, peer, or producer peer not found" } });
      return;
    }

    const producer = kind === 'video' ? producerPeer.producers.video : producerPeer.producers.audio;

    if (!producer) {
      callback({ params: { error: `Producer for ${kind} not found for peer ${producerPeerId}` } });
      return;
    }

    console.log(`Attempting to consume ${kind} from ${producerPeerId} for ${peerId}`);

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
          paused: false,
        });

        // Store consumer
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
        callback({ params: { error: "Cannot consume – router capabilities mismatch" } });
      }
    } catch (error: unknown) {
      console.error("Error creating consumer:", error);
      callback({ params: { error: error instanceof Error ? error.message : String(error) } });
    }
  });

  // Resume paused consumer
  socket.on("resumePausedConsumer", async ({ roomId, peerId, producerPeerId, kind }) => {
    const room = getRoom(roomId);
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

  // Get existing producers
  socket.on("getExistingProducers", ({ roomId, peerId }, callback) => {
    const producers = getExistingProducers(roomId, peerId);
    console.log(`Returning ${producers.length} existing producers for peer ${peerId} in room ${roomId}:`);
    producers.forEach(p => console.log(`  - ${p.peerId}: ${p.kind}`));
    callback({ producers });
  });

  // Handle producer pause/resume
  socket.on("pauseProducer", async ({ roomId, peerId, kind }) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(peerId);

    if (peer) {
      const producer = kind === 'video' ? peer.producers.video : peer.producers.audio;
      if (producer && !producer.paused) {
        await producer.pause();
        console.log(`Producer paused for peer ${peerId}, kind: ${kind}`);
        
        // Notify other peers
        socket.to(roomId).emit("producerPaused", { peerId, kind });
      }
    }
  });

  socket.on("resumeProducer", async ({ roomId, peerId, kind }) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(peerId);

    if (peer) {
      const producer = kind === 'video' ? peer.producers.video : peer.producers.audio;
      if (producer && producer.paused) {
        await producer.resume();
        console.log(`Producer resumed for peer ${peerId}, kind: ${kind}`);
        
        // Notify other peers
        socket.to(roomId).emit("producerResumed", { peerId, kind });
      }
    }
  });

  // Handle consumer pause/resume
  socket.on("pauseConsumer", async ({ roomId, peerId, producerPeerId, kind }) => {
    const room = getRoom(roomId);
    const peer = room?.peers.get(peerId);

    if (peer) {
      const peerConsumers = peer.consumers.get(producerPeerId);
      if (peerConsumers) {
        const consumer = kind === 'video' ? peerConsumers.video : peerConsumers.audio;
        if (consumer && !consumer.paused) {
          await consumer.pause();
          console.log(`Consumer paused for peer ${peerId} consuming ${kind} from ${producerPeerId}`);
        }
      }
    }
  });

  socket.on("resumeConsumer", async ({ roomId, peerId, producerPeerId, kind }) => {
    const room = getRoom(roomId);
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

  // Handle mute/unmute notifications (legacy support, will be replaced with pause/resume)
  socket.on("peer-muted", ({ roomId, peerId, kind, muted }) => {
    console.log(`Peer ${peerId} ${muted ? 'muted' : 'unmuted'} ${kind}`);
    // Notify other peers in the room
    socket.to(roomId).emit("peer-muted", { peerId, kind, muted });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`Peer disconnected: ${socket.id}`);

    if (currentRoomId && currentPeer) {
      // Notify other peers
      socket.to(currentRoomId).emit("peer-left", { peerId: currentPeer.peerId });
      
      // Remove peer from room
      removePeerFromRoom(currentRoomId, currentPeer.peerId);
      console.log(`Peer ${currentPeer.peerId} left room ${currentRoomId}`);
    }
  });
};