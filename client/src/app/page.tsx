'use client';

import { useEffect, useRef, useState } from 'react';
// import { css } from "@emotion/css";
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import {
    DtlsParameters,
    IceCandidate,
    IceParameters,
    Transport,
} from 'mediasoup-client/types';

export default function Home() {
    /**
     * References to the local and remote video HTML elements.
     * These refs are used to attach media streams to the video elements for playback.
     */
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideosRef = useRef<{ [peerId: string]: HTMLVideoElement }>({});

    // Room and peer management
    const [roomId, setRoomId] = useState<string>('');
    const [peerId, setPeerId] = useState<string>('');
    const [isJoined, setIsJoined] = useState<boolean>(false);
    const [remotePeers, setRemotePeers] = useState<string[]>([]);
    
    /**
     * State to hold encoding parameters for the media stream.
     * Encoding parameters control the quality and bandwidth usage of the transmitted video.
     * Each object in the encoding array represents a different layer of encoding,
     * allowing for scalable video coding (SVC). The parameters defined here are:
     * - rid: The encoding layer identifier.
     * - maxBitrate: The maximum bitrate for this layer.
     * - scalabilityMode: The scalability mode which specifies the temporal and spatial scalability.
     *
     * Additionally, codecOptions are provided to control the initial bitrate.
     */
    const [params, setParams] = useState({
        video: {
            encoding: [
                { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' }, // Lowest quality layer
                { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' }, // Middle quality layer
                { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' }, // Highest quality layer
            ],
            codecOptions: { videoGoogleStartBitrate: 1000 }, // Initial bitrate
            track: null as MediaStreamTrack | null,
        },
        audio: {
            track: null as MediaStreamTrack | null,
        },
    });

    /**
     * State to hold references to various mediasoup client-side entities.
     * These entities are crucial for managing the media transmission and reception.
     */
    const [device, setDevice] = useState<Device | null>(null); // mediasoup Device
    const [socket, setSocket] = useState<any>(null); // Socket for signaling
    const [rtpCapabilities, setRtpCapabilities] = useState<any>(null); // RTP Capabilities for the device
    const [producerTransport, setProducerTransport] = useState<Transport | null>(null); // Transport for sending media
    const [consumerTransports, setConsumerTransports] = useState<{ [key: string]: Transport }>({}); // Multiple consumer transports
    const [producers, setProducers] = useState<{ video?: any; audio?: any }>({});

    /**
     * Effect to initialize the socket connection on component mount.
     * The socket is used for signaling to coordinate media transmission.
     * On successful connection, the camera is started to obtain a media stream.
     */
    useEffect(() => {
        // Use environment variable or fallback
        const serverUrl = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.1.108:4000/mediasoup';
        
        console.log('Connecting to:', serverUrl);
        console.log('Current page protocol:', window.location.protocol);
        console.log('Current hostname:', window.location.hostname);
        
        const socket = io(serverUrl, {
            forceNew: true,
            timeout: 20000,
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
        });

        setSocket(socket);
        socket.on('connection-success', (data) => {
            console.log('Connected to server');
        });

        // Listen for peer events
        socket.on('peer-joined', (data) => {
            console.log('Peer joined:', data);
            setRemotePeers(prev => [...prev.filter(p => p !== data.peerId), data.peerId]);
        });

        socket.on('peer-left', (data) => {
            console.log('Peer left:', data);
            setRemotePeers(prev => prev.filter(p => p !== data.peerId));
            // Clean up remote video element
            const videoElement = remoteVideosRef.current[data.peerId];
            if (videoElement) {
                videoElement.remove();
                delete remoteVideosRef.current[data.peerId];
            }
        });

        socket.on('new-producer', async (data) => {
            console.log('New producer available:', data);
            // Auto-consume new producers will be handled when getExistingProducers is called
        });

        socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
        });

        socket.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
        });

        socket.on('reconnect', (attemptNumber) => {
            console.log('Socket reconnected after', attemptNumber, 'attempts');
        });

        return () => {
            socket.disconnect();
        };
    }, []); // Remove dependencies to prevent reconnection

    /**
     * Function to start the camera and obtain a media stream.
     * This stream is then attached to the local video element for preview.
     */
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });
            if (videoRef.current) {
                const videoTrack = stream.getVideoTracks()[0];
                const audioTrack = stream.getAudioTracks()[0];
                
                videoRef.current.srcObject = stream;
                
                setParams((current) => ({ 
                    ...current, 
                    video: { ...current.video, track: videoTrack },
                    audio: { ...current.audio, track: audioTrack }
                }));
            }
        } catch (error) {
            console.error('Error accessing camera:', error);
        }
    };

    /**
     * Join a room with room and peer IDs
     */
    const joinRoom = async () => {
        if (!socket || !roomId || !peerId) return;
        
        return new Promise((resolve, reject) => {
            socket.emit('join-room', { roomId, peerId }, (response: any) => {
                if (response.success) {
                    setIsJoined(true);
                    setRemotePeers(response.peers || []);
                    console.log('Joined room successfully');
                    resolve(response);
                } else {
                    console.error('Failed to join room:', response.error);
                    reject(response.error);
                }
            });
        });
    };

    /**
     * Step 1: Retrieve the Router's RTP Capabilities.
     * This function requests the router's RTP capabilities from the server,
     * which are essential to configure the mediasoup Device.
     * The router's RTP capabilities describe the codecs and RTP parameters supported by the router.
     * This information is crucial for ensuring that the Device is compatible with the router.
     */
    const getRouterRtpCapabilities = async () => {
        return new Promise((resolve, reject) => {
            socket.emit('getRouterRtpCapabilities', { roomId }, (data: any) => {
                console.log('Full response:', data);
                if (data.error) {
                    console.error('Error getting router capabilities:', data.error);
                    reject(data.error);
                    return;
                }
                setRtpCapabilities(data.routerRtpCapabilities);
                console.log(
                    'getRouterRtpCapabilities:',
                    data.routerRtpCapabilities
                );
                resolve(data.routerRtpCapabilities);
            });
        });
    };

    /**
     * Step 2: Create and Initialize the mediasoup Device.
     * This function creates a new mediasoup Device instance and loads the router's RTP capabilities into it.
     * The Device is a client-side entity that provides an API for managing sending/receiving media with a mediasoup server.
     * Loading the router's RTP capabilities ensures that the Device is aware of the codecs and RTP parameters it needs to use
     * to successfully send and receive media with the server.
     *
     * If the Device is unable to load the router's RTP capabilities (e.g., due to an unsupported browser),
     * an error is logged to the console.
     */
    const createDevice = async () => {
        try {
            const newDevice = new Device();

            await newDevice.load({ routerRtpCapabilities: rtpCapabilities });

            setDevice(newDevice);
        } catch (error: any) {
            console.log(error);
            if (error.name === 'UnsupportedError') {
                console.error('Browser not supported');
            }
        }
    };

    /**
     * Step 3: Create a Transport for Sending Media.
     * This function initiates the creation of a transport on the server-side for sending media,
     * and then replicates the transport on the client-side using the parameters returned by the server.
     */
    const createSendTransport = async () => {
        // Request the server to create a send transport
        socket.emit(
            'createTransport',
            { sender: true, roomId, peerId },
            ({
                params,
            }: {
                params: {
                    /**
                     * A unique identifier generated by mediasoup for the transport.
                     * Necessary for differentiating between multiple transports.
                     */
                    id: string;
                    /**
                     * Interactive Connectivity Establishment (ICE) parameters.
                     * Necessary for the negotiation of network connections.
                     */
                    iceParameters: IceParameters;
                    /**
                     * Array of ICE candidates.
                     * Necessary for establishing network connectivity through NATs and firewalls.
                     */
                    iceCandidates: IceCandidate[];
                    /**
                     * Datagram Transport Layer Security (DTLS) parameters.
                     * Necessary for securing the transport with encryption.
                     */
                    dtlsParameters: DtlsParameters;
                    /**
                     * Error object if any error occurs during transport creation.
                     * */
                    error?: unknown;
                };
            }) => {
                if (params.error) {
                    console.log(params.error);
                    return;
                }

                /**
                 * Replicate the send transport on the client-side.
                 * The `device.createSendTransport` method creates a send transport instance on the client-side
                 * using the parameters provided by the server.
                 */
                let transport = device?.createSendTransport(params);

                // Update the state to hold the reference to the created transport
                setProducerTransport(transport || null);

                /**
                 * Event handler for the "connect" event on the transport.
                 * This event is triggered when the transport is ready to be connected.
                 * The `dtlsParameters` are provided by the transport and are required to establish
                 * the DTLS connection between the client and the server.
                 * This event it emitted as a result of calling the `producerTransport?.produce(params)`
                 * method in the next step. The event will only be emitted if this is the first time
                 */
                transport?.on(
                    'connect',
                    async (
                        { dtlsParameters }: any,
                        callback: any,
                        errback: any
                    ) => {
                        try {
                            console.log(
                                '----------> producer transport has connected'
                            );
                            // Notify the server that the transport is ready to connect with the provided DTLS parameters
                            socket.emit('connectProducerTransport', {
                                dtlsParameters,
                                roomId,
                                peerId,
                            });
                            // Callback to indicate success
                            callback();
                        } catch (error) {
                            // Errback to indicate failure
                            errback(error);
                        }
                    }
                );

                /**
                 * Event handler for the "produce" event on the transport.
                 * This event is triggered when the transport is ready to start producing media.
                 * The `parameters` object contains the necessary information for producing media,
                 * including the kind of media (audio or video) and the RTP parameters.
                 * The event is emitted as a result of calling the `producerTransport?.produce(params)`
                 * method in the next step.
                 */
                transport?.on(
                    'produce',
                    async (parameters: any, callback: any, errback: any) => {
                        const { kind, rtpParameters } = parameters;

                        console.log('----------> transport-produce');

                        try {
                            // Notify the server to start producing media with the provided parameters
                            socket.emit(
                                'transport-produce',
                                { kind, rtpParameters, roomId, peerId },
                                ({ id }: any) => {
                                    // Callback to provide the server-generated producer ID back to the transport
                                    callback({ id });
                                }
                            );
                        } catch (error) {
                            // Errback to indicate failure
                            errback(error);
                        }
                    }
                );
            }
        );
    };

    /**
     * Step 4: Connect the Send Transport and Start Producing Media.
     * This function initiates the process of producing media using the previously created send transport.
     */
    const connectSendTransport = async () => {
        /**
         * This instructs the transport to start sending media to the router.
         * The transport will emit a "connect" event if this is the first time the transport is being connected.
         * Before this method completes, the transport will emit a "produce" event which was
         * was subscribed to in the previous step so the application will transmit the event parameters to the server.
         * */
        const producePromises = [];
        
        // Produce video if available
        if (params.video.track) {
            const videoProducer = await producerTransport?.produce({
                track: params.video.track,
                encodings: params.video.encoding,
                codecOptions: params.video.codecOptions,
            });
            setProducers(prev => ({ ...prev, video: videoProducer }));
            producePromises.push(videoProducer);
        }
        
        // Produce audio if available
        if (params.audio.track) {
            const audioProducer = await producerTransport?.produce({
                track: params.audio.track,
            });
            setProducers(prev => ({ ...prev, audio: audioProducer }));
            producePromises.push(audioProducer);
        }

        // Event handlers for track ending and transport closing events
        producePromises.forEach(producer => {
            producer?.on('trackended', () => {
                console.log('trackended');
            });
            producer?.on('transportclose', () => {
                console.log('transportclose');
            });
        });
    };

    /**
     * Step 5: Create a Transport for Receiving Media.
     * This function initiates the creation of a transport on the server-side for receiving media,
     * and then replicates the transport on the client-side using the parameters returned by the server.
     */
    const createRecvTransport = async (producerPeerId: string) => {
        return new Promise((resolve, reject) => {
            // Requesting the server to create a receive transport
            socket.emit(
                'createTransport',
                { sender: false, roomId, peerId, producerPeerId },
                ({ params }: { params: any }) => {
                    if (params.error) {
                        console.log(params.error);
                        reject(params.error);
                        return;
                    }

                    // Creating a receive transport on the client-side using the server-provided parameters
                    let transport = device?.createRecvTransport(params);
                    
                    if (!transport) {
                        reject(new Error('Failed to create transport'));
                        return;
                    }

                    /**
                     * This event is triggered when "consumerTransport.consume" is called
                     * for the first time on the client-side.
                     * */
                    transport.on(
                        'connect',
                        async (
                            { dtlsParameters }: any,
                            callback: any,
                            errback: any
                        ) => {
                            try {
                                // Notifying the server to connect the receive transport with the provided DTLS parameters
                                await socket.emit('connectConsumerTransport', {
                                    dtlsParameters,
                                    roomId,
                                    peerId,
                                    producerPeerId,
                                });
                                console.log(
                                    '----------> consumer transport has connected'
                                );
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

    /**
     * Consume media from a specific producer peer
     */
    const consumeMedia = async (producerPeerId: string, kind: 'video' | 'audio') => {
        try {
            console.log(`Starting to consume ${kind} from ${producerPeerId}`);
            
            // Get or create transport for this producer peer
            let transport = consumerTransports[producerPeerId];
            if (!transport) {
                console.log(`Creating new transport for ${producerPeerId}`);
                transport = await createRecvTransport(producerPeerId) as Transport;
                setConsumerTransports(prev => ({ ...prev, [producerPeerId]: transport }));
                console.log(`Transport created for ${producerPeerId}`);
            }

            // Requesting the server to start consuming media
            await socket.emit(
                'consumeMedia',
                { 
                    rtpCapabilities: device?.rtpCapabilities, 
                    roomId, 
                    peerId, 
                    producerPeerId, 
                    kind 
                },
                async ({ params }: any) => {
                    if (params.error) {
                        console.log(params.error);
                        return;
                    }

                    // Consuming media using the receive transport
                    let consumer = await transport.consume({
                        id: params.id,
                        producerId: params.producerId,
                        kind: params.kind,
                        rtpParameters: params.rtpParameters,
                    });

                    // Accessing the media track from the consumer
                    const { track } = consumer;
                    console.log(`Got ${kind} track from ${producerPeerId}:`, track);

                    // Create or update remote video element
                    createOrUpdateRemoteMediaElement(producerPeerId, track);

                    // Notifying the server to resume media consumption
                    socket.emit('resumePausedConsumer', { roomId, peerId, producerPeerId, kind });
                    console.log(`Consumer resumed for ${kind} from ${producerPeerId}`);
                }
            );
        } catch (error) {
            console.error('Error consuming media:', error);
        }
    };

    /**
     * Create or update remote video element for a peer
     */
    const createOrUpdateRemoteMediaElement = (producerPeerId: string, track: MediaStreamTrack) => {
        let videoElement = remoteVideosRef.current[producerPeerId];
        let stream: MediaStream;

        if (!videoElement) {
            // Create new video element
            videoElement = document.createElement('video');
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.controls = true;
            videoElement.muted = false; // IMPORTANT: Don't mute remote video for audio
            videoElement.volume = 1.0; // Max volume
            videoElement.style.width = '300px';
            videoElement.style.height = '200px';
            videoElement.style.border = '1px solid #ccc';
            videoElement.style.margin = '10px';

            stream = new MediaStream();
            videoElement.srcObject = stream;

            // Add label
            const label = document.createElement('div');
            label.textContent = `Peer: ${producerPeerId}`;
            label.style.textAlign = 'center';
            label.style.fontSize = '12px';
            label.style.fontWeight = 'bold';

            const container = document.createElement('div');
            container.appendChild(label);
            container.appendChild(videoElement);

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
        console.log(`Added ${track.kind} track to stream. Stream now has ${stream.getTracks().length} tracks`);
        
        // For audio tracks, ensure the video element is ready to play audio
        if (track.kind === 'audio') {
            videoElement.muted = false;
            videoElement.volume = 1.0;
            console.log('Audio track added, ensuring video element is unmuted');
        }
        
        // Play the video element
        videoElement.play().then(() => {
            console.log(`Video element playing for ${producerPeerId} with ${track.kind} track`);
        }).catch((error) => {
            console.error(`Error playing video element for ${producerPeerId}:`, error);
            // If autoplay fails, try to play after user interaction
            videoElement.onclick = () => {
                videoElement.play().catch(console.error);
            };
        });
    };

    /**
     * Get existing producers and consume them
     */
    const getExistingProducers = async () => {
        socket.emit('getExistingProducers', { roomId, peerId }, (data: any) => {
            if (data.producers) {
                console.log('Found existing producers:', data.producers);
                data.producers.forEach((producer: any, index: number) => {
                    if (producer.peerId !== peerId) {
                        // Add more delay between each consumption to prevent overwhelming the server
                        setTimeout(() => {
                            consumeMedia(producer.peerId, producer.kind);
                        }, (index + 1) * 1000); // 1 second delay between each
                    }
                });
            }
        });
    };

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
                <button onClick={joinRoom} disabled={!roomId || !peerId || isJoined}>
                    {isJoined ? 'Joined' : 'Join Room'}
                </button>
            </div>

            {/* Status */}
            <div style={{ marginBottom: '20px' }}>
                <p>Status: {isJoined ? 'Connected' : 'Not Connected'}</p>
                <p>Remote Peers: {remotePeers.length}</p>
            </div>

            {/* Local Video */}
            <div style={{ marginBottom: '20px' }}>
                <h3>Local Video</h3>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: '300px', border: '1px solid #ccc' }} />
            </div>

            {/* Remote Videos */}
            <div style={{ marginBottom: '20px' }}>
                <h3>Remote Videos</h3>
                <div id="remote-videos" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {remotePeers.length === 0 && <p>No remote peers</p>}
                </div>
            </div>

            {/* Controls */}
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    maxWidth: '300px',
                }}
            >
                <button onClick={startCamera}>Get Local Media</button>
                <button onClick={getRouterRtpCapabilities} disabled={!isJoined}>
                    Get Router RTP Capabilities
                </button>
                <button onClick={createDevice} disabled={!rtpCapabilities}>Create Device</button>
                <button onClick={createSendTransport} disabled={!device}>
                    Create Send Transport
                </button>
                <button onClick={connectSendTransport} disabled={!producerTransport}>
                    Connect Send Transport & Produce
                </button>
                <button onClick={getExistingProducers} disabled={!device}>
                    Get Existing Producers
                </button>
            </div>
        </main>
    );
}
