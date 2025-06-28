/*
================================================================================
File: /audio-jambox/backend/src/Room.js
================================================================================
This version is refactored to correctly use the new config structure.
*/
const config = require('./config');

class Room {
    constructor({ roomId, worker, io }) {
        this.id = roomId;
        this.io = io;
        this.worker = worker;
        this.router = null;
        this.peers = new Map();
        this.log = (msg) => console.log(`[ROOM:${this.id}] ${new Date().toISOString()} - ${msg}`);
        this.error = (msg, err) => console.error(`[ROOM-ERROR:${this.id}] ${new Date().toISOString()} - ${msg}`, err);
    }

    static async create({ worker, roomId, io }) {
        const room = new Room({ roomId, worker, io });
        // Use router mediaCodecs from the new config
        room.router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });
        room.log('Router created');
        return room;
    }

    addPeer(socket) {
        const peer = {
            id: socket.id,
            socket,
            transports: new Map(),
            producers: new Map(),
            consumers: new Map(),
        };
        this.peers.set(socket.id, peer);
        socket.roomId = this.id;
        this.log(`Peer ADDED [id:${socket.id}]`);
    }

    getProducerPeerIds() {
        const producerPeerIds = [];
        for (const peer of this.peers.values()) {
            if (peer.producers.size > 0) {
                producerPeerIds.push(peer.id);
            }
        }
        this.log(`Found existing producer peers: [${producerPeerIds.join(', ')}]`);
        return producerPeerIds;
    }

    async createWebRtcTransport(peerId) {
        this.log(`Creating transport for peer [${peerId}]`);
        // Use webRtcTransport settings from the new config
        const transport = await this.router.createWebRtcTransport({
            ...config.mediasoup.webRtcTransport,
            appData: { peerId }
        });
        this.peers.get(peerId).transports.set(transport.id, transport);
        this.log(`Transport CREATED [id:${transport.id}] for peer [${peerId}]`);
        return { params: { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters } };
    }
    
    async connectWebRtcTransport({ peerId, transportId, dtlsParameters }) {
        const transport = this.peers.get(peerId)?.transports.get(transportId);
        if (!transport) throw new Error(`Transport ${transportId} not found for peer ${peerId}`);
        await transport.connect({ dtlsParameters });
    }
    
    async createProducer({ peerId, transportId, rtpParameters, kind }) {
        const transport = this.peers.get(peerId)?.transports.get(transportId);
        if (!transport) throw new Error(`Transport ${transportId} not found for peer ${peerId}`);
        const producer = await transport.produce({ kind, rtpParameters, appData: { peerId } });
        this.peers.get(peerId).producers.set(producer.id, producer);
        this.log(`Producer CREATED [id:${producer.id}], broadcasting 'new-producer' for peer [${peerId}]`);
        this.io.to(this.id).emit('new-producer', { peerId: peerId });
        return producer;
    }

    async createConsumer({ peerId, producerPeerId, rtpCapabilities }) {
        const producer = this.getProducerFromPeer(producerPeerId);
        if (!producer) return null;
        if (!this.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
            this.error(`Peer [${peerId}] cannot consume producer [${producer.id}]`);
            return null;
        }
        
        const consumerTransport = this.findRecvTransport(peerId);
        if (!consumerTransport) return null;

        const consumer = await consumerTransport.consume({ producerId: producer.id, rtpCapabilities, paused: true });
        this.peers.get(peerId).consumers.set(consumer.id, consumer);
        
        consumer.on('transportclose', () => this.peers.get(peerId)?.consumers.delete(consumer.id));
        consumer.on('producerclose', () => this.peers.get(peerId)?.consumers.delete(consumer.id));
        
        return { params: { id: consumer.id, producerId: producer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters } };
    }
    
    async resumeConsumer({ peerId, consumerId }) {
        const consumer = this.peers.get(peerId)?.consumers.get(consumerId);
        if (consumer) await consumer.resume();
    }
    
    handlePeerClose(peerId) {
        this.log(`Closing resources for peer [id:${peerId}]`);
        const peer = this.peers.get(peerId);
        if (!peer) return;
        peer.transports.forEach(transport => transport.close());
        this.peers.delete(peerId);
        this.io.to(this.id).emit('peer-closed', { peerId });
    }
    
    getProducerFromPeer(peerId) {
        const producers = this.peers.get(peerId)?.producers;
        return producers ? producers.values().next().value : null;
    }
    
    findRecvTransport(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return null;
        const sendTransportIds = new Set(Array.from(peer.producers.values()).map(p => p.transportId));
        for (const transport of peer.transports.values()) {
            if (!sendTransportIds.has(transport.id)) {
                return transport;
            }
        }
        return null;
    }
}

module.exports = Room;
