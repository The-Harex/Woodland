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
let isGameRunning = false;
let hostId = null;
const COLORS = [
    0xff0000, // Red
    0xffff00, // Yellow
    0xff00ff, // Magenta
    0xffa500, // Orange
    0xff1493, // Deep Pink
    0xffffff  // White
];

function checkGameReset() {
    if (!isGameRunning) return;
    
    const activePlayers = Object.values(players).filter(p => p.inGame);
    if (activePlayers.length === 0) {
        console.log("All players returned to lobby. Resetting game.");
        isGameRunning = false;
        stopHordeTimer();
        
        // Reset zombies
        for (let id in zombies) delete zombies[id];
        nextZombieId = 0;
        
        io.emit('gameStateUpdate', false);
        io.emit('zombieUpdate', []); // Clear zombies on clients
    }
}

io.on('connection', (socket) => {
    console.log('a user connected: ' + socket.id);

    if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('serverFull');
        socket.disconnect();
        return;
    }

    // Assign Host
    // Removed automatic assignment on connection. Host is assigned on join.
    /*
    if (!hostId) {
        hostId = socket.id;
    }
    */

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
        name: "Player",
        isHost: false,
        joined: false,
        inGame: false,
        kills: 0
    };

    // Send current players to the new player
    socket.emit('currentPlayers', players);
    socket.emit('gameStateUpdate', isGameRunning);

    // If game is running, send timer
    if (isGameRunning) {
        socket.emit('hordeTimerUpdate', nextHordeTime);
        socket.emit('gameTimerUpdate', gameEndTime);
    }

    // Broadcast new player to others
    socket.broadcast.emit('newPlayer', players[socket.id]);
    io.emit('lobbyUpdate', players); // Send full list to everyone to keep lobby sync

    socket.on('disconnect', () => {
        console.log('user disconnected: ' + socket.id);
        delete players[socket.id];
        
        // Host Migration
        if (socket.id === hostId) {
            hostId = null;
            // Find next joined player
            const remainingIds = Object.keys(players).filter(id => players[id].joined);
            if (remainingIds.length > 0) {
                hostId = remainingIds[0];
                players[hostId].isHost = true;
                io.to(hostId).emit('youAreHost');
            }
        }

        io.emit('playerDisconnected', socket.id);
        io.emit('lobbyUpdate', players);

        checkGameReset();

        if (Object.keys(players).length === 0) {
            stopHordeTimer();
            isGameRunning = false;
            hostId = null;
            // Reset zombies
            for (let id in zombies) delete zombies[id];
            nextZombieId = 0;
        }
    });

    socket.on('startGame', (difficulty) => {
        if (socket.id !== hostId) return; // Only host can start

        if (!isGameRunning) {
            isGameRunning = true;
            currentDifficulty = difficulty || 'easy';
            
            // Mark all joined players as in-game
            Object.values(players).forEach(p => {
                if (p.joined) p.inGame = true;
            });

            startHordeTimer();
            io.emit('gameStarted');
        }
    });

    socket.on('returnToLobby', () => {
        if (players[socket.id]) {
            players[socket.id].inGame = false;
            players[socket.id].isDead = false; // Reset dead status
            checkGameReset();
        }
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
                players[socket.id].joined = true;
                
                // Assign host if none exists
                if (!hostId) {
                    hostId = socket.id;
                    players[socket.id].isHost = true;
                }

                io.emit('nameUpdated', { id: socket.id, name: name, color: players[socket.id].color });
                socket.emit('joinSuccess', { name: name, isHost: players[socket.id].isHost });
                io.emit('lobbyUpdate', players); // Update lobby with new name
            }
        }
    });

    socket.on('shootPlayer', (targetId) => {
        // Notify the target that they were shot, include shooter ID
        io.to(targetId).emit('playerDamaged', 10, socket.id); 
    });

    socket.on('playerDied', (killerId) => {
        if (players[socket.id]) {
            players[socket.id].isDead = true;
        }
        
        // Update killer's score
        if (killerId && players[killerId]) {
            players[killerId].kills++;
            io.emit('updatePlayerKills', { id: killerId, kills: players[killerId].kills });
        }

        socket.broadcast.emit('playerDied', socket.id);
    });

    socket.on('playerRespawn', () => {
        socket.broadcast.emit('playerRespawn', socket.id);
    });



    socket.on('shootZombie', (zombieId) => {
        if (zombies[zombieId]) {
            zombies[zombieId].health -= 50; // 4 shots to kill (assuming 200 health)
            if (zombies[zombieId].health <= 0) {
                delete zombies[zombieId];
                io.emit('zombieDied', zombieId);
            } else {
                io.emit('zombieDamaged', { id: zombieId, health: zombies[zombieId].health });
            }
        }
    });
});

// Zombie Logic
const zombies = {};
let nextZombieId = 0;
const ZOMBIE_SPEED = 4.0; // Double normal speed (assuming normal is 2.0)
const HORDE_BASE_SIZE = 25;
const MAP_SIZE = 400;
const TICK_RATE = 20;
const TICK_INTERVAL = 1000 / TICK_RATE;
let currentDifficulty = 'easy';

