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
}

interface UseMediaStreamProps {
  socket?: any;
  roomId?: string;
  peerId?: string;
}

export const useMediaStream = ({ socket, roomId, peerId }: UseMediaStreamProps = {}): UseMediaStreamReturn => {
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
    if (!currentStream) return;

    if (videoMuted) {
      // Unmute: get new video track
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        const newVideoTrack = newStream.getVideoTracks()[0];
        const oldVideoTrack = currentStream.getVideoTracks()[0];
        
        if (oldVideoTrack) {
          currentStream.removeTrack(oldVideoTrack);
          oldVideoTrack.stop();
        }

        currentStream.addTrack(newVideoTrack);

        if (videoRef.current) {
          videoRef.current.srcObject = currentStream;
        }

        setParams((prev) => ({
          ...prev,
          video: { ...prev.video, track: newVideoTrack },
        }));

        setVideoMuted(false);
        console.log('Video unmuted');
        
        // Notify other peers
        if (socket && roomId && peerId) {
          socket.emit('peer-muted', { roomId, peerId, kind: 'video', muted: false });
        }
      } catch (error) {
        console.error('Error turning on camera:', error);
      }
    } else {
      // Mute: disable and set track to null, but keep the track in the stream
      const videoTrack = currentStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;

        setParams((prev) => ({
          ...prev,
          video: { ...prev.video, track: null },
        }));

        setVideoMuted(true);
        console.log('Video muted');
        
        // Notify other peers
        if (socket && roomId && peerId) {
          socket.emit('peer-muted', { roomId, peerId, kind: 'video', muted: true });
        }
      }
    }
  }, [currentStream, videoMuted, socket, roomId, peerId]);

  const toggleAudio = useCallback(() => {
    if (!currentStream) return;

    if (audioMuted) {
      // Unmute: check if existing track is valid, otherwise get new one
      const audioTrack = currentStream.getAudioTracks()[0];
      if (audioTrack && audioTrack.readyState === 'live') {
        // Existing track is still valid, just enable it
        audioTrack.enabled = true;
        setParams((prev) => ({
          ...prev,
          audio: { ...prev.audio, track: audioTrack },
        }));
        setAudioMuted(false);
        console.log('Audio unmuted with existing track');
        
        // Notify other peers
        if (socket && roomId && peerId) {
          socket.emit('peer-muted', { roomId, peerId, kind: 'audio', muted: false });
        }
      } else {
        // Track ended or invalid, get new audio track
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }).then(newStream => {
          const newAudioTrack = newStream.getAudioTracks()[0];
          if (newAudioTrack) {
            // Remove old audio track if exists
            const oldAudioTrack = currentStream.getAudioTracks()[0];
            if (oldAudioTrack) {
              currentStream.removeTrack(oldAudioTrack);
              oldAudioTrack.stop();
            }
            
            // Add new audio track
            currentStream.addTrack(newAudioTrack);
            newAudioTrack.enabled = true;
            
            setParams((prev) => ({
              ...prev,
              audio: { ...prev.audio, track: newAudioTrack },
            }));
            setAudioMuted(false);
            console.log('Audio unmuted with new track');
            
            // Notify other peers
            if (socket && roomId && peerId) {
              socket.emit('peer-muted', { roomId, peerId, kind: 'audio', muted: false });
            }
          }
        }).catch(error => {
          console.error('Error getting new audio track:', error);
        });
      }
    } else {
      // Mute: set track to null to stop sending audio
      const audioTrack = currentStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
        setParams((prev) => ({
          ...prev,
          audio: { ...prev.audio, track: null },
        }));
        setAudioMuted(true);
        console.log('Audio muted');
        
        // Notify other peers
        if (socket && roomId && peerId) {
          socket.emit('peer-muted', { roomId, peerId, kind: 'audio', muted: true });
        }
      }
    }
  }, [currentStream, audioMuted, socket, roomId, peerId]);

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
  };
};