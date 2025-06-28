/*
================================================================================
File: /audio-jambox/backend/src/server.js
================================================================================
This version is refactored to correctly use the new config structure.
*/
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require("socket.io");
const mediasoup = require('mediasoup');
const fs = require('fs');
const config = require('./config'); // Load the new config
const Room = require('./Room');

const app = express();
let httpsServer;

const log = (msg) => console.log(`[SERVER] ${new Date().toISOString()} - ${msg}`);
const errorLog = (msg, err) => console.error(`[SERVER-ERROR] ${new Date().toISOString()} - ${msg}`, err);

process.on('uncaughtException', (err) => {
    errorLog('FATAL Uncaught Exception:', err);
});

// Use HTTPS if certificates are provided (for production/staging)
if ((process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') && fs.existsSync('/home/ubuntu/certs/privkey.pem')) {
    log('Attempting to run in secure mode (HTTPS)');
    try {
        const key = fs.readFileSync('/home/ubuntu/certs/privkey.pem');
        const cert = fs.readFileSync('/home/ubuntu/certs/fullchain.pem');
        httpsServer = https.createServer({ key, cert }, app);
    } catch (e) {
        errorLog("SSL Certificate error. Could not read certificate files.", e);
        process.exit(1);
    }
} else {
    log('Running in development mode (HTTP)');
    httpsServer = http.createServer(app);
}

const io = new Server(httpsServer, { cors: { origin: "*" } });
const rooms = new Map();

(async () => {
    const workers = [];
    // Use numWorkers from the new config
    for (let i = 0; i < config.mediasoup.numWorkers; ++i) {
        const worker = await mediasoup.createWorker({
            // Use workerSettings from the new config
            ...config.mediasoup.workerSettings
        });
        worker.on('died', () => errorLog(`mediasoup worker ${worker.pid} has died`));
        workers.push(worker);
        log(`Mediasoup worker created [pid:${worker.pid}]`);
    }

    let nextWorkerIndex = 0;
    io.on('connection', (socket) => {
        log(`<< Client connected: ${socket.id}`);

        socket.on('disconnect', () => {
            log(`>> Client disconnected: ${socket.id}`);
            const room = rooms.get(socket.roomId);
            if (room) {
                room.handlePeerClose(socket.id);
            }
        });

        socket.on('getRouterRtpCapabilities', (data, callback) => {
            log(`>> [${socket.id}] requested routerRtpCapabilities for room [${data.roomId}]`);
            const room = rooms.get(data.roomId);
            if (room) {
                callback(room.router.rtpCapabilities);
            }
        });

        socket.on('join', async (data, callback) => {
            log(`>> [${socket.id}] requested to join room [${data.roomId}]`);
            let room = rooms.get(data.roomId);
            if (!room) {
                log(`Room [${data.roomId}] does not exist. Creating it.`);
                const worker = workers[nextWorkerIndex];
                nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
                room = await Room.create({ worker, roomId: data.roomId, io });
                rooms.set(data.roomId, room);
            }
            
            const producerPeerIds = room.getProducerPeerIds();
            socket.join(data.roomId);
            room.addPeer(socket);
            
            log(`<< [${socket.id}] joined room [${data.roomId}]. Responding with peers [${producerPeerIds.join(', ')}]`);
            callback({ peerIds: producerPeerIds });
        });

        socket.on('createWebRtcTransport', async (data, callback) => {
            log(`>> [${socket.id}] requested to create WebRtcTransport`);
            const room = rooms.get(data.roomId);
            if (room) {
                const { params } = await room.createWebRtcTransport(socket.id);
                callback(params);
            }
        });

        socket.on('connectWebRtcTransport', async (data, callback) => {
            log(`>> [${socket.id}] requested to connect transport [id:${data.transportId}]`);
            const room = rooms.get(data.roomId);
            if (room) {
                await room.connectWebRtcTransport({ peerId: socket.id, transportId: data.transportId, dtlsParameters: data.dtlsParameters });
                callback();
            }
        });

        socket.on('produce', async (data, callback) => {
            log(`>> [${socket.id}] requested to produce [kind:${data.kind}] on transport [id:${data.transportId}]`);
            const room = rooms.get(data.roomId);
            if (room) {
                const producer = await room.createProducer({ peerId: socket.id, transportId: data.transportId, rtpParameters: data.rtpParameters, kind: data.kind });
                callback({ id: producer.id });
            }
        });

        socket.on('consume', async (data, callback) => {
            log(`>> [${socket.id}] requested to consume from peer [${data.producerPeerId}]`);
            const room = rooms.get(data.roomId);
            if (room) {
                 const result = await room.createConsumer({ peerId: socket.id, producerPeerId: data.producerPeerId, rtpCapabilities: data.rtpCapabilities });
                callback(result);
            }
        });

        socket.on('resume', async (data, callback) => {
            log(`>> [${socket.id}] requested to resume consumer [id:${data.consumerId}]`);
            const room = rooms.get(data.roomId);
            if (room) {
                await room.resumeConsumer({ peerId: socket.id, consumerId: data.consumerId });
                callback();
            }
        });
    });

    httpsServer.listen(config.listenPort, config.listenIp, () => {
        log(`Server listening on ${config.listenIp}:${config.listenPort}`);
    });
})();
