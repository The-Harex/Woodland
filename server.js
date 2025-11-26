const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from any origin for simplicity
        methods: ["GET", "POST"]
    }
});

app.use(express.static('.'));

const players = {};
const MAX_PLAYERS = 4;
const COLORS = [
    0xff0000, // Red
    0xffff00, // Yellow
    0xff00ff, // Magenta
    0xffa500, // Orange
    0xff1493, // Deep Pink
    0xffffff  // White
];

io.on('connection', (socket) => {
    console.log('a user connected: ' + socket.id);

    if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('serverFull');
        socket.disconnect();
        return;
    }

    // Assign a random color that isn't taken (or just random if we don't care about dupes, but user asked for unique)
    // Simple unique color assignment
    const usedColors = Object.values(players).map(p => p.color);
    let assignedColor = COLORS.find(c => !usedColors.includes(c));
    if (!assignedColor) assignedColor = COLORS[Math.floor(Math.random() * COLORS.length)];

    players[socket.id] = {
        id: socket.id,
        x: 0,
        y: 50,
        z: 0,
        rotation: 0,
        color: assignedColor,
        name: "Player"
    };

    // Send current players to the new player
    socket.emit('currentPlayers', players);

    // Broadcast new player to others
    socket.broadcast.emit('newPlayer', players[socket.id]);

    socket.on('disconnect', () => {
        console.log('user disconnected: ' + socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotation = movementData.rotation;
            
            // Broadcast to others (excluding sender)
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('requestJoin', (name) => {
        // Check if name is taken (case-insensitive)
        const isTaken = Object.values(players).some(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== socket.id);
        
        if (isTaken) {
            socket.emit('joinError', 'Name is already taken. Please choose another.');
        } else {
            if (players[socket.id]) {
                players[socket.id].name = name;
                io.emit('nameUpdated', { id: socket.id, name: name, color: players[socket.id].color });
                socket.emit('joinSuccess', { name: name });
            }
        }
    });

    socket.on('shootPlayer', (targetId) => {
        // Notify the target that they were shot
        io.to(targetId).emit('playerDamaged', 10); // 10 damage per shot
    });

    socket.on('playerDied', () => {
        socket.broadcast.emit('playerDied', socket.id);
    });

    socket.on('playerRespawn', () => {
        socket.broadcast.emit('playerRespawn', socket.id);
    });

    socket.on('disconnect', () => {
        console.log('user disconnected: ' + socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotation = movementData.rotation;
            
            // Broadcast to others (excluding sender)
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('requestJoin', (name) => {
        // Check if name is taken (case-insensitive)
        const isTaken = Object.values(players).some(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== socket.id);
        
        if (isTaken) {
            socket.emit('joinError', 'Name is already taken. Please choose another.');
        } else {
            if (players[socket.id]) {
                players[socket.id].name = name;
                io.emit('nameUpdated', { id: socket.id, name: name, color: players[socket.id].color });
                socket.emit('joinSuccess', { name: name });
            }
        }
    });

    socket.on('shootPlayer', (targetId) => {
        // Notify the target that they were shot
        io.to(targetId).emit('playerDamaged', 10); // 10 damage per shot
    });

    socket.on('playerDied', () => {
        socket.broadcast.emit('playerDied', socket.id);
    });

    socket.on('playerRespawn', () => {
        socket.broadcast.emit('playerRespawn', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`listening on *:${PORT}`);
});