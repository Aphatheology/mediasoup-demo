'use client';

import { useEffect, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useRoom } from '../hooks/useRoom';
import { useMediaStream } from '../hooks/useMediaStream';
import { useMediasoup } from '../hooks/useMediasoup';

export default function Home() {
  const webrtcSetupCompleted = useRef(false);
  
  const { socket, isConnected } = useSocket();
  const { roomId, peerId, isJoined, remotePeers, setRoomId, setPeerId, joinRoom, leaveRoom } = useRoom(socket);
  
  const {
    device,
    rtpCapabilities,
    getRouterRtpCapabilities,
    createDevice,
    createSendTransport,
    connectSendTransport,
    getExistingProducers,
    consumeMedia,
    producers,
  } = useMediasoup(socket);

  const { 
    params, 
    mediaInitialized, 
    videoMuted, 
    audioMuted, 
    videoRef, 
    initializeMedia, 
    toggleVideo, 
    toggleAudio,
    cleanupMedia 
  } = useMediaStream({ socket, roomId, peerId, producers });

  // Auto-initialize media when component mounts
  useEffect(() => {
    initializeMedia();
  }, [initializeMedia]);

  // Reset WebRTC setup flag when leaving room
  useEffect(() => {
    if (!isJoined) {
      webrtcSetupCompleted.current = false;
    }
  }, [isJoined]);

  // Listen for new producers and consume them
  useEffect(() => {
    if (!socket || !device || !isJoined) return;

    const handleNewProducer = (data: any) => {
      console.log('Consuming new producer:', data);
      if (data.producerPeerId !== peerId) {
        consumeMedia(data.producerPeerId, data.kind, roomId, peerId);
      }
    };

    socket.on('new-producer', handleNewProducer);

    return () => {
      socket.off('new-producer', handleNewProducer);
    };
  }, [socket, device, isJoined, peerId, roomId, consumeMedia]);

  // Listen for producer pause/resume events from server
  useEffect(() => {
    if (!socket) return;

    const handleProducerPaused = (data: any) => {
      console.log(`Producer paused: ${data.peerId} ${data.kind}`);
      // Handle visual feedback for paused state if needed
    };

    const handleProducerResumed = (data: any) => {
      console.log(`Producer resumed: ${data.peerId} ${data.kind}`);
      // Handle visual feedback for resumed state if needed
    };

    socket.on('producerPaused', handleProducerPaused);
    socket.on('producerResumed', handleProducerResumed);

    return () => {
      socket.off('producerPaused', handleProducerPaused);
      socket.off('producerResumed', handleProducerResumed);
    };
  }, [socket]);

  // Auto-setup WebRTC flow when room is joined
  useEffect(() => {
    if (!isJoined || !mediaInitialized || !socket || webrtcSetupCompleted.current) return;

    const setupWebRTC = async () => {
      try {
        console.log('Starting WebRTC setup...');
        webrtcSetupCompleted.current = true;
        
        // Step 1: Get router capabilities
        console.log('Step 1: Getting router capabilities...');
        const capabilities = await getRouterRtpCapabilities(roomId);
        if (!capabilities) {
          throw new Error('Failed to get router capabilities');
        }
        console.log('✓ Router capabilities obtained');
        
        // Step 2: Create device with the capabilities we just received
        console.log('Step 2: Creating device...');
        const createdDevice = await createDevice(capabilities);
        console.log('✓ Device created:', !!createdDevice);
        
        if (!createdDevice) {
          throw new Error('Failed to create device');
        }
        
        // Step 3: Create send transport
        console.log('Step 3: Creating send transport...');
        const transport = await createSendTransport(roomId, peerId, createdDevice);
        if (!transport) {
          throw new Error('Failed to create send transport');
        }
        console.log('✓ Send transport created');
        
        // Step 4: Connect send transport and produce
        console.log('Step 4: Connecting send transport...');
        await connectSendTransport(params, transport);
        console.log('✓ Media production started');
        
        // Step 5: Get and consume existing producers
        console.log('Step 5: Getting existing producers...');
        await getExistingProducers(roomId, peerId);
        console.log('✓ Consuming existing producers');
        
      } catch (error) {
        console.error('Error in WebRTC setup:', error);
        webrtcSetupCompleted.current = false; // Reset on error to allow retry
      }
    };

    setupWebRTC();
  }, [isJoined, mediaInitialized, socket, roomId, peerId]);

  return (
    <main style={{ padding: '20px' }}>
      <h1>MediaSoup WebRTC Demo</h1>
      
      {/* Room Management */}
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          style={{ marginRight: '10px', padding: '5px' }}
        />
        <input
          type="text"
          placeholder="Your Peer ID"
          value={peerId}
          onChange={(e) => setPeerId(e.target.value)}
          style={{ marginRight: '10px', padding: '5px' }}
        />
        <button onClick={joinRoom} disabled={!roomId || !peerId || isJoined || !isConnected}>
          {isJoined ? 'Joined' : 'Join Room'}
        </button>
      </div>

      {/* Status */}
      <div style={{ marginBottom: '20px' }}>
        <p>Socket: {isConnected ? '✅ Connected' : '⏳ Connecting...'}</p>
        <p>Media: {mediaInitialized ? '✅ Ready' : '⏳ Initializing...'}</p>
        <p>Room: {isJoined ? '✅ Joined' : '❌ Not joined'}</p>
        <p>Device: {device ? '✅ Ready' : '❌ Not ready'}</p>
        <p>Remote Peers: {remotePeers.length}</p>
      </div>

      {/* Local Video */}
      <div style={{ marginBottom: '20px' }}>
        <h3>You ({peerId})</h3>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{ 
              width: '300px', 
              height: '200px',
              border: '2px solid #007bff',
              borderRadius: '8px',
              backgroundColor: '#000',
              display: videoMuted ? 'none' : 'block' 
            }} 
          />
          {videoMuted && (
            <div style={{
              width: '300px',
              height: '200px',
              border: '2px solid #007bff',
              borderRadius: '8px',
              backgroundColor: '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '16px',
              fontWeight: 'bold'
            }}>
              📷 Camera Off
            </div>
          )}
        </div>
        
        {/* Media Controls */}
        <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
          <button 
            onClick={toggleVideo}
            style={{
              padding: '8px 16px',
              backgroundColor: videoMuted ? '#dc3545' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {videoMuted ? '📷 Turn On Camera' : '📷 Turn Off Camera'}
          </button>
          <button 
            onClick={toggleAudio}
            style={{
              padding: '8px 16px',
              backgroundColor: audioMuted ? '#dc3545' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {audioMuted ? '🎤 Unmute' : '🎤 Mute'}
          </button>
          {isJoined && (
            <button 
              onClick={() => leaveRoom(cleanupMedia)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              🚪 Leave Room
            </button>
          )}
        </div>
      </div>

      {/* Remote Videos */}
      <div style={{ marginBottom: '20px' }}>
        <h3>Participants ({remotePeers.length})</h3>
        <div id="remote-videos" style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '10px',
          minHeight: '50px'
        }}>
          {remotePeers.length === 0 && isJoined && (
            <p style={{ color: '#666' }}>No other participants yet...</p>
          )}
        </div>
      </div>
    </main>
  );
}
