declare module 'protoo-server' {
  export class WebSocketServer {
    constructor(server: any, options?: {
      maxReceivedFrameSize?: number;
      maxReceivedMessageSize?: number;
      fragmentOutgoingMessages?: boolean;
      fragmentationThreshold?: number;
    });
    
    on(event: 'connectionrequest', listener: (
      info: {
        request: { url: string };
        socket: { remoteAddress: string };
        origin: string;
      },
      accept: () => any,
      reject: (code: number, reason: string) => void
    ) => void): this;
  }

  export class Room {
    constructor();
    createPeer(peerId: string, transport: any): Peer;
    addPeer(peer: Peer): void;
    removePeer(peer: Peer): void;
    spread(method: string, data: any, excludePeer?: Peer): void;
    getPeer(peerId: string): Peer | undefined;
  }

  export class Peer {
    id: string;
    on(event: 'open' | 'failed' | 'disconnected' | 'close', listener: () => void): this;
    on(event: 'request', listener: (
      request: { method: string; data?: any },
      accept: (data?: any) => void,
      reject: (code: number, reason?: string) => void
    ) => void): this;
    request(method: string, data?: any): Promise<any>;
    notify(method: string, data?: any): void;
    close(): void;
  }
}