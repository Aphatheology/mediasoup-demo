import mediasoup from "mediasoup";
import protoo from "protoo-server";
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

// Global map to store protoo rooms
const protooRooms = new Map<string, protoo.Room>();

export const setupProtooHandlers = (
  protooWebSocketTransport: any,
  roomId: string,
  peerId: string,
  getWorker: () => mediasoup.types.Worker<mediasoup.types.AppData>
) => {
  console.log(`New protoo connection: ${peerId} in room ${roomId}`);

  let currentPeer: PeerInfo | null = null;
  let protooPeer: protoo.Peer | null = null;

  // Get or create protoo room
  let protooRoom = protooRooms.get(roomId);
  if (!protooRoom) {
    protooRoom = new protoo.Room();
    protooRooms.set(roomId, protooRoom);
    console.log(`Created new protoo room: ${roomId}`);
  }

  try {
    // Create protoo Peer using the room's createPeer method
    protooPeer = protooRoom.createPeer(peerId, protooWebSocketTransport);
  } catch (error) {
    console.error('Error creating protoo peer:', error);
    return;
  }

  // Set up event handlers after protooPeer is created
  if (protooPeer) {
    // Handle protoo Peer 'open' event
    protooPeer.on('open', () => {
      console.log(`Protoo peer opened [peerId:${peerId}]`);
    });

    // Handle protoo Peer 'failed' event
    protooPeer.on('failed', () => {
      console.log(`Protoo peer failed [peerId:${peerId}]`);
    });

    // Handle protoo Peer 'disconnected' event
    protooPeer.on('disconnected', () => {
      console.log(`Protoo peer disconnected [peerId:${peerId}]`);
      
      if (currentPeer) {
        // Leave protoo room
        if (protooPeer) {
          protooRoom.removePeer(protooPeer);
        }
        
        // Notify other peers
        protooRoom.spread('notification', { method: 'peerLeft', data: { peerId } });
        
        // Remove peer from room
        removePeerFromRoom(roomId, peerId);
        console.log(`Peer ${peerId} left room ${roomId}`);
      }
    });

    // Handle protoo Peer 'close' event
    protooPeer.on('close', () => {
      console.log(`Protoo peer closed [peerId:${peerId}]`);
    });

    // Handle protoo Peer 'request' event
    protooPeer.on('request', async (request: any, accept: any, reject: any) => {
    console.log(`Protoo request [method:${request.method}, peerId:${peerId}]`);

    try {
      switch (request.method) {
        case 'join': {
          await handleJoinRequest(request, accept, reject);
          break;
        }

        case 'getRouterRtpCapabilities': {
          const room = getRoom(roomId);
          if (!room) {
            reject(404, 'Room not found');
            return;
          }
          accept({ routerRtpCapabilities: room.router.rtpCapabilities });
          break;
        }

        case 'createTransport': {
          await handleCreateTransport(request, accept, reject);
          break;
        }

        case 'connectProducerTransport': {
          await handleConnectProducerTransport(request, accept, reject);
          break;
        }

        case 'transport-produce': {
          await handleTransportProduce(request, accept, reject);
          break;
        }

        case 'connectConsumerTransport': {
          await handleConnectConsumerTransport(request, accept, reject);
          break;
        }

        case 'consumeMedia': {
          await handleConsumeMedia(request, accept, reject);
          break;
        }

        case 'resumePausedConsumer': {
          await handleResumePausedConsumer(request, accept, reject);
          break;
        }

        case 'getExistingProducers': {
          const producers = getExistingProducers(roomId, peerId);
          accept({ producers });
          break;
        }

        case 'pauseProducer': {
          await handlePauseProducer(request, accept, reject);
          break;
        }

        case 'resumeProducer': {
          await handleResumeProducer(request, accept, reject);
          break;
        }

        case 'pauseConsumer': {
          await handlePauseConsumer(request, accept, reject);
          break;
        }

        case 'resumeConsumer': {
          await handleResumeConsumer(request, accept, reject);
          break;
        }

        default: {
          console.error(`Unknown protoo request method: ${request.method}`);
          reject(500, `Unknown request method: ${request.method}`);
        }
      }
    } catch (error) {
      console.error(`Error handling protoo request [method:${request.method}]:`, error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
    });
  }

  // Join request handler
  const handleJoinRequest = async (request: any, accept: any, reject: any) => {
    try {
      console.log(`Peer ${peerId} joining room ${roomId}`);

      const room = await getOrCreateRoom(roomId, getWorker());
      const peerInfo = addPeerToRoom(roomId, peerId, protooPeer!.id);
      
      currentPeer = peerInfo;

      // Add peer to protoo room
      if (protooPeer) {
        protooRoom.addPeer(protooPeer);

        // Notify other peers in the room
        protooRoom.spread('notification', 
          { method: 'peerJoined', data: { peerId, protooPeerId: protooPeer.id } },
          protooPeer
        );
      }

      // Send list of existing peers
      const existingPeers = getRoomPeers(roomId).filter(id => id !== peerId);

      accept({ success: true, peers: existingPeers });
      console.log(`Peer ${peerId} joined room ${roomId}. Room now has ${room.peers.size} peers.`);
    } catch (error: unknown) {
      console.error("Error joining room:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Create transport handler
  const handleCreateTransport = async (request: any, accept: any, reject: any) => {
    try {
      const { sender, producerPeerId } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (!room || !peer) {
        reject(404, "Room or peer not found");
        return;
      }

      if (sender) {
        // Create producer transport
        const transport = await createWebRtcTransport(room.router, accept);
        if (transport) {
          peer.producerTransport = transport;
          console.log(`Producer transport created for peer ${peerId}`);
        }
      } else {
        // Create consumer transport
        const transportKey = producerPeerId;
        const transport = await createWebRtcTransport(room.router, accept);
        if (transport && producerPeerId) {
          peer.consumerTransports.set(transportKey, transport);
          console.log(`Consumer transport created for peer ${peerId} consuming from ${producerPeerId}`);
        }
      }
    } catch (error) {
      console.error("Error creating transport:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Connect producer transport handler
  const handleConnectProducerTransport = async (request: any, accept: any, reject: any) => {
    try {
      const { dtlsParameters } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (peer?.producerTransport) {
        await peer.producerTransport.connect({ dtlsParameters });
        console.log(`Producer transport connected for peer ${peerId}`);
        accept();
      } else {
        reject(404, "Producer transport not found");
      }
    } catch (error) {
      console.error("Error connecting producer transport:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Transport produce handler
  const handleTransportProduce = async (request: any, accept: any, reject: any) => {
    try {
      const { kind, rtpParameters } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (!room || !peer?.producerTransport) {
        reject(404, "Transport not found");
        return;
      }

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

      accept({ id: producer.id });

      // Notify other peers about new producer
      setTimeout(() => {
        if (protooPeer) {
          protooRoom.spread('notification', 
            { method: 'newProducer', data: { producerPeerId: peerId, kind } },
            protooPeer
          );
        }
        console.log(`Notified room about new ${kind} producer from ${peerId}`);
      }, 500);

      console.log(`Producer created for peer ${peerId}, kind: ${kind}`);
    } catch (error: unknown) {
      console.error("Error creating producer:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Connect consumer transport handler
  const handleConnectConsumerTransport = async (request: any, accept: any, reject: any) => {
    try {
      const { dtlsParameters, producerPeerId } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (peer) {
        const transportKey = producerPeerId;
        const consumerTransport = peer.consumerTransports.get(transportKey);
        if (consumerTransport) {
          try {
            await consumerTransport.connect({ dtlsParameters });
            console.log(`Consumer transport connected for peer ${peerId} consuming from ${producerPeerId}`);
            accept();
          } catch (error: any) {
            if (error.message.includes('already called')) {
              console.log(`Consumer transport already connected for peer ${peerId} consuming from ${producerPeerId}`);
              accept();
            } else {
              throw error;
            }
          }
        } else {
          reject(404, `Consumer transport not found for key: ${transportKey}`);
        }
      } else {
        reject(404, "Peer not found");
      }
    } catch (error) {
      console.error("Error connecting consumer transport:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Consume media handler
  const handleConsumeMedia = async (request: any, accept: any, reject: any) => {
    try {
      const { rtpCapabilities, producerPeerId, kind } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);
      const producerPeer = room?.peers.get(producerPeerId);

      if (!room || !peer || !producerPeer) {
        reject(404, "Room, peer, or producer peer not found");
        return;
      }

      const producer = kind === 'video' ? producerPeer.producers.video : producerPeer.producers.audio;

      if (!producer) {
        reject(404, `Producer for ${kind} not found for peer ${producerPeerId}`);
        return;
      }

      console.log(`Attempting to consume ${kind} from ${producerPeerId} for ${peerId}`);

      if (room.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        const transportKey = producerPeerId;
        const consumerTransport = peer.consumerTransports.get(transportKey);
        if (!consumerTransport) {
          reject(404, `Consumer transport not found for ${transportKey}`);
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

        accept({
          producerId: producer.id,
          id: consumer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });

        console.log(`Consumer created: ${peerId} consuming ${kind} from ${producerPeerId}`);
      } else {
        reject(400, "Cannot consume – router capabilities mismatch");
      }
    } catch (error: unknown) {
      console.error("Error creating consumer:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Resume paused consumer handler
  const handleResumePausedConsumer = async (request: any, accept: any, reject: any) => {
    try {
      const { producerPeerId, kind } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (peer) {
        const peerConsumers = peer.consumers.get(producerPeerId);
        if (peerConsumers) {
          const consumer = kind === 'video' ? peerConsumers.video : peerConsumers.audio;
          if (consumer && consumer.paused) {
            await consumer.resume();
            console.log(`Consumer resumed for peer ${peerId} consuming ${kind} from ${producerPeerId}`);
            accept();
          } else {
            accept(); // Already resumed or doesn't exist
          }
        } else {
          reject(404, "Consumer not found");
        }
      } else {
        reject(404, "Peer not found");
      }
    } catch (error) {
      console.error("Error resuming consumer:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Pause producer handler
  const handlePauseProducer = async (request: any, accept: any, reject: any) => {
    try {
      const { kind } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (peer) {
        const producer = kind === 'video' ? peer.producers.video : peer.producers.audio;
        if (producer && !producer.paused) {
          await producer.pause();
          console.log(`Producer paused for peer ${peerId}, kind: ${kind}`);
          
          // Notify other peers
          if (protooPeer) {
            protooRoom.spread('notification', 
              { method: 'producerPaused', data: { peerId, kind } },
              protooPeer
            );
          }
          accept();
        } else {
          accept(); // Already paused or doesn't exist
        }
      } else {
        reject(404, "Peer not found");
      }
    } catch (error) {
      console.error("Error pausing producer:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Resume producer handler
  const handleResumeProducer = async (request: any, accept: any, reject: any) => {
    try {
      const { kind } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (peer) {
        const producer = kind === 'video' ? peer.producers.video : peer.producers.audio;
        if (producer && producer.paused) {
          await producer.resume();
          console.log(`Producer resumed for peer ${peerId}, kind: ${kind}`);
          
          // Notify other peers
          if (protooPeer) {
            protooRoom.spread('notification', 
              { method: 'producerResumed', data: { peerId, kind } },
              protooPeer
            );
          }
          accept();
        } else {
          accept(); // Already resumed or doesn't exist
        }
      } else {
        reject(404, "Peer not found");
      }
    } catch (error) {
      console.error("Error resuming producer:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Pause consumer handler
  const handlePauseConsumer = async (request: any, accept: any, reject: any) => {
    try {
      const { producerPeerId, kind } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (peer) {
        const peerConsumers = peer.consumers.get(producerPeerId);
        if (peerConsumers) {
          const consumer = kind === 'video' ? peerConsumers.video : peerConsumers.audio;
          if (consumer && !consumer.paused) {
            await consumer.pause();
            console.log(`Consumer paused for peer ${peerId} consuming ${kind} from ${producerPeerId}`);
            accept();
          } else {
            accept(); // Already paused or doesn't exist
          }
        } else {
          reject(404, "Consumer not found");
        }
      } else {
        reject(404, "Peer not found");
      }
    } catch (error) {
      console.error("Error pausing consumer:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };

  // Resume consumer handler
  const handleResumeConsumer = async (request: any, accept: any, reject: any) => {
    try {
      const { producerPeerId, kind } = request.data;
      const room = getRoom(roomId);
      const peer = room?.peers.get(peerId);

      if (peer) {
        const peerConsumers = peer.consumers.get(producerPeerId);
        if (peerConsumers) {
          const consumer = kind === 'video' ? peerConsumers.video : peerConsumers.audio;
          if (consumer && consumer.paused) {
            await consumer.resume();
            console.log(`Consumer resumed for peer ${peerId} consuming ${kind} from ${producerPeerId}`);
            accept();
          } else {
            accept(); // Already resumed or doesn't exist
          }
        } else {
          reject(404, "Consumer not found");
        }
      } else {
        reject(404, "Peer not found");
      }
    } catch (error) {
      console.error("Error resuming consumer:", error);
      reject(500, error instanceof Error ? error.message : String(error));
    }
  };
};