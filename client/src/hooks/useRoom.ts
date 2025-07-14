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
  leaveRoom: (cleanupCallback?: () => void) => void;
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

    // Handle producer paused/resumed events (new pause/resume pattern)
    socket.on('producerPaused', (data) => {
      console.log(`Producer paused: ${data.peerId} ${data.kind}`);
      updatePeerIndicator(data.peerId, data.kind, true);
    });

    socket.on('producerResumed', (data) => {
      console.log(`Producer resumed: ${data.peerId} ${data.kind}`);
      updatePeerIndicator(data.peerId, data.kind, false);
    });

    // Legacy mute/unmute handler (for backward compatibility)
    socket.on('peer-muted', (data) => {
      console.log(`Peer ${data.peerId} ${data.muted ? 'muted' : 'unmuted'} ${data.kind}`);
      updatePeerIndicator(data.peerId, data.kind, data.muted);
    });

    // Helper function to update peer indicators
    const updatePeerIndicator = (peerId: string, kind: string, isPaused: boolean) => {
      const remoteContainer = document.getElementById('remote-videos');
      const peerContainers = remoteContainer?.children;
      if (peerContainers) {
        Array.from(peerContainers).forEach(container => {
          const label = container.querySelector('div');
          if (label && label.textContent === peerId) {
            const videoElement = container.querySelector('video') as HTMLVideoElement;
            const muteIndicator = container.querySelector('.mute-indicator') || 
              (() => {
                const indicator = document.createElement('div');
                indicator.className = 'mute-indicator';
                indicator.style.cssText = 'position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; display: none;';
                container.appendChild(indicator);
                return indicator;
              })();
            
            if (kind === 'video') {
              if (isPaused) {
                if (videoElement) videoElement.style.display = 'none';
                (muteIndicator as HTMLElement).textContent = 'Camera Off';
                (muteIndicator as HTMLElement).style.display = 'block';
              } else {
                if (videoElement) videoElement.style.display = 'block';
                (muteIndicator as HTMLElement).style.display = 'none';
              }
            } else if (kind === 'audio') {
              if (isPaused) {
                (muteIndicator as HTMLElement).textContent = 'Muted';
                (muteIndicator as HTMLElement).style.display = 'block';
              } else {
                (muteIndicator as HTMLElement).style.display = 'none';
              }
            }
          }
        });
      }
    };

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
      socket.off('peer-muted');
      socket.off('producerPaused');
      socket.off('producerResumed');
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

  const leaveRoom = useCallback((cleanupCallback?: () => void) => {
    if (!socket || !isJoined || !roomId || !peerId) return;
    
    // Emit leave room event
    socket.emit('leave-room', { roomId, peerId });
    
    // Call cleanup callback (for media cleanup)
    if (cleanupCallback) {
      cleanupCallback();
    }
    
    // Reset local state
    setIsJoined(false);
    setRemotePeers([]);
    
    // Clear remote videos
    const remoteContainer = document.getElementById('remote-videos');
    if (remoteContainer) {
      remoteContainer.innerHTML = '';
    }
    
    console.log('Left room successfully');
  }, [socket, isJoined, roomId, peerId]);

  return {
    roomId,
    peerId,
    isJoined,
    remotePeers,
    setRoomId,
    setPeerId,
    joinRoom,
    leaveRoom,
  };
};