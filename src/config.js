/*
================================================================================
File: /audio-jambox/backend/src/config.js
================================================================================
This configuration has been updated with your specified high-quality
audio settings and environment-specific logging.
*/
const os = require('os');

// Helper function to find a non-internal IPv4 address
const getLocalIp = () => {
    const networkInterfaces = os.networkInterfaces();
    for (const name of Object.keys(networkInterfaces)) {
        for (const net of networkInterfaces[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
};

const commonConfig = {
    listenIp: '0.0.0.0',
    listenPort: 3030, // Using the port from your new config
    
    mediasoup: {
        numWorkers: os.cpus().length, // Use all available CPU cores
        
        // Mediasoup router settings, using your high-quality audio codec.
        // The video codec is omitted as this is an audio-only application.
        router: {
            mediaCodecs: [
                {
                    kind: "audio",
                    mimeType: "audio/opus",
                    clockRate: 48000,
                    channels: 2, // 2 channels for stereo audio
                    parameters: {
                        'useinbandfec': 1,
                        'stereo': 1,
                        'sprop-stereo': 1,
                        'maxplaybackrate': 48000,
                        'ptime': 20,
                        'minptime': 10
                    }
                }
            ]
        },
        
        // Mediasoup WebRTC transport settings
        webRtcTransport: {
            listenIps: [{
                ip: '0.0.0.0',
                announcedIp: '3.7.98.21'
            }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            maxIncomingBitrate: 1500000, // Adjusted for high-quality audio
            initialAvailableOutgoingBitrate: 1000000,
        }
    }
};

// Environment-specific settings
const environments = {
    development: {
        mediasoup: {
            workerSettings: {
                rtcMinPort: 40000,
                rtcMaxPort: 41000,
                logLevel: 'debug',
                logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp', 'bwe']
            }
        }
    },
    production: {
        mediasoup: {
            workerSettings: {
                rtcMinPort: 40000,
                rtcMaxPort: 41000,
                logLevel: 'error',
                logTags: []
            }
        }
    }
};

const env = process.env.NODE_ENV || 'development';

// Deep merge common config with environment-specific config
module.exports = {
    ...commonConfig,
    mediasoup: {
        ...commonConfig.mediasoup,
        ...environments[env].mediasoup
    }
};
