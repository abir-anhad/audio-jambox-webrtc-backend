/*
================================================================================
File: /audio-jambox/backend/src/server.js
================================================================================
*/
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const setupSignaling = require('./signaling');

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS settings to allow connections from our frontend
const io = new Server(server, {
    cors: {
        origin: "*", // In production, restrict this to your frontend's URL
        methods: ["GET", "POST"]
    }
});

// Setup the signaling logic
setupSignaling(io);

const PORT = process.env.PORT || 3001; // Use a different port than the frontend

server.listen(PORT, () => {
    console.log(`Signaling server listening on port ${PORT}`);
});