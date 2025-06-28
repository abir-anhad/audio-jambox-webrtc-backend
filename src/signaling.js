/*================================================================================
File: /audio-jambox/backend/src/signaling.js
================================================================================
*/

// This object will store room information
// In a production app, you might want to use a more persistent store like Redis
const rooms = {};

const setupSignaling = (io) => {
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);

        // Handler for when a user wants to join a room
        socket.on('join-room', (roomId) => {
            handleJoinRoom(socket, roomId);
        });

        // Handler for WebRTC signaling messages
        socket.on('webrtc-offer', (payload) => {
            console.log(`Forwarding offer from ${socket.id} to ${payload.to}`);
            io.to(payload.to).emit('webrtc-offer', { from: socket.id, offer: payload.offer });
        });

        socket.on('webrtc-answer', (payload) => {
            console.log(`Forwarding answer from ${socket.id} to ${payload.to}`);
            io.to(payload.to).emit('webrtc-answer', { from: socket.id, answer: payload.answer });
        });

        socket.on('webrtc-ice-candidate', (payload) => {
            io.to(payload.to).emit('webrtc-ice-candidate', { from: socket.id, candidate: payload.candidate });
        });
        
        // Handler for when a user explicitly leaves
        socket.on('leave-room', (roomId) => {
            handleLeaveRoom(socket, roomId);
        });

        // Handler for disconnection (e.g., closing the browser tab)
        socket.on('disconnect', () => {
            handleDisconnect(socket);
        });
    });

    const handleJoinRoom = (socket, roomId) => {
        const otherUsers = rooms[roomId] || [];
        
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }
        rooms[roomId].push(socket.id);
        socket.join(roomId);
        socket.roomId = roomId; // Store roomId on the socket object for later

        console.log(`User ${socket.id} joined room ${roomId}`);

        // Inform the new user about existing users in the room
        socket.emit('existing-users', otherUsers);
        
        // Inform existing users that a new user has joined
        socket.to(roomId).emit('user-joined', socket.id);
    };

    const handleLeaveRoom = (socket, roomId) => {
        if (!rooms[roomId]) return;
        
        console.log(`User ${socket.id} left room ${roomId}`);
        // Remove user from the room
        rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
        socket.to(roomId).emit('user-left', socket.id);
        socket.leave(roomId);
        delete socket.roomId;
        
        // If the room is empty, delete it
        if (rooms[roomId].length === 0) {
            delete rooms[roomId];
        }
    };

    const handleDisconnect = (socket) => {
        console.log(`User disconnected: ${socket.id}`);
        // The `leaveRoom` logic will be triggered by finding the user in the rooms object
        if (socket.roomId) {
            handleLeaveRoom(socket, socket.roomId);
        }
    };
};

module.exports = setupSignaling;