function spawnHorde(waveNumber) {
    const hordeX = (Math.random() - 0.5) * (MAP_SIZE - 20); // Keep away from edge
    const hordeZ = (Math.random() - 0.5) * (MAP_SIZE - 20);

    let zombieHealth = 200; // Default Easy
    if (currentDifficulty === 'medium') zombieHealth = 300;
    if (currentDifficulty === 'hard') zombieHealth = 400;

    const currentHordeSize = HORDE_BASE_SIZE * waveNumber;

    for (let i = 0; i < currentHordeSize; i++) {
        const id = nextZombieId++;
        zombies[id] = {
            id: id,
            x: hordeX + (Math.random() - 0.5) * 10, // Cluster them
            z: hordeZ + (Math.random() - 0.5) * 10,
            health: zombieHealth,
            speed: ZOMBIE_SPEED
        };
    }
    io.emit('hordeSpawned', Object.values(zombies));
}

// Spawn horde every minute
let nextHordeTime = 0;
let gameEndTime = 0;
let hordeInterval = null;
let waveCount = 0;
const MAX_WAVES = 10;

function startHordeTimer() {
    if (hordeInterval) return;
    console.log("Starting Horde Timer");
    waveCount = 0;

    // Spawn first wave immediately
    spawnHorde(waveCount + 1);
    waveCount++;

    nextHordeTime = Date.now() + 60000;
    gameEndTime = Date.now() + (MAX_WAVES * 60000);
    
    io.emit('hordeTimerUpdate', nextHordeTime);
    io.emit('gameTimerUpdate', gameEndTime);
    
    hordeInterval = setInterval(() => {
        if (waveCount >= MAX_WAVES) {
            // Victory!
            io.emit('gameVictory');
            stopHordeTimer();
            isGameRunning = false;
            checkGameReset(); // Clean up
            return;
        }

        spawnHorde(waveCount + 1);
        waveCount++;

        nextHordeTime = Date.now() + 60000;
        io.emit('hordeTimerUpdate', nextHordeTime);
    }, 60000);
}

function stopHordeTimer() {
    if (hordeInterval) {
        console.log("Stopping Horde Timer");
        clearInterval(hordeInterval);
        hordeInterval = null;
        nextHordeTime = 0;
        gameEndTime = 0;
        io.emit('hordeTimerUpdate', 0);
        io.emit('gameTimerUpdate', 0);
        
        // Optional: Clear zombies on reset?
        // for (let id in zombies) delete zombies[id];
        // io.emit('zombieUpdate', []); // Or a clear event
    }
}

// Game Loop
setInterval(() => {
    const playerIds = Object.keys(players);
    if (playerIds.length === 0) return;

    const zombieIds = Object.keys(zombies);
    let updates = [];

    zombieIds.forEach(zid => {
        const zombie = zombies[zid];
        let nearestPlayer = null;
        let minDist = Infinity;

        // Find nearest player
        playerIds.forEach(pid => {
            const p = players[pid];
            if (!p.joined) return; // Ignore unjoined players, but attack dead ones

            const dx = p.x - zombie.x;
            const dz = p.z - zombie.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist < minDist) {
                minDist = dist;
                nearestPlayer = p;
            }
        });

        if (nearestPlayer) {
            // Move towards player
            const dx = nearestPlayer.x - zombie.x;
            const dz = nearestPlayer.z - zombie.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            let moveX = 0;
            let moveZ = 0;

            // Seek behavior
            if (dist > 1) { 
                moveX += (dx / dist);
                moveZ += (dz / dist);
            }

            // Separation behavior (prevent stacking)
            const separationRadius = 1.5;
            let sepX = 0;
            let sepZ = 0;
            let count = 0;

            zombieIds.forEach(otherId => {
                if (otherId === zid) return;
                const other = zombies[otherId];
                const odx = zombie.x - other.x;
                const odz = zombie.z - other.z;
                const odist = Math.sqrt(odx*odx + odz*odz);

                if (odist < separationRadius && odist > 0) {
                    sepX += (odx / odist) / odist; // Weight by inverse distance
                    sepZ += (odz / odist) / odist;
                    count++;
                }
            });

            if (count > 0) {
                const separationWeight = 2.0;
                moveX += sepX * separationWeight;
                moveZ += sepZ * separationWeight;
            }

            // Apply movement
            const moveLen = Math.sqrt(moveX*moveX + moveZ*moveZ);
            if (moveLen > 0) {
                const moveDist = (zombie.speed / TICK_RATE);
                zombie.x += (moveX / moveLen) * moveDist;
                zombie.z += (moveZ / moveLen) * moveDist;
            }

            // Attack if close
            if (dist < 1.5) {
                // Simple cooldown or damage check could be added here
                // For now, let's just damage the player occasionally or rely on client to show it?
                // Better to do it on server.
                // We need a cooldown per zombie or per player.
                // Let's just emit an attack event or damage directly.
                // To avoid spamming, we can add a lastAttack time to zombie.
                const now = Date.now();
                if (!zombie.lastAttack || now - zombie.lastAttack > 1000) {
                    io.to(nearestPlayer.id).emit('playerDamaged', 10);
                    zombie.lastAttack = now;
                }
            }
            
            updates.push({
                id: zombie.id,
                x: zombie.x,
                z: zombie.z,
                rotation: Math.atan2(dx, dz) // Face player
            });
        }
    });

    if (updates.length > 0) {
        io.emit('zombieUpdate', updates);
    }
}, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`listening on *:${PORT}`);
});