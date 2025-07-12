import mediasoup from "mediasoup";

export interface Room {
  router: mediasoup.types.Router<mediasoup.types.AppData>;
  peers: Map<string, PeerInfo>;
}

export interface PeerInfo {
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