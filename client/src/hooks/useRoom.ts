import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';

interface UseRoomReturn {
  roomId: string;
  peerId: string;
  isJoined: boolean;
  remotePeers: string[];
  setRoomId: (id: string) => void;
  setPeerId: (id: string) => void;
  joinRoom: () => Promise<void>;
}

export const useRoom = (socket: Socket | null): UseRoomReturn => {
  const [roomId, setRoomId] = useState<string>('');
  const [peerId, setPeerId] = useState<string>('');
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [remotePeers, setRemotePeers] = useState<string[]>([]);

  useEffect(() => {
    if (!socket) return;

    // Listen for peer events
    socket.on('peer-joined', (data) => {
      console.log('Peer joined:', data);
      setRemotePeers(prev => [...prev.filter(p => p !== data.peerId), data.peerId]);
    });

    socket.on('new-producer', (data) => {
      console.log('New producer detected:', data);
      // This will be handled by the consumeMedia function
    });


    socket.on('peer-left', (data) => {
      console.log('Peer left:', data);
      setRemotePeers(prev => prev.filter(p => p !== data.peerId));
      
      // Clean up remote video element
      const remoteContainer = document.getElementById('remote-videos');
      const existingContainers = remoteContainer?.children;
      if (existingContainers) {
        Array.from(existingContainers).forEach(container => {
          const label = container.querySelector('div');
          if (label && label.textContent === data.peerId) {
            container.remove();
          }
        });
      }
    });

    return () => {
      socket.off('peer-joined');
      socket.off('peer-left');
      socket.off('new-producer');
    };
  }, [socket]);

  const joinRoom = useCallback(async () => {
    if (!socket || !roomId || !peerId) return;
    
    return new Promise<void>((resolve, reject) => {
      socket.emit('join-room', { roomId, peerId }, (response: any) => {
        if (response.success) {
          setIsJoined(true);
          setRemotePeers(response.peers || []);
          console.log('Joined room successfully');
          resolve();
        } else {
          console.error('Failed to join room:', response.error);
          reject(response.error);
        }
      });
    });
  }, [socket, roomId, peerId]);

  return {
    roomId,
    peerId,
    isJoined,
    remotePeers,
    setRoomId,
    setPeerId,
    joinRoom,
  };
};