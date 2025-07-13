import { useState, useCallback, useRef } from 'react';
import { Device } from 'mediasoup-client';
import { Transport, RtpCapabilities } from 'mediasoup-client/types';
import { Peer } from 'protoo-client';

interface MediaParams {
  video: {
    encoding: Array<{
      rid: string;
      maxBitrate: number;
      scalabilityMode: string;
    }>;
    codecOptions: { videoGoogleStartBitrate: number };
    track: MediaStreamTrack | null;
  };
  audio: {
    track: MediaStreamTrack | null;
  };
}

interface UseProtooMediasoupReturn {
  device: Device | null;
  rtpCapabilities: RtpCapabilities | null;
  producerTransport: Transport | null;
  consumerTransports: { [key: string]: Transport };
  producers: { video?: any; audio?: any };
  getRouterRtpCapabilities: () => Promise<RtpCapabilities | null>;
  createDevice: (capabilities?: RtpCapabilities) => Promise<Device | null>;
  createSendTransport: (deviceOverride?: Device) => Promise<Transport | null>;
  connectSendTransport: (params: MediaParams, transport?: Transport) => Promise<void>;
  createRecvTransport: (producerPeerId: string) => Promise<Transport>;
  consumeMedia: (producerPeerId: string, kind: 'video' | 'audio') => Promise<void>;
  getExistingProducers: () => Promise<void>;
}

