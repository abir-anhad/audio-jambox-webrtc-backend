/*
================================================================================
File: /audio-jambox/backend/src/config.js
================================================================================
Configuration for the mediasoup server, optimized for audio.
*/
module.exports = {
    // Server listening settings
    listenIp: '0.0.0.0',
    listenPort: 3030,

    // Mediasoup worker settings
    mediasoup: {
        numWorkers: 1,
        workerSettings: {
            logLevel: 'warn',
            logTags: [ 'info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp' ],
            rtcMinPort: 40000,
            rtcMaxPort: 49999
        },
        // Router settings for audio only
        router: {
            mediaCodecs: [
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2,
                    parameters: {
                        'useinbandfec': 1,
                        'minptime': 10
                    }
                }
            ]
        },
        // WebRTC transport settings
        webRtcTransport: {
            listenIps: [
                {
                    ip: '0.0.0.0',
                    announcedIp: '3.7.98.21', // Let mediasoup figure it out
                }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 1000000,
        }
    }
};