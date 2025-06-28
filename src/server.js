/*
================================================================================
File: /audio-jambox/backend/src/server.js
================================================================================
*/
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require("socket.io");
const mediasoup = require('mediasoup');
const fs = require('fs');
const config = require('./config');

const app = express();
let httpsServer;

// Gracefully handle uncaught exceptions to prevent server crashes
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err.message);
    console.error(err.stack);
});

if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    console.log('Running in secure mode (HTTPS)');
    try {
        const key = fs.readFileSync('/home/ubuntu/certs/privkey.pem');
        const cert = fs.readFileSync('/home/ubuntu/certs/fullchain.pem');
        httpsServer = https.createServer({ key, cert }, app);
    } catch (e) {
        console.error("SSL Certificate error: Make sure cert.key and cert.crt are present in ./config", e);
   
    }
} else {
    console.log('Running in development mode (HTTP)');
    httpsServer = http.createServer(app);
}

// Configure Socket.IO with CORS settings to allow connections from our frontend
const io = new Server(httpsServer, {
    cors: {
        origin: "*", // In production, restrict this to your frontend's URL
        methods: ["GET", "POST"]
    }
});

// In-memory store for rooms
const rooms = new Map();

(async () => {
    // --- 1. Create Mediasoup Workers ---
    const workers = [];
    for (let i = 0; i < config.mediasoup.numWorkers; ++i) {
        const worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.workerSettings.logLevel,
            logTags: config.mediasoup.workerSettings.logTags,
            rtcMinPort: config.mediasoup.workerSettings.rtcMinPort,
            rtcMaxPort: config.mediasoup.workerSettings.rtcMaxPort,
        });
        worker.on('died', () => {
            console.error(`mediasoup worker ${worker.pid} has died`);
            setTimeout(() => process.exit(1), 2000);
        });
        workers.push(worker);
    }

    // --- 2. Handle Socket.IO connections ---
    let nextWorkerIndex = 0;
    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);

        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);
            const room = rooms.get(socket.roomId);
            if (room) {
                room.handlePeerClose(socket.id);
            }
        });

        // --- Signaling Handlers ---
        socket.on('getRouterRtpCapabilities', (data, callback) => {
            const room = rooms.get(data.roomId);
            if (room) {
                callback(room.router.rtpCapabilities);
            }
        });

        socket.on('join', async (data, callback) => {
            let room = rooms.get(data.roomId);
            if (!room) {
                const worker = workers[nextWorkerIndex];
                nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
                room = await Room.create({ worker, roomId: data.roomId, io });
                rooms.set(data.roomId, room);
            }
            room.addPeer(socket);
            callback({ peerIds: room.getPeerIds() });
        });

        socket.on('createWebRtcTransport', async (data, callback) => {
            const room = rooms.get(data.roomId);
            if (room) {
                const { params } = await room.createWebRtcTransport(socket.id);
                callback(params);
            }
        });

        socket.on('connectWebRtcTransport', async (data, callback) => {
            const room = rooms.get(data.roomId);
            if (room) {
                await room.connectWebRtcTransport({
                    peerId: socket.id,
                    transportId: data.transportId,
                    dtlsParameters: data.dtlsParameters
                });
                callback();
            }
        });

        socket.on('produce', async (data, callback) => {
            const room = rooms.get(data.roomId);
            if (room) {
                const producer = await room.createProducer({
                    peerId: socket.id,
                    transportId: data.transportId,
                    rtpParameters: data.rtpParameters,
                    kind: data.kind
                });
                callback({ id: producer.id });
            }
        });

        socket.on('consume', async (data, callback) => {
             const room = rooms.get(data.roomId);
            if (room) {
                 const result = await room.createConsumer({
                    peerId: socket.id,
                    producerPeerId: data.producerPeerId,
                    rtpCapabilities: data.rtpCapabilities
                });
                callback(result);
            }
        });

         socket.on('resume', async (data, callback) => {
            const room = rooms.get(data.roomId);
            if (room) {
                await room.resumeConsumer({ peerId: socket.id, consumerId: data.consumerId });
                callback();
            }
        });
    });

    // --- Start Server ---
    httpsServer.listen(config.listenPort, config.listenIp, () => {
        console.log(`Server listening on ${config.listenIp}:${config.listenPort}`);
    });

})();
