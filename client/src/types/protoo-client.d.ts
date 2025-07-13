declare module 'protoo-client' {
  export class WebSocketTransport {
    constructor(url: string);
    
    on(event: 'open' | 'disconnected' | 'failed' | 'close', listener: (error?: any) => void): this;
    close(): void;
  }

  export class Peer {
    constructor(transport: WebSocketTransport);
    
    on(event: 'open' | 'disconnected' | 'close', listener: () => void): this;
    on(event: 'failed', listener: (error: any) => void): this;
    on(event: 'notification', listener: (notification: {
      method: string;
      data?: any;
    }) => void): this;
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