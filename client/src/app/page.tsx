'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import {
    DtlsParameters,
    IceCandidate,
    IceParameters,
    Transport,
    RtpCapabilities,
    Producer,
    Consumer,
} from 'mediasoup-client/types';

export default function Home() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideosRef = useRef<{ [peerId: string]: HTMLVideoElement }>({});
    const initializingRef = useRef(false); // Prevent double initialization
    const joiningRef = useRef(false); // Prevent double joining

    const [roomId, setRoomId] = useState<string>('');
    const [peerId, setPeerId] = useState<string>('');
    const [isJoined, setIsJoined] = useState<boolean>(false);
    const [isConnecting, setIsConnecting] = useState<boolean>(false);
    const [remotePeers, setRemotePeers] = useState<string[]>([]);

    // Media controls
    const [videoMuted, setVideoMuted] = useState<boolean>(false);
    const [audioMuted, setAudioMuted] = useState<boolean>(false);
    const [currentStream, setCurrentStream] = useState<MediaStream | null>(
        null
    );
    const [mediaInitialized, setMediaInitialized] = useState<boolean>(false);

    const [params, setParams] = useState({
        video: {
            encoding: [
                { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
                { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
                { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
            ],
            codecOptions: { videoGoogleStartBitrate: 1000 },
            track: null as MediaStreamTrack | null,
        },
        audio: {
            track: null as MediaStreamTrack | null,
        },
    });

    const [device, setDevice] = useState<Device | null>(null);
    const [socket, setSocket] = useState<any>(null);
    const socketRef = useRef<any>(null);
    const deviceRef = useRef<Device | null>(null); // Add device ref
    const [rtpCapabilities, setRtpCapabilities] =
        useState<RtpCapabilities | null>(null);
    const [producerTransport, setProducerTransport] =
        useState<Transport | null>(null);
    const [consumerTransports, setConsumerTransports] = useState<{
        [key: string]: Transport;
    }>({});
    const [producers, setProducers] = useState<{
        video?: Producer;
        audio?: Producer;
    }>({});
    const [setupComplete, setSetupComplete] = useState<boolean>(false);

    // Initialize media on component mount
    useEffect(() => {
        if (!initializingRef.current) {
            initializingRef.current = true;
            initializeMedia();
        }
    }, []);

    useEffect(() => {
        // Get roomId and peerId from URL params
        const urlParams = new URLSearchParams(window.location.search);
        const urlRoomId = urlParams.get('roomId') || '';
        const urlPeerId = urlParams.get('peerId') || '';

        setRoomId(urlRoomId);
        setPeerId(urlPeerId);
    }, []);

    useEffect(() => {
        if (!roomId || !peerId) return;

        // Prevent multiple socket connections
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        const newSocket = io(
            `https://mediasoup-demo-server.onrender.com/mediasoup`,
            {
                forceNew: true,
                timeout: 20000,
                transports: ['websocket', 'polling'],
            }
        );

        setSocket(newSocket);
        socketRef.current = newSocket;

        newSocket.on('connection-success', (data) => {
            console.log('Connected to server:', data);
        });

        newSocket.on('peer-joined', (data) => {
            console.log('Peer joined:', data);
            setRemotePeers((prev) => {
                if (!prev.includes(data.peerId)) {
                    return [...prev, data.peerId];
                }
                return prev;
            });
        });

        newSocket.on('peer-left', (data) => {
            console.log('Peer left:', data);
            setRemotePeers((prev) => prev.filter((p) => p !== data.peerId));
            cleanupRemotePeer(data.peerId);
        });

        newSocket.on('new-producer', async (data) => {
            console.log('New producer available:', data);

            // Wait a bit and then consume the new producer
            setTimeout(async () => {
                try {
                    console.log(
                        `Attempting to consume new ${data.kind} from ${data.producerPeerId}`
                    );
                    // Use deviceRef for immediate access
                    await consumeMedia(
                        data.producerPeerId,
                        data.kind,
                        deviceRef.current || undefined
                    );
                    console.log(
                        `Successfully consumed new ${data.kind} from ${data.producerPeerId}`
                    );
                } catch (error) {
                    console.error('Error consuming new producer:', error);
                }
            }, 1000);
        });

        // Cleanup function
        return () => {
            if (newSocket) {
                newSocket.disconnect();
            }
        };
    }, [roomId, peerId]); // Removed setupComplete and device from dependencies

    const initializeMedia = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });

            setCurrentStream(stream);
            setMediaInitialized(true);

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }

            // Set up tracks
            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];

            // Enable tracks by default (camera and mic ON)
            if (videoTrack) {
                videoTrack.enabled = true;
                setVideoMuted(false); // Video is NOT muted by default
            }
            if (audioTrack) {
                audioTrack.enabled = true;
                setAudioMuted(false); // Audio is NOT muted by default
            }

            setParams((prev) => ({
                ...prev,
                video: { ...prev.video, track: videoTrack || null },
                audio: { ...prev.audio, track: audioTrack || null },
            }));

            console.log(
                'Media initialized - Camera and microphone are ON by default'
            );
            console.log('Video track enabled:', videoTrack?.enabled);
            console.log('Audio track enabled:', audioTrack?.enabled);
        } catch (error) {
            console.error('Error accessing media:', error);
        }
    };

    const cleanupRemotePeer = (peerId: string) => {
        const videoElement = remoteVideosRef.current[peerId];

        if (videoElement) {
            videoElement.srcObject = null;
            videoElement.parentElement?.remove();
            delete remoteVideosRef.current[peerId];
        }
    };

    const toggleVideo = async () => {
        if (!currentStream) return;

        if (videoMuted) {
            // Unmute: get new video track
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                });

                const newVideoTrack = newStream.getVideoTracks()[0];

                // Replace the old track with new one
                const oldVideoTrack = currentStream.getVideoTracks()[0];
                if (oldVideoTrack) {
                    currentStream.removeTrack(oldVideoTrack);
                    oldVideoTrack.stop();
                }

                currentStream.addTrack(newVideoTrack);

                // Update the video element
                if (videoRef.current) {
                    videoRef.current.srcObject = currentStream;
                }

                // Update params
                setParams((prev) => ({
                    ...prev,
                    video: { ...prev.video, track: newVideoTrack },
                }));

                // Replace track in producer if it exists
                if (producers.video && newVideoTrack) {
                    await producers.video.replaceTrack({
                        track: newVideoTrack,
                    });
                }

                setVideoMuted(false);
                console.log('Video unmuted and camera turned on');
            } catch (error) {
                console.error('Error turning on camera:', error);
            }
        } else {
            // Mute: stop the video track to turn off camera light
            const videoTrack = currentStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop(); // This will turn off the camera light
                currentStream.removeTrack(videoTrack);

                // Update params
                setParams((prev) => ({
                    ...prev,
                    video: { ...prev.video, track: null },
                }));

                // Pause the producer
                if (producers.video) {
                    producers.video.pause();
                }

                setVideoMuted(true);
                console.log('Video muted and camera turned off');
            }
        }
    };

    const toggleAudio = () => {
        if (currentStream) {
            const audioTrack = currentStream.getAudioTracks()[0];
            if (audioTrack) {
                if (audioMuted) {
                    // Unmute: enable the track
                    audioTrack.enabled = true;
                    setAudioMuted(false);

                    // Resume the producer
                    if (producers.audio) {
                        producers.audio.resume();
                    }
                } else {
                    // Mute: disable the track
                    audioTrack.enabled = false;
                    setAudioMuted(true);

                    // Pause the producer
                    if (producers.audio) {
                        producers.audio.pause();
                    }
                }
            }
        }
    };

    const joinRoom = async () => {
        if (!socket || !roomId || !peerId || !mediaInitialized) {
            console.log('Missing requirements for joining room:', {
                socket: !!socket,
                roomId: !!roomId,
                peerId: !!peerId,
                mediaInitialized,
            });
            return;
        }

        // Prevent double joining
        if (joiningRef.current || isConnecting) {
            console.log('Already joining room, skipping...');
            return;
        }

        joiningRef.current = true;
        setIsConnecting(true);

        try {
            // Step 1: Join room
            console.log('Step 1: Joining room...');
            const joinResponse = await new Promise<{
                success: boolean;
                peers: string[];
            }>((resolve, reject) => {
                socket.emit(
                    'join-room',
                    { roomId, peerId },
                    (response: {
                        success: boolean;
                        peers: string[];
                        error?: any;
                    }) => {
                        if (response.success) {
                            setIsJoined(true);
                            console.log(
                                'Joined room successfully with peers:',
                                response.peers
                            );
                            setRemotePeers(response.peers || []); // Set initial list of peers
                            resolve(response);
                        } else {
                            console.error(
                                'Failed to join room:',
                                response.error
                            );
                            reject(response.error);
                        }
                    }
                );
            });

            // Step 2: Get router capabilities
            console.log('Step 2: Getting router capabilities...');
            const rtpCaps = await new Promise<RtpCapabilities>(
                (resolve, reject) => {
                    socket.emit(
                        'getRouterRtpCapabilities',
                        { roomId },
                        (data: any) => {
                            if (data.error) {
                                reject(data.error);
                                return;
                            }
                            const capabilities =
                                data.routerRtpCapabilities as RtpCapabilities;
                            setRtpCapabilities(capabilities);
                            console.log(
                                'Got router RTP capabilities:',
                                capabilities
                            );
                            resolve(capabilities);
                        }
                    );
                }
            );

            // Step 3: Create device
            console.log('Step 3: Creating device...');
            const newDevice = new Device();
            await newDevice.load({ routerRtpCapabilities: rtpCaps });
            setDevice(newDevice);
            deviceRef.current = newDevice; // Store in ref for immediate access
            console.log('Device created and loaded');
            console.log('Device RTP capabilities:', newDevice.rtpCapabilities);

            // Step 4: Create send transport
            console.log('Step 4: Creating send transport...');
            const transport = await createSendTransport(newDevice);
            setProducerTransport(transport);
            console.log('Send transport created');

            // Step 5: Produce media
            console.log('Step 5: Producing media...');
            const producePromises = [];
            if (params.video.track) {
                console.log('Producing video...');
                producePromises.push(produceVideo(transport));
            }
            if (params.audio.track) {
                console.log('Producing audio...');
                producePromises.push(produceAudio(transport));
            }
            await Promise.all(producePromises);
            console.log('Media production complete');

            // Step 6: Setup complete, consume existing producers
            console.log(
                'Step 6: Setup complete, consuming existing producers...'
            );
            setSetupComplete(true);

            // Longer delay to ensure all producers are registered and device is ready
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Use the device directly instead of relying on state
            await consumeAllExistingProducers(newDevice);

            console.log('All setup complete!');
        } catch (error) {
            console.error('Error during setup:', error);
            setIsJoined(false);
            setSetupComplete(false);
        } finally {
            setIsConnecting(false);
            joiningRef.current = false;
        }
    };

    const createSendTransport = async (device: Device): Promise<Transport> => {
        return new Promise((resolve, reject) => {
            socket.emit(
                'createTransport',
                { sender: true, roomId, peerId },
                ({ params }: { params: any }) => {
                    if (params.error) {
                        reject(params.error);
                        return;
                    }

                    const transport = device.createSendTransport(params);

                    transport.on(
                        'connect',
                        async (
                            { dtlsParameters }: any,
                            callback: any,
                            errback: any
                        ) => {
                            try {
                                socket.emit('connectProducerTransport', {
                                    dtlsParameters,
                                    roomId,
                                    peerId,
                                });
                                callback();
                            } catch (error) {
                                errback(error);
                            }
                        }
                    );

                    transport.on(
                        'produce',
                        async (
                            parameters: any,
                            callback: any,
                            errback: any
                        ) => {
                            const { kind, rtpParameters } = parameters;
                            try {
                                socket.emit(
                                    'transport-produce',
                                    { kind, rtpParameters, roomId, peerId },
                                    ({ id }: any) => {
                                        callback({ id });
                                    }
                                );
                            } catch (error) {
                                errback(error);
                            }
                        }
                    );

                    resolve(transport);
                }
            );
        });
    };

    const produceVideo = async (transport: Transport) => {
        if (!params.video.track) return;

        try {
            const videoProducer = await transport.produce({
                track: params.video.track,
                encodings: params.video.encoding,
                codecOptions: params.video.codecOptions,
            });

            setProducers((prev) => ({ ...prev, video: videoProducer }));
            console.log('Video producer created');
        } catch (error) {
            console.error('Error producing video:', error);
        }
    };

    const produceAudio = async (transport: Transport) => {
        if (!params.audio.track) return;

        try {
            const audioProducer = await transport.produce({
                track: params.audio.track,
            });

            setProducers((prev) => ({ ...prev, audio: audioProducer }));
            console.log('Audio producer created');
        } catch (error) {
            console.error('Error producing audio:', error);
        }
    };

    const createRecvTransport = async (
        device: Device,
        producerPeerId: string
    ): Promise<Transport> => {
        return new Promise((resolve, reject) => {
            const currentSocket = socketRef.current || socket;

            if (!currentSocket) {
                reject(new Error('Socket not available'));
                return;
            }

            currentSocket.emit(
                'createTransport',
                { sender: false, roomId, peerId, producerPeerId },
                ({ params }: { params: any }) => {
                    if (params.error) {
                        reject(params.error);
                        return;
                    }

                    const transport = device.createRecvTransport(params);

                    transport.on(
                        'connect',
                        async (
                            { dtlsParameters }: any,
                            callback: any,
                            errback: any
                        ) => {
                            try {
                                currentSocket.emit('connectConsumerTransport', {
                                    dtlsParameters,
                                    roomId,
                                    peerId,
                                    producerPeerId,
                                });
                                callback();
                            } catch (error) {
                                errback(error);
                            }
                        }
                    );

                    resolve(transport);
                }
            );
        });
    };

    const consumeMedia = async (
        producerPeerId: string,
        kind: 'video' | 'audio',
        deviceToUse?: Device
    ) => {
        // Use the most current device available
        const activeDevice = deviceToUse || deviceRef.current || device;

        if (!activeDevice) {
            console.error('Device not ready for consumption');
            return;
        }

        try {
            // Use one transport per peer
            const transportKey = producerPeerId;

            let transport = consumerTransports[transportKey];
            if (!transport) {
                console.log(
                    `Creating new consumer transport for peer ${producerPeerId}`
                );
                transport = await createRecvTransport(
                    activeDevice,
                    producerPeerId
                );
                setConsumerTransports((prev) => ({
                    ...prev,
                    [transportKey]: transport,
                }));
            } else {
                console.log(
                    `Using existing consumer transport for peer ${producerPeerId}`
                );
            }

            // Consume media from the transport
            await consumeFromTransport(
                transport,
                producerPeerId,
                kind,
                activeDevice
            );
        } catch (error) {
            console.error('Error consuming media:', error);
        }
    };

    const consumeFromTransport = async (
        transport: Transport,
        producerPeerId: string,
        kind: 'video' | 'audio',
        deviceToUse?: Device
    ) => {
        return new Promise<Consumer>((resolve, reject) => {
            const currentSocket = socketRef.current || socket;

            if (!currentSocket) {
                reject(new Error('Socket not available'));
                return;
            }

            currentSocket.emit(
                'consumeMedia',
                {
                    rtpCapabilities:
                        deviceToUse?.rtpCapabilities || device?.rtpCapabilities,
                    roomId,
                    peerId,
                    producerPeerId,
                    kind,
                },
                async ({ params }: any) => {
                    if (params.error) {
                        console.error(
                            'Error in consumeMedia response:',
                            params.error
                        );
                        reject(params.error);
                        return;
                    }

                    try {
                        const consumer = await transport.consume({
                            id: params.id,
                            producerId: params.producerId,
                            kind: params.kind,
                            rtpParameters: params.rtpParameters,
                        });

                        const { track } = consumer;
                        console.log(
                            `Got ${kind} track from peer ${producerPeerId}`
                        );

                        // Create or update media element
                        createOrUpdateRemoteMediaElement(producerPeerId, track);

                        // Resume consumer
                        currentSocket.emit('resumePausedConsumer', {
                            roomId,
                            peerId,
                            producerPeerId,
                            kind,
                        });

                        resolve(consumer);
                    } catch (error) {
                        console.error('Error creating consumer:', error);
                        reject(error);
                    }
                }
            );
        });
    };

    const createOrUpdateRemoteMediaElement = (
        producerPeerId: string,
        track: MediaStreamTrack
    ) => {
        let videoElement = remoteVideosRef.current[producerPeerId];
        let stream: MediaStream;

        if (!videoElement) {
            // Create a new video element if it doesn't exist
            videoElement = document.createElement('video');
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.style.width = '300px';
            videoElement.style.height = '200px';
            videoElement.style.border = '1px solid #ccc';
            videoElement.style.borderRadius = '8px';
            videoElement.style.backgroundColor = '#000';

            stream = new MediaStream();
            videoElement.srcObject = stream;

            const label = document.createElement('div');
            label.textContent = `${producerPeerId}`;
            label.style.textAlign = 'center';
            label.style.fontSize = '14px';
            label.style.marginBottom = '5px';
            label.style.fontWeight = 'bold';
            label.style.color = '#333';

            const container = document.createElement('div');
            container.style.margin = '10px';
            container.appendChild(label);
            container.appendChild(videoElement);

            const remoteVideosContainer =
                document.getElementById('remote-videos');
            if (remoteVideosContainer) {
                remoteVideosContainer.appendChild(container);
                remoteVideosRef.current[producerPeerId] = videoElement;
                console.log(
                    `Video element created and added for ${producerPeerId}`
                );
            } else {
                console.error('Remote videos container not found');
            }
        } else {
            // Use existing stream if element exists
            stream = videoElement.srcObject as MediaStream;
        }

        // Add the new track to the stream
        stream.addTrack(track);

        // Ensure video plays
        videoElement.play().catch(console.error);
    };

    const consumeAllExistingProducers = async (deviceToUse: Device) => {
        return new Promise<any>((resolve) => {
            console.log('Requesting existing producers...');
            socket.emit(
                'getExistingProducers',
                { roomId, peerId },
                async (data: any) => {
                    console.log('Existing producers received:', data.producers);

                    if (data.producers && data.producers.length > 0) {
                        console.log(
                            `Found ${data.producers.length} existing producers to consume`
                        );
                        console.log(
                            'Device RTP capabilities:',
                            deviceToUse.rtpCapabilities
                        );

                        for (const producer of data.producers) {
                            if (producer.peerId !== peerId) {
                                try {
                                    console.log(
                                        `Consuming ${producer.kind} from ${producer.peerId}`
                                    );

                                    // Use the passed device directly
                                    const transportKey = producer.peerId;

                                    // Get or create transport for this peer
                                    let transport =
                                        consumerTransports[transportKey];
                                    if (!transport) {
                                        transport = await createRecvTransport(
                                            deviceToUse,
                                            producer.peerId
                                        );
                                        // Use a functional update to avoid race conditions
                                        setConsumerTransports((prev) => ({
                                            ...prev,
                                            [transportKey]: transport,
                                        }));
                                    }

                                    // Consume media with the specific device
                                    await consumeFromTransport(
                                        transport,
                                        producer.peerId,
                                        producer.kind,
                                        deviceToUse
                                    );

                                    console.log(
                                        `Successfully consumed ${producer.kind} from ${producer.peerId}`
                                    );
                                    // Delay between consumers
                                    await new Promise((resolve) =>
                                        setTimeout(resolve, 300)
                                    );
                                } catch (error) {
                                    console.error(
                                        `Error consuming ${producer.kind} from ${producer.peerId}:`,
                                        error
                                    );
                                }
                            }
                        }
                        console.log(
                            'Finished consuming all existing producers'
                        );
                    } else {
                        console.log('No existing producers found');
                    }

                    resolve(data);
                }
            );
        });
    };

    if (!roomId || !peerId) {
        return (
            <main
                style={{
                    padding: '20px',
                    maxWidth: '600px',
                    margin: '0 auto',
                    fontFamily: 'Arial, sans-serif',
                }}
            >
                <h1 style={{ textAlign: 'center', color: '#333' }}>
                    MediaSoup Video Chat
                </h1>
                <div
                    style={{
                        backgroundColor: '#f8f9fa',
                        padding: '30px',
                        borderRadius: '12px',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                    }}
                >
                    <p
                        style={{
                            textAlign: 'center',
                            marginBottom: '20px',
                            color: '#666',
                        }}
                    >
                        Enter room details to join:
                    </p>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '15px',
                        }}
                    >
                        <input
                            type='text'
                            placeholder='Room ID'
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            style={{
                                padding: '12px',
                                fontSize: '16px',
                                border: '2px solid #ddd',
                                borderRadius: '8px',
                                outline: 'none',
                            }}
                        />
                        <input
                            type='text'
                            placeholder='Your Name/ID'
                            value={peerId}
                            onChange={(e) => setPeerId(e.target.value)}
                            style={{
                                padding: '12px',
                                fontSize: '16px',
                                border: '2px solid #ddd',
                                borderRadius: '8px',
                                outline: 'none',
                            }}
                        />
                        <button
                            onClick={() => {
                                if (roomId && peerId) {
                                    window.location.search = `?roomId=${roomId}&peerId=${peerId}`;
                                }
                            }}
                            disabled={!roomId || !peerId}
                            style={{
                                padding: '15px',
                                fontSize: '16px',
                                backgroundColor:
                                    !roomId || !peerId ? '#ccc' : '#007bff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor:
                                    !roomId || !peerId
                                        ? 'not-allowed'
                                        : 'pointer',
                                fontWeight: 'bold',
                            }}
                        >
                            Enter Room
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main
            style={{
                padding: '20px',
                maxWidth: '1200px',
                margin: '0 auto',
                fontFamily: 'Arial, sans-serif',
                backgroundColor: '#f5f5f5',
                minHeight: '100vh',
            }}
        >
            <h1
                style={{
                    textAlign: 'center',
                    marginBottom: '30px',
                    color: '#333',
                    fontSize: '2rem',
                }}
            >
                Room: {roomId}
            </h1>

            {/* Local Video Section */}
            <div
                style={{
                    marginBottom: '30px',
                    textAlign: 'center',
                    backgroundColor: 'white',
                    padding: '20px',
                    borderRadius: '12px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                }}
            >
                <h3 style={{ color: '#333', marginBottom: '15px' }}>
                    You ({peerId})
                </h3>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{
                            width: '400px',
                            height: '300px',
                            border: '3px solid #007bff',
                            borderRadius: '12px',
                            backgroundColor: '#000',
                            display: videoMuted ? 'none' : 'block',
                        }}
                    />
                    {videoMuted && (
                        <div
                            style={{
                                width: '400px',
                                height: '300px',
                                border: '3px solid #007bff',
                                borderRadius: '12px',
                                backgroundColor: '#333',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: '18px',
                                fontWeight: 'bold',
                            }}
                        >
                            📷 Camera Off
                        </div>
                    )}
                </div>

                {/* Media Controls */}
                <div
                    style={{
                        marginTop: '20px',
                        display: 'flex',
                        gap: '15px',
                        justifyContent: 'center',
                    }}
                >
                    <button
                        onClick={toggleVideo}
                        style={{
                            padding: '12px 24px',
                            fontSize: '16px',
                            backgroundColor: videoMuted ? '#dc3545' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            transition: 'all 0.3s ease',
                        }}
                    >
                        {videoMuted ? '📷 Unmute Video' : '📷 Mute Video'}
                    </button>

                    <button
                        onClick={toggleAudio}
                        style={{
                            padding: '12px 24px',
                            fontSize: '16px',
                            backgroundColor: audioMuted ? '#dc3545' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            transition: 'all 0.3s ease',
                        }}
                    >
                        {audioMuted ? '🎤 Unmute Audio' : '🎤 Mute Audio'}
                    </button>
                </div>
            </div>

            {/* Join Button */}
            {!isJoined && (
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <button
                        onClick={joinRoom}
                        disabled={isConnecting || !mediaInitialized}
                        style={{
                            padding: '18px 36px',
                            fontSize: '20px',
                            backgroundColor: isConnecting
                                ? '#6c757d'
                                : '#007bff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '12px',
                            cursor:
                                isConnecting || !mediaInitialized
                                    ? 'not-allowed'
                                    : 'pointer',
                            fontWeight: 'bold',
                            boxShadow: '0 4px 15px rgba(0,123,255,0.3)',
                            transition: 'all 0.3s ease',
                        }}
                    >
                        {isConnecting ? 'Joining Room...' : 'Join Room'}
                    </button>
                </div>
            )}

            {/* Remote Videos - Always show container */}
            <div
                style={{
                    marginTop: '30px',
                    backgroundColor: 'white',
                    padding: '20px',
                    borderRadius: '12px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                }}
            >
                <h3
                    style={{
                        color: '#333',
                        textAlign: 'center',
                        marginBottom: '20px',
                    }}
                >
                    Participants ({remotePeers.length})
                </h3>
                <div
                    id='remote-videos'
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '20px',
                        justifyContent: 'center',
                        minHeight: '50px', // Ensure container exists
                    }}
                >
                    {remotePeers.length === 0 && (
                        <p
                            style={{
                                color: '#666',
                                textAlign: 'center',
                                width: '100%',
                            }}
                        >
                            No other participants yet...
                        </p>
                    )}
                    {/* Remote video elements will be dynamically added here */}
                </div>
            </div>

            {/* Status */}
            <div
                style={{
                    marginTop: '30px',
                    padding: '15px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    textAlign: 'center',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                }}
            >
                <p style={{ margin: '5px 0', color: '#333' }}>
                    Connection: {isJoined ? '✅ Connected' : '⏳ Not Connected'}
                </p>
                <p style={{ margin: '5px 0', color: '#333' }}>
                    Media:{' '}
                    {mediaInitialized ? '✅ Ready' : '⏳ Initializing...'}
                </p>
                {isJoined && (
                    <p style={{ margin: '5px 0', color: '#333' }}>
                        Setup:{' '}
                        {setupComplete ? '✅ Complete' : '⏳ In Progress...'}
                    </p>
                )}
            </div>
        </main>
    );
}
