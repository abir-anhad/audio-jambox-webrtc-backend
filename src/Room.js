/*
================================================================================
File: /audio-jambox/backend/src/Room.js
================================================================================
A class to encapsulate the logic for a single Mediasoup room.
*/
const config = require('./config');

class Room {
    constructor({ roomId, worker, io }) {
        this.id = roomId;
        this.io = io;
        this.worker = worker;
        this.router = null; // Created in create()
        this.peers = new Map(); // Map<peerId, Peer>
    }

    // Static async factory function
    static async create({ worker, roomId, io }) {
        const room = new Room({ roomId, worker, io });
        room.router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });
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
        console.log(`Peer ${socket.id} joined room ${this.id}`);
    }

    getPeerIds() {
        return Array.from(this.peers.keys());
    }

    async createWebRtcTransport(peerId) {
        const transport = await this.router.createWebRtcTransport({
            ...config.mediasoup.webRtcTransport,
        });

        this.peers.get(peerId).transports.set(transport.id, transport);

        return {
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            }
        };
    }
    
    async connectWebRtcTransport({ peerId, transportId, dtlsParameters }) {
        const transport = this.peers.get(peerId)?.transports.get(transportId);
        if (!transport) throw new Error('Transport not found');
        await transport.connect({ dtlsParameters });
    }
    
    async createProducer({ peerId, transportId, rtpParameters, kind }) {
        const transport = this.peers.get(peerId)?.transports.get(transportId);
        if (!transport) throw new Error('Transport not found');

        const producer = await transport.produce({ kind, rtpParameters });
        this.peers.get(peerId).producers.set(producer.id, producer);

        // Notify other peers in the room
        this.io.to(this.id).emit('new-producer', {
            peerId: peerId,
            producerId: producer.id
        });

        return producer;
    }

    async createConsumer({ peerId, producerPeerId, rtpCapabilities }) {
        const producer = this.getProducerFromPeer(producerPeerId);
        if (!producer || !this.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
            console.error('Cannot consume');
            return;
        }

        const consumerTransport = this.findConsumerTransport(peerId);
        if (!consumerTransport) throw new Error('No suitable consumer transport found');

        const consumer = await consumerTransport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: true
        });

        this.peers.get(peerId).consumers.set(consumer.id, consumer);
        
         consumer.on('transportclose', () => {
            this.peers.get(peerId).consumers.delete(consumer.id);
        });
        consumer.on('producerclose', () => {
             this.peers.get(peerId).consumers.delete(consumer.id);
        });

        return {
            params: {
                id: consumer.id,
                producerId: producer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
            }
        };
    }
    
    async resumeConsumer({ peerId, consumerId }) {
        const consumer = this.peers.get(peerId)?.consumers.get(consumerId);
        if (consumer) await consumer.resume();
    }
    
    handlePeerClose(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        console.log(`Closing resources for peer ${peerId}`);
        peer.transports.forEach(transport => transport.close());
        this.peers.delete(peerId);
        this.io.to(this.id).emit('peer-closed', { peerId });
    }
    
    // --- Helper methods ---
    getProducerFromPeer(peerId) {
        // Since we assume one audio producer per peer, we can just grab the first one.
        const producers = this.peers.get(peerId)?.producers;
        return producers ? producers.values().next().value : null;
    }
    
    findConsumerTransport(peerId) {
        // Find a transport that can be used for consuming.
        // In this simple case, we assume one transport handles everything.
         return Array.from(this.peers.get(peerId).transports.values())[0];
    }
}

module.exports = Room;