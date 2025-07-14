import { useState, useRef, useCallback } from 'react';

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

interface UseMediaStreamReturn {
  params: MediaParams;
  currentStream: MediaStream | null;
  mediaInitialized: boolean;
  videoMuted: boolean;
  audioMuted: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  initializeMedia: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleAudio: () => void;
  cleanupMedia: () => void;
}

interface UseMediaStreamProps {
  socket?: any;
  roomId?: string;
  peerId?: string;
  producers?: { video?: any; audio?: any };
}

export const useMediaStream = ({ socket, roomId, peerId, producers }: UseMediaStreamProps = {}): UseMediaStreamReturn => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  
  const [params, setParams] = useState<MediaParams>({
    video: {
      encoding: [
        { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
        { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
        { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
      ],
      codecOptions: { videoGoogleStartBitrate: 1000 },
      track: null,
    },
    audio: {
      track: null,
    },
  });

  const [currentStream, setCurrentStream] = useState<MediaStream | null>(null);
  const [mediaInitialized, setMediaInitialized] = useState<boolean>(false);
  const [videoMuted, setVideoMuted] = useState<boolean>(false);
  const [audioMuted, setAudioMuted] = useState<boolean>(false);

  const initializeMedia = useCallback(async () => {
    if (mediaInitialized || currentStream) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      setCurrentStream(stream);
      setMediaInitialized(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      // Enable tracks by default
      if (videoTrack) {
        videoTrack.enabled = true;
        setVideoMuted(false);
      }
      if (audioTrack) {
        audioTrack.enabled = true;
        setAudioMuted(false);
      }

      setParams((prev) => ({
        ...prev,
        video: { ...prev.video, track: videoTrack || null },
        audio: { ...prev.audio, track: audioTrack || null },
      }));

      console.log('Media initialized successfully');
    } catch (error) {
      console.error('Error accessing media:', error);
    }
  }, [mediaInitialized, currentStream]);

  const toggleVideo = useCallback(async () => {
    if (!currentStream || !socket || !roomId || !peerId) return;

    if (videoMuted) {
      // Resume video producer
      if (producers?.video) {
        socket.emit('resumeProducer', { roomId, peerId, kind: 'video' });
        setVideoMuted(false);
        console.log('Video producer resumed');
      }
    } else {
      // Pause video producer
      if (producers?.video) {
        socket.emit('pauseProducer', { roomId, peerId, kind: 'video' });
        setVideoMuted(true);
        console.log('Video producer paused');
      }
    }
  }, [currentStream, videoMuted, socket, roomId, peerId, producers]);

  const toggleAudio = useCallback(() => {
    if (!currentStream || !socket || !roomId || !peerId) return;

    if (audioMuted) {
      // Resume audio producer
      if (producers?.audio) {
        socket.emit('resumeProducer', { roomId, peerId, kind: 'audio' });
        setAudioMuted(false);
        console.log('Audio producer resumed');
      }
    } else {
      // Pause audio producer
      if (producers?.audio) {
        socket.emit('pauseProducer', { roomId, peerId, kind: 'audio' });
        setAudioMuted(true);
        console.log('Audio producer paused');
      }
    }
  }, [currentStream, audioMuted, socket, roomId, peerId, producers]);

  const cleanupMedia = useCallback(() => {
    if (currentStream) {
      // Stop all tracks
      currentStream.getTracks().forEach(track => track.stop());
      setCurrentStream(null);
    }
    
    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    // Reset state
    setMediaInitialized(false);
    setVideoMuted(false);
    setAudioMuted(false);
    setParams({
      video: {
        encoding: [
          { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
          { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
          { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
        track: null,
      },
      audio: {
        track: null,
      },
    });
    
    console.log('Media cleaned up successfully');
  }, [currentStream]);

  return {
    params,
    currentStream,
    mediaInitialized,
    videoMuted,
    audioMuted,
    videoRef,
    initializeMedia,
    toggleVideo,
    toggleAudio,
    cleanupMedia,
  };
};