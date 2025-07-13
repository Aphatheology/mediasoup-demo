import { useEffect, useState, useRef, useCallback } from 'react';
import { WebSocketTransport, Peer } from 'protoo-client';

interface UseProtooReturn {
  protooPeer: Peer | null;
  isConnected: boolean;
  makeRequest: (method: string, data?: any) => Promise<any>;
  sendNotification: (method: string, data?: any) => void;
  connect: (roomId: string, peerId: string) => Promise<void>;
  disconnect: () => void;
}

export const useProtoo = (): UseProtooReturn => {
  const [protooPeer, setProtooPeer] = useState<Peer | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const transportRef = useRef<WebSocketTransport | null>(null);
  const peerRef = useRef<Peer | null>(null);

  const makeRequest = useCallback(async (method: string, data?: any): Promise<any> => {
    if (!protooPeer) {
      throw new Error('Protoo peer not connected');
    }

    try {
      const response = await protooPeer.request(method, data);
      return response;
    } catch (error) {
      console.error(`Protoo request failed [method:${method}]:`, error);
      throw error;
    }
  }, [protooPeer]);

  const sendNotification = useCallback((method: string, data?: any) => {
    if (!protooPeer) {
      console.warn('Cannot send notification: Protoo peer not connected');
      return;
    }

    try {
      protooPeer.notify(method, data);
    } catch (error) {
      console.error(`Protoo notification failed [method:${method}]:`, error);
    }
  }, [protooPeer]);

  const connect = useCallback(async (roomId: string, peerId: string) => {
    if (!roomId || !peerId) {
      throw new Error('Room ID and Peer ID are required');
    }

    // Disconnect existing connection if any
    disconnect();
    
    try {
        const serverUrl = process.env.NEXT_PUBLIC_API_URL || 'ws://localhost:4000';
        // Convert HTTP URL to WebSocket URL if needed
        const wsUrl = serverUrl.replace(/^http/, 'ws');
        const protooUrl = `${wsUrl}/?roomId=${roomId}&peerId=${peerId}`;
        
        console.log('Connecting to protoo server:', protooUrl);

        // Create WebSocket transport
        const transport = new WebSocketTransport(protooUrl);
        transportRef.current = transport;

        transport.on('open', () => {
          console.log('Protoo WebSocket transport opened');
        });

        transport.on('disconnected', () => {
          console.log('Protoo WebSocket transport disconnected');
          setIsConnected(false);
          setProtooPeer(null);
        });

        transport.on('failed', (error: any) => {
          console.error('Protoo WebSocket transport failed:', error);
          setIsConnected(false);
          setProtooPeer(null);
        });

        transport.on('close', () => {
          console.log('Protoo WebSocket transport closed');
          setIsConnected(false);
          setProtooPeer(null);
        });

        // Create protoo Peer
        const peer = new Peer(transport);
        peerRef.current = peer;

        peer.on('open', () => {
          console.log('Protoo peer opened');
          setIsConnected(true);
          setProtooPeer(peer);
        });

        peer.on('disconnected', () => {
          console.log('Protoo peer disconnected');
          setIsConnected(false);
          setProtooPeer(null);
        });

        peer.on('close', () => {
          console.log('Protoo peer closed');
          setIsConnected(false);
          setProtooPeer(null);
        });

        peer.on('failed', (error: any) => {
          console.error('Protoo peer failed:', error);
          setIsConnected(false);
          setProtooPeer(null);
        });

        // Handle protoo notifications
        peer.on('notification', (notification: any) => {
          console.log('Protoo notification received:', notification);
          
          // Dispatch custom events for different notification types
          const event = new CustomEvent('protoo-notification', {
            detail: { method: notification.method, data: notification.data }
          });
          window.dispatchEvent(event);
        });

        // Handle protoo requests (if any)
        peer.on('request', (request: any, accept: any, reject: any) => {
          console.log('Protoo request received:', request);
          // For now, we don't expect requests from server to client
          // but we can handle them here if needed
          reject(500, 'Client does not handle requests');
        });

    } catch (error) {
      console.error('Error connecting to protoo server:', error);
      setIsConnected(false);
      setProtooPeer(null);
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (transportRef.current) {
      transportRef.current.close();
      transportRef.current = null;
    }
    setProtooPeer(null);
    setIsConnected(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { 
    protooPeer, 
    isConnected, 
    makeRequest,
    sendNotification,
    connect,
    disconnect
  };
};