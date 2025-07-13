'use client';

import { useEffect, useRef, useState } from 'react';
import { useProtoo } from '../hooks/useProtoo';
import { useProtooRoom } from '../hooks/useProtooRoom';
import { useProtooMediaStream } from '../hooks/useProtooMediaStream';
import { useProtooMediasoup } from '../hooks/useProtooMediasoup';

export default function Home() {
  const webrtcSetupCompleted = useRef(false);
  
  // State for room and peer IDs
  const [roomId, setRoomId] = useState<string>('');
  const [peerId, setPeerId] = useState<string>('');

  // Initialize protoo hook (connection happens on demand)
  const { protooPeer, isConnected, makeRequest, connect } = useProtoo();
  const { isJoined, isConnecting, remotePeers, joinRoom } = useProtooRoom(protooPeer, isConnected, makeRequest, connect);
  
  const {
    device,
    getRouterRtpCapabilities,
    createDevice,
    createSendTransport,
    connectSendTransport,
    getExistingProducers,
    consumeMedia,
    producers,
  } = useProtooMediasoup(protooPeer, makeRequest, roomId, peerId);

  const { 
    params, 
    mediaInitialized, 
    videoMuted, 
    audioMuted, 
    videoRef, 
    initializeMedia, 
    toggleVideo, 
    toggleAudio 
  } = useProtooMediaStream({ protooPeer, makeRequest, producers });

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
    if (!protooPeer || !device || !isJoined) return;

    const handleNewProducer = (event: CustomEvent) => {
      const data = event.detail;
      console.log('Consuming new producer:', data);
      if (data.producerPeerId !== peerId) {
        consumeMedia(data.producerPeerId, data.kind);
      }
    };

    window.addEventListener('new-producer', handleNewProducer as EventListener);

    return () => {
      window.removeEventListener('new-producer', handleNewProducer as EventListener);
    };
  }, [protooPeer, device, isJoined, peerId, consumeMedia]);

  // Auto-setup WebRTC flow when room is joined
  useEffect(() => {
    if (!isJoined || !mediaInitialized || !protooPeer || webrtcSetupCompleted.current) return;

    const setupWebRTC = async () => {
      try {
        console.log('Starting WebRTC setup...');
        webrtcSetupCompleted.current = true;
        
        // Step 1: Get router capabilities
        console.log('Step 1: Getting router capabilities...');
        const capabilities = await getRouterRtpCapabilities();
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
        const transport = await createSendTransport(createdDevice);
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
        await getExistingProducers();
        console.log('✓ Consuming existing producers');
        
      } catch (error) {
        console.error('Error in WebRTC setup:', error);
        webrtcSetupCompleted.current = false; // Reset on error to allow retry
      }
    };

    setupWebRTC();
  }, [isJoined, mediaInitialized, protooPeer, params, getRouterRtpCapabilities, createDevice, createSendTransport, connectSendTransport, getExistingProducers]);

  const handleJoinRoom = async () => {
    if (!roomId || !peerId) {
      alert('Please enter both Room ID and Peer ID');
      return;
    }
    
    try {
      await joinRoom(roomId, peerId);
    } catch (error) {
      console.error('Failed to join room:', error);
      alert('Failed to join room. Please check the console for details.');
    }
  };

  return (
    <main style={{ padding: '20px' }}>
      <h1>MediaSoup WebRTC Demo (Protoo)</h1>
      
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
        <button onClick={handleJoinRoom} disabled={!roomId || !peerId || isJoined || isConnecting}>
          {isJoined ? 'Joined' : isConnecting ? 'Connecting...' : 'Join Room'}
        </button>
      </div>

      {/* Status */}
      <div style={{ marginBottom: '20px' }}>
        <p>Protoo: {
          !roomId || !peerId ? '⏸️ Enter Room & Peer ID to connect' :
          isConnected ? '✅ Connected' : 
          isConnecting ? '⏳ Connecting...' : '⏸️ Click Join Room to connect'
        }</p>
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