import { useState, useEffect, useCallback } from 'react';
import { Peer } from 'protoo-client';

interface UseProtooRoomReturn {
  isJoined: boolean;
  isConnecting: boolean;
  remotePeers: string[];
  joinRoom: (roomId: string, peerId: string) => Promise<void>;
}

export const useProtooRoom = (
  protooPeer: Peer | null, 
  isConnected: boolean,
  makeRequest: (method: string, data?: any) => Promise<any>,
  connect: (roomId: string, peerId: string) => Promise<void>
): UseProtooRoomReturn => {
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [remotePeers, setRemotePeers] = useState<string[]>([]);

  useEffect(() => {
    if (!protooPeer) return;

    // Handle protoo notifications via custom events
    const handleProtooNotification = (event: CustomEvent) => {
      const { method, data } = event.detail;
      
      switch (method) {
        case 'peerJoined':
          console.log('Peer joined:', data);
          setRemotePeers(prev => [...prev.filter(p => p !== data.peerId), data.peerId]);
          break;

        case 'newProducer':
          console.log('New producer detected:', data);
          // This will be handled by the consumeMedia function
          const newProducerEvent = new CustomEvent('new-producer', { detail: data });
          window.dispatchEvent(newProducerEvent);
          break;

        case 'producerPaused':
          console.log(`Producer paused: ${data.peerId} ${data.kind}`);
          updatePeerIndicator(data.peerId, data.kind, true);
          break;

        case 'producerResumed':
          console.log(`Producer resumed: ${data.peerId} ${data.kind}`);
          updatePeerIndicator(data.peerId, data.kind, false);
          break;

        case 'peerLeft':
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
          break;

        default:
          console.log('Unknown protoo notification:', method, data);
      }
    };

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

    // Listen for protoo notifications
    window.addEventListener('protoo-notification', handleProtooNotification as EventListener);

    return () => {
      window.removeEventListener('protoo-notification', handleProtooNotification as EventListener);
    };
  }, [protooPeer]);

  const joinRoom = useCallback(async (roomId: string, peerId: string) => {
    if (!roomId || !peerId) {
      throw new Error('Room ID and Peer ID are required');
    }
    
    setIsConnecting(true);
    
    try {
      console.log('Starting connection process...');
      
      // First connect to protoo server
      await connect(roomId, peerId);
      
      console.log('Connect function completed, checking connection state...');
      console.log('Current isConnected state:', isConnected);
      console.log('Current protooPeer state:', !!protooPeer);
      
      // Wait for peer to be fully established using isConnected state
      let attempts = 0;
      const maxAttempts = 20;
      
      while (!isConnected && attempts < maxAttempts) {
        console.log(`Waiting for protoo peer connection... attempt ${attempts + 1}, isConnected: ${isConnected}`);
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (!isConnected) {
        console.log('Final check - isConnected:', isConnected, 'protooPeer:', !!protooPeer);
        throw new Error('Failed to establish protoo peer connection');
      }
      
      console.log('Protoo peer is connected, sending join request...');
      
      // Then join the room
      const response = await makeRequest('join', { roomId, peerId });
      if (response.success) {
        setIsJoined(true);
        setRemotePeers(response.peers || []);
        console.log('Joined room successfully');
      } else {
        console.error('Failed to join room:', response.error);
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('Error joining room:', error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [makeRequest, connect, isConnected]);

  return {
    isJoined,
    isConnecting,
    remotePeers,
    joinRoom,
  };
};