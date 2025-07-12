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

export const useMediaStream = (): UseMediaStreamReturn => {
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
        audio: true,
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
      } catch (error) {
        console.error('Error turning on camera:', error);
      }
    } else {
      // Mute: stop the video track
      const videoTrack = currentStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        currentStream.removeTrack(videoTrack);

        setParams((prev) => ({
          ...prev,
          video: { ...prev.video, track: null },
        }));

        setVideoMuted(true);
        console.log('Video muted');
      }
    }
  }, [currentStream, videoMuted]);

  const toggleAudio = useCallback(() => {
    if (currentStream) {
      const audioTrack = currentStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioMuted;
        setAudioMuted(!audioMuted);
        console.log(audioMuted ? 'Audio unmuted' : 'Audio muted');
      }
    }
  }, [currentStream, audioMuted]);

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