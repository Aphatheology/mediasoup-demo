import mediasoup from "mediasoup";

export const createWebRtcTransport = async (
  router: mediasoup.types.Router<mediasoup.types.AppData>,
  callback: (arg0: { params: { id: string; iceParameters: mediasoup.types.IceParameters; iceCandidates: mediasoup.types.IceCandidate[]; dtlsParameters: mediasoup.types.DtlsParameters; } | { error: unknown; }; }) => void
) => {
  try {
    const webRtcTransportOptions = {
      listenIps: [{ ip: "0.0.0.0", announcedIp: process.env.ANNOUNCED_IP }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    const transport = await router.createWebRtcTransport(webRtcTransportOptions);
    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") transport.close();
    });
    transport.on("@close", () => {
      console.log("Transport closed");
    });

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    });

    return transport;
  } catch (error) {
    console.error("Error creating WebRTC transport:", error);
    callback({ params: { error } });
  }
};