export const useProtooMediasoup = (
  protooPeer: Peer | null,
  makeRequest: (method: string, data?: any) => Promise<any>,
  roomId: string,
  peerId: string
): UseProtooMediasoupReturn => {
  const [device, setDevice] = useState<Device | null>(null);
  const [rtpCapabilities, setRtpCapabilities] = useState<RtpCapabilities | null>(null);
  const [producerTransport, setProducerTransport] = useState<Transport | null>(null);
  const [consumerTransports, setConsumerTransports] = useState<{ [key: string]: Transport }>({});
  const [producers, setProducers] = useState<{ video?: any; audio?: any }>({});
  
  const deviceRef = useRef<Device | null>(null);
  const remoteVideosRef = useRef<{ [peerId: string]: HTMLVideoElement }>({});

  const getRouterRtpCapabilities = useCallback(async () => {
    if (!protooPeer) return null;
    
    try {
      const response = await makeRequest('getRouterRtpCapabilities');
      setRtpCapabilities(response.routerRtpCapabilities);
      console.log('Router RTP capabilities received');
      return response.routerRtpCapabilities;
    } catch (error) {
      console.error('Error getting router capabilities:', error);
      return null;
    }
  }, [protooPeer, makeRequest]);

  const createDevice = useCallback(async (capabilities?: RtpCapabilities) => {
    const capsToUse = capabilities || rtpCapabilities;
    
    console.log('createDevice called with:', { 
      passedCapabilities: !!capabilities,
      rtpCapabilities: !!rtpCapabilities, 
      device: !!device, 
      deviceRef: !!deviceRef.current 
    });
    
    if (!capsToUse) {
      console.log('No RTP capabilities available');
      return null;
    }
    
    if (device || deviceRef.current) {
      console.log('Device already exists');
      return device || deviceRef.current;
    }
    
    try {
      console.log('Creating new MediaSoup device...');
      const newDevice = new Device();
      console.log('Device instance created, loading capabilities...');
      await newDevice.load({ routerRtpCapabilities: capsToUse });
      console.log('Device loaded successfully, updating state...');
      setDevice(newDevice);
      deviceRef.current = newDevice;
      console.log('Device created successfully and state updated');
      return newDevice;
    } catch (error: any) {
      console.error('Error creating device:', error);
      if (error.name === 'UnsupportedError') {
        console.error('Browser not supported');
      }
      return null;
    }
  }, [rtpCapabilities, device]);

  const createSendTransport = useCallback(async (deviceOverride?: Device) => {
    const deviceToUse = deviceOverride || device;
    
    console.log('createSendTransport called with:', { 
      roomId, 
      peerId, 
      hasProtooPeer: !!protooPeer, 
      hasDevice: !!device,
      hasDeviceOverride: !!deviceOverride,
      hasDeviceToUse: !!deviceToUse
    });
    
    if (!protooPeer || !deviceToUse) {
      console.log('Missing protoo peer or device for transport creation');
      return null;
    }

    try {
      console.log('Making createTransport request...');
      const response = await makeRequest('createTransport', { sender: true });
      console.log('Received createTransport response:', { hasParams: !!response, hasError: !!response?.error });
      
      if (response.error) {
        console.error('Error creating send transport:', response.error);
        throw new Error(response.error);
      }

      console.log('Creating device send transport with params:', response);
      const transport = deviceToUse.createSendTransport(response);
      console.log('Device transport created successfully');

      transport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
        try {
          console.log('Transport connect event, making connectProducerTransport request...');
          await makeRequest('connectProducerTransport', { dtlsParameters });
          callback();
        } catch (error) {
          console.error('Error in transport connect:', error);
          errback(error);
        }
      });

      transport.on('produce', async (parameters: any, callback: any, errback: any) => {
        const { kind, rtpParameters } = parameters;
        try {
          console.log(`Transport produce event for ${kind}, making transport-produce request...`);
          const response = await makeRequest('transport-produce', { kind, rtpParameters });
          console.log(`Producer created with id: ${response.id} for ${kind}`);
          callback({ id: response.id });
        } catch (error) {
          console.error('Error in transport produce:', error);
          errback(error);
        }
      });

      setProducerTransport(transport);
      console.log('Send transport created and configured');
      return transport;
    } catch (error) {
      console.error('Error creating send transport:', error);
      throw error;
    }
  }, [protooPeer, device, makeRequest]);

  const connectSendTransport = useCallback(async (params: MediaParams, transport?: Transport) => {
    const transportToUse = transport || producerTransport;
    
    console.log('connectSendTransport called with params:', {
      hasVideoTrack: !!params.video.track,
      hasAudioTrack: !!params.audio.track,
      hasProducerTransport: !!producerTransport,
      hasPassedTransport: !!transport,
      transportToUse: !!transportToUse
    });
    
    if (!transportToUse) {
      console.log('No producer transport available');
      return;
    }

    const producePromises = [];
    
    // Produce video if available
    if (params.video.track) {
      console.log('Producing video track...');
      const videoProducer = await transportToUse.produce({
        track: params.video.track,
        encodings: params.video.encoding,
        codecOptions: params.video.codecOptions,
      });
      console.log('Video producer created:', videoProducer.id);
      setProducers(prev => ({ ...prev, video: videoProducer }));
      producePromises.push(videoProducer);
    } else {
      console.log('No video track available for production');
    }
    
    // Produce audio if available
    if (params.audio.track) {
      console.log('Producing audio track...');
      const audioProducer = await transportToUse.produce({
        track: params.audio.track,
      });
      console.log('Audio producer created:', audioProducer.id);
      setProducers(prev => ({ ...prev, audio: audioProducer }));
      producePromises.push(audioProducer);
    } else {
      console.log('No audio track available for production');
    }

    // Set up event handlers
    producePromises.forEach(producer => {
      producer?.on('trackended', () => console.log('Track ended'));
      producer?.on('transportclose', () => console.log('Transport closed'));
    });

    console.log('Media production complete');
  }, [producerTransport]);

  const createRecvTransport = useCallback(async (producerPeerId: string): Promise<Transport> => {
    const deviceToUse = device || deviceRef.current;
    
    if (!protooPeer || !deviceToUse) throw new Error('Protoo peer or device not available');

    try {
      const response = await makeRequest('createTransport', { sender: false, producerPeerId });
      
      if (response.error) {
        throw new Error(response.error);
      }

      const transport = deviceToUse.createRecvTransport(response);

      transport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
        try {
          await makeRequest('connectConsumerTransport', { dtlsParameters, producerPeerId });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      return transport;
    } catch (error) {
      console.error('Error creating recv transport:', error);
      throw error;
    }
  }, [protooPeer, device, makeRequest]);

  const createOrUpdateRemoteMediaElement = useCallback((producerPeerId: string, track: MediaStreamTrack) => {
    let videoElement = remoteVideosRef.current[producerPeerId];
    let stream: MediaStream;

    if (!videoElement) {
      // Create new video element
      videoElement = document.createElement('video');
      videoElement.autoplay = true;
      videoElement.playsInline = true;
      videoElement.muted = false; // Important: Don't mute remote audio
      videoElement.volume = 1.0;
      videoElement.controls = false; // Remove controls to prevent user pause
      videoElement.style.width = '100%';
      videoElement.style.height = '100%';
      videoElement.style.objectFit = 'cover';
      videoElement.style.borderRadius = '12px';

      stream = new MediaStream();
      videoElement.srcObject = stream;

      // Add label
      const label = document.createElement('div');
      label.textContent = `${producerPeerId}`;
      label.style.position = 'absolute';
      label.style.bottom = '10px';
      label.style.left = '10px';
      label.style.backgroundColor = 'rgba(0,0,0,0.7)';
      label.style.color = 'white';
      label.style.padding = '4px 8px';
      label.style.borderRadius = '4px';
      label.style.fontSize = '12px';
      label.style.fontWeight = 'bold';

      const container = document.createElement('div');
      container.setAttribute('data-peer-id', producerPeerId);
      container.style.position = 'relative';
      container.style.width = '300px';
      container.style.height = '200px';
      container.style.margin = '10px';
      container.style.borderRadius = '12px';
      container.style.overflow = 'hidden';
      container.appendChild(videoElement);
      container.appendChild(label);

      // Add to DOM
      const remoteContainer = document.getElementById('remote-videos');
      if (remoteContainer) {
        remoteContainer.appendChild(container);
        remoteVideosRef.current[producerPeerId] = videoElement;
      }
    } else {
      stream = videoElement.srcObject as MediaStream;
    }

    // Add track to stream
    stream.addTrack(track);
    
    // Handle track events
    track.addEventListener('ended', () => {
      console.log(`Track ended for ${producerPeerId}: ${track.kind}`);
      // Remove track from stream when it ends
      stream.removeTrack(track);
      
      // If this was a video track and there's no video track left, show placeholder
      if (track.kind === 'video' && !stream.getVideoTracks().length) {
        const container = videoElement.parentElement;
        if (container) {
          videoElement.style.display = 'none';
          // Add placeholder if not exists
          let placeholder = container.querySelector('.video-placeholder') as HTMLDivElement;
          if (!placeholder) {
            placeholder = document.createElement('div') as HTMLDivElement;
            placeholder.className = 'video-placeholder';
            placeholder.style.width = '100%';
            placeholder.style.height = '100%';
            placeholder.style.backgroundColor = '#333';
            placeholder.style.border = '2px solid #007bff';
            placeholder.style.borderRadius = '12px';
            placeholder.style.display = 'flex';
            placeholder.style.alignItems = 'center';
            placeholder.style.justifyContent = 'center';
            placeholder.style.color = 'white';
            placeholder.style.fontSize = '16px';
            placeholder.style.fontWeight = 'bold';
            placeholder.textContent = '📷 Camera Off';
            container.appendChild(placeholder);
          }
          placeholder.style.display = 'flex';
        }
      }
    });
    
    track.addEventListener('unmute', () => {
      console.log(`Track unmuted for ${producerPeerId}: ${track.kind}`);
      if (track.kind === 'video') {
        videoElement.style.display = 'block';
        const placeholder = videoElement.parentElement?.querySelector('.video-placeholder') as HTMLDivElement;
        if (placeholder) {
          placeholder.style.display = 'none';
        }
      }
    });

    track.addEventListener('mute', () => {
      console.log(`Track muted for ${producerPeerId}: ${track.kind}`);
      if (track.kind === 'video') {
        videoElement.style.display = 'none';
        const container = videoElement.parentElement;
        if (container) {
          // Add placeholder if not exists
          let placeholder = container.querySelector('.video-placeholder') as HTMLDivElement;
          if (!placeholder) {
            placeholder = document.createElement('div') as HTMLDivElement;
            placeholder.className = 'video-placeholder';
            placeholder.style.width = '100%';
            placeholder.style.height = '100%';
            placeholder.style.backgroundColor = '#333';
            placeholder.style.border = '2px solid #007bff';
            placeholder.style.borderRadius = '12px';
            placeholder.style.display = 'flex';
            placeholder.style.alignItems = 'center';
            placeholder.style.justifyContent = 'center';
            placeholder.style.color = 'white';
            placeholder.style.fontSize = '16px';
            placeholder.style.fontWeight = 'bold';
            placeholder.textContent = '📷 Camera Off';
            container.appendChild(placeholder);
          }
          placeholder.style.display = 'flex';
        }
      }
    });
    
    // For audio tracks, ensure the video element is ready to play audio
    if (track.kind === 'audio') {
      console.log(`Adding audio track for ${producerPeerId}, track enabled: ${track.enabled}`);
      videoElement.muted = false;
      videoElement.volume = 1.0;
      
      // Force unmute and set volume
      setTimeout(() => {
        videoElement.muted = false;
        videoElement.volume = 1.0;
        console.log(`Audio element configured: muted=${videoElement.muted}, volume=${videoElement.volume}`);
      }, 100);
    }
    
    // For video tracks, ensure video is visible
    if (track.kind === 'video') {
      videoElement.style.display = 'block';
      const placeholder = videoElement.parentElement?.querySelector('.video-placeholder') as HTMLDivElement;
      if (placeholder) {
        placeholder.style.display = 'none';
      }
    }
    
    // Play the video element with better autoplay handling
    const attemptPlay = () => {
      const playPromise = videoElement.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log(`Media playback started for ${producerPeerId} (${track.kind})`);
        }).catch(error => {
          console.log(`Autoplay failed for ${producerPeerId} (${track.kind}):`, error.name);
          // Add visual indicator for user to click to enable media
          if (!videoElement.parentElement?.querySelector('.play-button')) {
            const playButton = document.createElement('div');
            playButton.className = 'play-button';
            playButton.style.position = 'absolute';
            playButton.style.top = '50%';
            playButton.style.left = '50%';
            playButton.style.transform = 'translate(-50%, -50%)';
            playButton.style.backgroundColor = 'rgba(0,0,0,0.7)';
            playButton.style.color = 'white';
            playButton.style.padding = '10px';
            playButton.style.borderRadius = '50%';
            playButton.style.cursor = 'pointer';
            playButton.style.fontSize = '20px';
            playButton.style.zIndex = '1000';
            playButton.textContent = '▶️';
            playButton.title = 'Click to play media';
            
            playButton.onclick = () => {
              videoElement.play().then(() => {
                playButton.remove();
                console.log(`Media playback started for ${producerPeerId} after user interaction`);
              });
            };
            
            videoElement.parentElement?.appendChild(playButton);
          }
        });
      }
    };

    attemptPlay();
  }, []);

  const consumeMedia = useCallback(async (producerPeerId: string, kind: 'video' | 'audio') => {
    // Wait for device to be available if not immediately ready
    let deviceToUse = device || deviceRef.current;
    let retryCount = 0;
    const maxRetries = 10;
    
    console.log(`consumeMedia attempt ${retryCount + 1}:`, { producerPeerId, kind, hasProtooPeer: !!protooPeer, hasDevice: !!device, hasDeviceRef: !!deviceRef.current, hasDeviceToUse: !!deviceToUse });
    
    while (!protooPeer || !deviceToUse) {
      if (retryCount >= maxRetries - 1) {
        console.error('Device not available after retries for consuming media');
        return;
      }
      
      console.log(`Retrying consumeMedia (attempt ${retryCount + 2})...`);
      // Wait 200ms before retry
      await new Promise(resolve => setTimeout(resolve, 200));
      retryCount++;
      
      deviceToUse = device || deviceRef.current;
      console.log(`consumeMedia attempt ${retryCount + 1}:`, { producerPeerId, kind, hasProtooPeer: !!protooPeer, hasDevice: !!device, hasDeviceRef: !!deviceRef.current, hasDeviceToUse: !!deviceToUse });
    }

    try {
      // Get or create transport for this producer peer
      let transport = consumerTransports[producerPeerId];
      if (!transport) {
        transport = await createRecvTransport(producerPeerId);
        setConsumerTransports(prev => ({ ...prev, [producerPeerId]: transport }));
      }

      // Consume media
      const response = await makeRequest('consumeMedia', { 
        rtpCapabilities: deviceToUse.rtpCapabilities,
        producerPeerId, 
        kind 
      });

      if (response.error) {
        throw new Error(response.error);
      }

      const consumer = await transport.consume({
        id: response.id,
        producerId: response.producerId,
        kind: response.kind,
        rtpParameters: response.rtpParameters,
      });

      const { track } = consumer;
      createOrUpdateRemoteMediaElement(producerPeerId, track);

      // Resume consumer
      await makeRequest('resumePausedConsumer', { producerPeerId, kind });
      
    } catch (error) {
      console.error('Error consuming media:', error);
    }
  }, [protooPeer, device, consumerTransports, createRecvTransport, createOrUpdateRemoteMediaElement, makeRequest]);

  const getExistingProducers = useCallback(async () => {
    if (!protooPeer) return;

    try {
      const response = await makeRequest('getExistingProducers');
      if (response.producers) {
        console.log('Found existing producers:', response.producers);
        response.producers.forEach((producer: any, index: number) => {
          if (producer.peerId !== peerId) {
            setTimeout(() => {
              console.log(`Attempting to consume ${producer.kind} from ${producer.peerId}...`);
              consumeMedia(producer.peerId, producer.kind);
            }, (index + 1) * 1000);
          }
        });
      }
    } catch (error) {
      console.error('Error getting existing producers:', error);
    }
  }, [protooPeer, peerId, consumeMedia, makeRequest]);

  return {
    device,
    rtpCapabilities,
    producerTransport,
    consumerTransports,
    producers,
    getRouterRtpCapabilities,
    createDevice,
    createSendTransport,
    connectSendTransport,
    createRecvTransport,
    consumeMedia,
    getExistingProducers,
  };
};