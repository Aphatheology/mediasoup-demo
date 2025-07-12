import mediasoup from "mediasoup";
import { Room, PeerInfo } from "./types.js";

const rooms = new Map<string, Room>();

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

export const getOrCreateRoom = async (
  roomId: string,
  worker: mediasoup.types.Worker<mediasoup.types.AppData>
): Promise<Room> => {
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

export const getRoom = (roomId: string): Room | undefined => {
  return rooms.get(roomId);
};

export const deleteRoom = (roomId: string): void => {
  const room = rooms.get(roomId);
  if (room) {
    room.router.close();
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted`);
  }
};

export const addPeerToRoom = (roomId: string, peerId: string, socketId: string): PeerInfo => {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("Room not found");
  }

  // Clean up existing peer if it exists
  if (room.peers.has(peerId)) {
    const existingPeer = room.peers.get(peerId);
    if (existingPeer) {
      cleanupPeer(existingPeer);
    }
    room.peers.delete(peerId);
  }

  const peerInfo: PeerInfo = {
    socketId,
    peerId,
    consumerTransports: new Map(),
    consumers: new Map(),
    producers: {},
  };

  room.peers.set(peerId, peerInfo);
  return peerInfo;
};

export const removePeerFromRoom = (roomId: string, peerId: string): void => {
  const room = rooms.get(roomId);
  if (!room) return;

  const peer = room.peers.get(peerId);
  if (peer) {
    cleanupPeer(peer);
    room.peers.delete(peerId);
    
    // Clean up empty room
    if (room.peers.size === 0) {
      deleteRoom(roomId);
    }
  }
};

const cleanupPeer = (peer: PeerInfo): void => {
  peer.producerTransport?.close();
  peer.consumerTransports.forEach(transport => transport.close());
  peer.consumers.forEach(consumerGroup => {
    consumerGroup.video?.close();
    consumerGroup.audio?.close();
  });
  peer.producers.video?.close();
  peer.producers.audio?.close();
};

export const getRoomPeers = (roomId: string): string[] => {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.peers.keys());
};

export const getExistingProducers = (roomId: string, excludePeerId: string) => {
  const room = rooms.get(roomId);
  if (!room) return [];

  const producers: Array<{ peerId: string; kind: 'video' | 'audio' }> = [];

  room.peers.forEach((peer, id) => {
    if (id !== excludePeerId) {
      if (peer.producers.video) {
        producers.push({ peerId: id, kind: 'video' });
      }
      if (peer.producers.audio) {
        producers.push({ peerId: id, kind: 'audio' });
      }
    }
  });

  return producers;
};

export { rooms };