import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createNoise2D } from 'simplex-noise';
import { io } from 'socket.io-client';

// Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue
scene.fog = new THREE.Fog(0x87ceeb, 10, 100);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.y = 2;

// Minimap Camera
const mapSize = 60; // View size in world units
const mapCamera = new THREE.OrthographicCamera(
    -mapSize, mapSize, 
    mapSize, -mapSize, 
    1, 1000
);
mapCamera.position.set(0, 100, 0);
mapCamera.lookAt(0, 0, 0);
mapCamera.up.set(0, 0, -1); // Rotate so top is North (negative Z)
mapCamera.layers.enable(1); // Enable layer 1 for minimap marker

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Networking
let socket;
const otherPlayers = {};
const playerListContainer = document.getElementById('player-list');

function initSocket() {
    // Connect to the server (assumes server is running on same host/port or configured proxy)
    // If running via Live Server, we might need to point to localhost:3000 explicitly
    // For now, let's try to connect to localhost:3000 if we are on a different port
    const serverUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3000' 
        : window.location.origin;

    socket = io(serverUrl);

    socket.on('connect', () => {
        console.log('Connected to server');
        // Wait for user to click start to join
    });

    socket.on('joinSuccess', (data) => {
        gamerName = data.name;
        isGameStarted = true;
        controls.lock();
    });

    socket.on('joinError', (msg) => {
        alert(msg);
    });

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) {
                addOtherPlayer(players[id]);
            }
        });
        updatePlayerList(players);
    });

    socket.on('newPlayer', (playerInfo) => {
        addOtherPlayer(playerInfo);
    });

    socket.on('playerMoved', (playerInfo) => {
        if (otherPlayers[playerInfo.id]) {
            otherPlayers[playerInfo.id].mesh.position.set(playerInfo.x, playerInfo.y, playerInfo.z);
            otherPlayers[playerInfo.id].mesh.rotation.y = playerInfo.rotation;
        }
    });

    socket.on('playerDisconnected', (playerId) => {
        removeOtherPlayer(playerId);
    });

    socket.on('nameUpdated', (playerInfo) => {
        updatePlayerListEntry(playerInfo);
    });

    socket.on('playerDamaged', (amount) => {
        damagePlayer(amount);
    });

    socket.on('playerDied', (id) => {
        if (otherPlayers[id]) {
            // Death Animation: Rotate to lie flat
            otherPlayers[id].mesh.rotation.x = -Math.PI / 2;
            otherPlayers[id].mesh.position.y -= 0.5; // Lower to ground
        }
    });

    socket.on('playerRespawn', (id) => {
        if (otherPlayers[id]) {
            // Reset Rotation
            otherPlayers[id].mesh.rotation.x = 0;
            // Position will be updated by next movement packet
        }
    });
}

function addOtherPlayer(playerInfo) {
    // Prevent adding duplicate meshes
    if (otherPlayers[playerInfo.id]) return;

    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16);
    const material = new THREE.MeshStandardMaterial({ color: playerInfo.color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(playerInfo.x, playerInfo.y, playerInfo.z);

    // Arms
    const armGeometry = new THREE.BoxGeometry(0.15, 0.6, 0.15);
    const armMaterial = new THREE.MeshStandardMaterial({ color: playerInfo.color });

    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.6, 0.4, 0.2);
    leftArm.rotation.x = -Math.PI / 2;
    mesh.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.6, 0.4, 0.2);
    rightArm.rotation.x = -Math.PI / 2;
    mesh.add(rightArm);

    // Gun
    const gunGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.6);
    const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const gun = new THREE.Mesh(gunGeometry, gunMaterial);
    gun.position.set(0, -0.3, 0); // At the end of the arm
    rightArm.add(gun);

    scene.add(mesh);

    otherPlayers[playerInfo.id] = { mesh: mesh, info: playerInfo };
    
    updatePlayerListEntry(playerInfo);
}

function removeOtherPlayer(playerId) {
    if (otherPlayers[playerId]) {
        scene.remove(otherPlayers[playerId].mesh);
        delete otherPlayers[playerId];
    }
    const tag = document.getElementById(`player-tag-${playerId}`);
    if (tag) tag.remove();
}

function updatePlayerListEntry(p) {
    let tag = document.getElementById(`player-tag-${p.id}`);
    if (!tag) {
        tag = document.createElement('div');
        tag.id = `player-tag-${p.id}`;
        tag.className = 'player-tag';
        playerListContainer.appendChild(tag);
    }
    
    let displayName = p.name;
    if (socket && p.id === socket.id) {
        displayName += " (You)";
        tag.style.fontWeight = "bold";
        tag.style.textDecoration = "underline";
    }
    
    tag.innerText = displayName;
    
    // Set text color to player color for visibility
    const colorHex = '#' + p.color.toString(16).padStart(6, '0');
    tag.style.color = colorHex;
    tag.style.borderLeftColor = colorHex;
    
    // Ensure background is visible
    tag.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
}

function updatePlayerList(players) {
    playerListContainer.innerHTML = ''; // Clear list to ensure correct order/cleanup
    Object.values(players).forEach(p => {
        updatePlayerListEntry(p);
    });
}

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// Controls
const controls = new PointerLockControls(camera, document.body);
const instructions = document.getElementById('instructions');
const startBtn = document.getElementById('start-btn');
const gamerNameInput = document.getElementById('gamer-name');
const shareLinkInput = document.getElementById('share-link');
const copyLinkBtn = document.getElementById('copy-link-btn');

// Share Link Logic
shareLinkInput.value = window.location.href;
copyLinkBtn.addEventListener('click', () => {
    shareLinkInput.select();
    document.execCommand('copy');
    copyLinkBtn.innerText = "Copied!";
    setTimeout(() => copyLinkBtn.innerText = "Copy", 2000);
});

let gamerName = "Player";
let isGameStarted = false;

startBtn.addEventListener('click', () => {
    const nameInput = gamerNameInput.value.trim();
    
    if (nameInput === "") {
        alert("Please enter a name.");
        return;
    }

    if (!socket) {
        initSocket();
    }
    
    socket.emit('requestJoin', nameInput);
});

// Resume game when clicking instructions if game already started
instructions.addEventListener('click', (e) => {
    // Only lock if game is started and we didn't click an input/button
    if (isGameStarted && e.target === instructions) {
        controls.lock();
    }
});

controls.addEventListener('lock', () => {
    instructions.classList.add('hidden');
});

controls.addEventListener('unlock', () => {
    instructions.classList.remove('hidden');
    
    if (isGameStarted) {
        // Hide name input and start button, show "Click to Resume"
        gamerNameInput.style.display = 'none';
        startBtn.style.display = 'none';
        
        let resumeMsg = document.getElementById('resume-msg');
        if (!resumeMsg) {
            resumeMsg = document.createElement('h2');
            resumeMsg.id = 'resume-msg';
            resumeMsg.innerText = "Click to Resume";
            resumeMsg.style.marginTop = "20px";
            // Insert after title
            instructions.insertBefore(resumeMsg, gamerNameInput);
        }
        resumeMsg.style.display = 'block';
    }
});

// Raycaster (Global)
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

// Terrain Generation
// Seeded Random for consistent map across clients
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
const seed = 8888; // Fixed seed
const rng = mulberry32(seed);
const noise2D = createNoise2D(rng);

const worldWidth = 400;
const worldDepth = 400;
const geometry = new THREE.PlaneGeometry(worldWidth, worldDepth, 399, 399);
geometry.rotateX(-Math.PI / 2);

const vertices = geometry.attributes.position.array;
const colors = [];
const colorAttribute = new THREE.BufferAttribute(new Float32Array(vertices.length), 3);

// Parameters
const scale = 0.015;
const heightScale = 30;
const riverThreshold = -0.2;

function getTerrainHeight(x, z) {
    const n = noise2D(x * scale, z * scale);
    let y = 0;

    if (n < riverThreshold) {
        y = -2;
    } else if (n < 0.3) {
        y = 0;
    } else {
        const t = (n - 0.3) / 0.7;
        y = t * t * heightScale;
    }
    return y;
}

for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const z = vertices[i + 2];
    
    // Generate noise
    const y = getTerrainHeight(x, z);
    
    vertices[i + 1] = y;

    // Color based on height
    const color = new THREE.Color();
    if (y < -1) {
        color.setHex(0x2244aa); // River/Water
    } else if (y < 2) {
        color.setHex(0x228822); // Grass
    } else if (y < 15) {
        color.setHex(0x44aa44); // High Grass
    } else {
        color.setHex(0x888888); // Rock/Mountain
    }
    
    colors.push(color.r, color.g, color.b);
}

geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
geometry.computeVertexNormals();

const material = new THREE.MeshStandardMaterial({ 
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.1
});

const terrain = new THREE.Mesh(geometry, material);
terrain.receiveShadow = true;
scene.add(terrain);

// Water Plane (for visual effect)
const waterGeometry = new THREE.PlaneGeometry(worldWidth, worldDepth);
waterGeometry.rotateX(-Math.PI / 2);
const waterMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x2244aa, 
    transparent: true, 
    opacity: 0.6,
    roughness: 0.1,
    metalness: 0.1
});
const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.position.y = -0.5; // Slightly below plain level
scene.add(water);

// Trees
const treeGeometry = new THREE.ConeGeometry(1, 4, 8);
const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x004400 });
const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.2, 1, 8);
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x442200 });

const trees = new THREE.Group();
scene.add(trees);

for (let i = 0; i < 800; i++) {
    const x = (rng() - 0.5) * worldWidth;
    const z = (rng() - 0.5) * worldDepth;
    
    const n = noise2D(x * scale, z * scale);
    let y = 0;

    if (n < riverThreshold) {
        y = -2;
    } else if (n < 0.3) {
        y = 0;
    } else {
        const t = (n - 0.3) / 0.7;
        y = t * t * heightScale;
    }
    
    // Only place trees on land and not too high
    if (y >= 0 && y < 10) {
        const tree = new THREE.Group();
        
        const foliage = new THREE.Mesh(treeGeometry, treeMaterial);
        foliage.position.y = 2.5;
        foliage.castShadow = true;
        // foliage.castShadow = true; // Optimization: Disable shadow casting for foliage if needed
        
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 0.5;
        trunk.castShadow = true;
        
        tree.add(foliage);
        tree.add(trunk);
        
        tree.position.set(x, y, z);
        trees.add(tree);
    }
}

// Shacks
const shackGroup = new THREE.Group();
scene.add(shackGroup);

const wallGeometry = new THREE.BoxGeometry(4, 3, 4);
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); // SaddleBrown
const roofGeometry = new THREE.ConeGeometry(3.5, 2, 4);
const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x5C4033 }); // Dark brown
const doorGeometry = new THREE.BoxGeometry(1, 2, 0.1);
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });

let shacksPlaced = 0;
let attempts = 0;
while (shacksPlaced < 4 && attempts < 100) {
    attempts++;
    const x = (rng() - 0.5) * worldWidth;
    const z = (rng() - 0.5) * worldDepth;

    const n = noise2D(x * scale, z * scale);
    let y = 0;

    if (n < riverThreshold) {
        y = -2;
    } else if (n < 0.3) {
        y = 0;
    } else {
        const t = (n - 0.3) / 0.7;
        y = t * t * heightScale;
    }

    // Place on land, preferably flat-ish (y=0 is flat plain)
    if (y >= 0 && y < 5) {
        const shack = new THREE.Group();

        const walls = new THREE.Mesh(wallGeometry, wallMaterial);
        walls.position.y = 1.5; // Half height
        walls.castShadow = true;
        walls.receiveShadow = true;

        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = 3 + 1; // Wall height + half roof height
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;

        const door = new THREE.Mesh(doorGeometry, doorMaterial);
        door.position.set(0, 1, 2); // Front center

        shack.add(walls);
        shack.add(roof);
        shack.add(door);

        shack.position.set(x, y, z);
        shack.rotation.y = rng() * Math.PI * 2;
        
        shackGroup.add(shack);
        shacksPlaced++;
    }
}

// Zombies
const zombies = [];
const zombieGeometry = new THREE.BoxGeometry(0.8, 1.8, 0.8);
const zombieMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 }); // Gray

class Zombie {
    constructor(position) {
        this.mesh = new THREE.Group();
        this.mesh.position.copy(position);
        scene.add(this.mesh);

        this.health = 200; // Zombie Health

        // Body
        const body = new THREE.Mesh(zombieGeometry, zombieMaterial.clone()); // Clone material for individual flashing
        body.castShadow = true;
        body.receiveShadow = true;
        this.mesh.add(body);

        // Arms
        const armGeometry = new THREE.BoxGeometry(0.2, 0.8, 0.2);
        const armMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });

        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.5, 0.2, 0.5);
        leftArm.rotation.x = -Math.PI / 2;
        leftArm.castShadow = true;
        this.mesh.add(leftArm);

        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.5, 0.2, 0.5);
        rightArm.rotation.x = -Math.PI / 2;
        rightArm.castShadow = true;
        this.mesh.add(rightArm);

        this.speed = 2.0;
        this.state = 'wander'; // wander, chase
        this.wanderTarget = null;
        this.lastAttackTime = 0;
    }

    takeDamage(amount) {
        this.health -= amount;
        
        // Flash Red
        const body = this.mesh.children[0];
        const originalColor = body.material.color.getHex();
        body.material.color.setHex(0xff0000);
        setTimeout(() => {
            if (this.health > 0) body.material.color.setHex(originalColor);
        }, 100);

        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        scene.remove(this.mesh);
        const index = zombies.indexOf(this);
        if (index > -1) {
            zombies.splice(index, 1);
        }
        spawnZombie(); // Respawn a new zombie
    }

    update(delta, playerPos) {
        const distToPlayer = this.mesh.position.distanceTo(playerPos);

        // State Logic
        if (distToPlayer < 15) {
            this.state = 'chase';
        } else if (this.state === 'chase' && distToPlayer > 25) {
            this.state = 'wander';
            this.wanderTarget = null;
        }

        // Movement Logic
        const direction = new THREE.Vector3();

        if (this.state === 'chase') {
            if (distToPlayer > 2.0) { // Increased range to account for height difference
                direction.subVectors(playerPos, this.mesh.position).normalize();
                direction.y = 0; // Stay on ground
                this.mesh.position.addScaledVector(direction, this.speed * 1.5 * delta);
                this.mesh.lookAt(playerPos.x, this.mesh.position.y, playerPos.z);
            } else {
                // Attack
                const now = performance.now();
                if (now - this.lastAttackTime > 1000) {
                    damagePlayer(10);
                    this.lastAttackTime = now;
                }
            }
        } else {
            // Wander
            if (!this.wanderTarget || this.mesh.position.distanceTo(this.wanderTarget) < 1) {
                this.wanderTarget = new THREE.Vector3(
                    this.mesh.position.x + (Math.random() - 0.5) * 20,
                    0,
                    this.mesh.position.z + (Math.random() - 0.5) * 20
                );
            }
            
            direction.subVectors(this.wanderTarget, this.mesh.position).normalize();
            direction.y = 0;
            this.mesh.position.addScaledVector(direction, this.speed * delta);
            this.mesh.lookAt(this.wanderTarget.x, this.mesh.position.y, this.wanderTarget.z);
        }

        // Boundary Clamping
        const halfWidth = worldWidth / 2 - 1;
        const halfDepth = worldDepth / 2 - 1;
        
        if (this.mesh.position.x < -halfWidth) this.mesh.position.x = -halfWidth;
        if (this.mesh.position.x > halfWidth) this.mesh.position.x = halfWidth;
        if (this.mesh.position.z < -halfDepth) this.mesh.position.z = -halfDepth;
        if (this.mesh.position.z > halfDepth) this.mesh.position.z = halfDepth;

        // Ground Clamping
        const groundHeight = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
        this.mesh.position.y = groundHeight + 0.9;
    }
}

// Spawn Zombies
function spawnZombie() {
    let spawned = false;
    while (!spawned) {
        const x = (rng() - 0.5) * worldWidth;
        const z = (rng() - 0.5) * worldDepth;
        
        // Find ground height
        const y = getTerrainHeight(x, z);
        
        if (y > -1) { // Don't spawn in deep water
            zombies.push(new Zombie(new THREE.Vector3(x, y + 0.9, z)));
            spawned = true;
        }
    }
}

for (let i = 0; i < 20; i++) {
    spawnZombie();
}

// Player Stats
let playerHealth = 100;
const healthBar = document.getElementById('health-bar');
const gameOverScreen = document.getElementById('game-over-screen');
const respawnBtn = document.getElementById('respawn-btn');
const endGameBtn = document.getElementById('end-game-btn');

function damagePlayer(amount) {
    playDamageSound();
    playerHealth -= amount;
    if (playerHealth < 0) playerHealth = 0;
    healthBar.style.width = playerHealth + '%';
    
    // Flash red
    document.body.style.backgroundColor = 'red';
    setTimeout(() => {
        document.body.style.backgroundColor = '';
    }, 100);

    if (playerHealth === 0) {
        showGameOver();
        if (socket) {
            socket.emit('playerDied');
        }
    }
}

function showGameOver() {
    controls.unlock();
    const gameOverTitle = gameOverScreen.querySelector('h1');
    gameOverTitle.innerText = `Game Over, ${gamerName}!`;
    gameOverScreen.classList.remove('hidden');
}

respawnBtn.addEventListener('click', () => {
    respawn();
});

endGameBtn.addEventListener('click', () => {
    endGame();
});

function resetPlayerState() {
    playerHealth = 100;
    healthBar.style.width = '100%';
    
    // Random Respawn Position
    const x = (Math.random() - 0.5) * worldWidth;
    const z = (Math.random() - 0.5) * worldDepth;
    const y = getTerrainHeight(x, z) + 50; // Drop from sky
    
    camera.position.set(x, y, z);
    velocity.set(0, 0, 0);
}

function respawn() {
    resetPlayerState();
    gameOverScreen.classList.add('hidden');
    controls.lock();
    if (socket) {
        socket.emit('playerRespawn');
    }
}

function endGame() {
    resetPlayerState();
    gameOverScreen.classList.add('hidden');
    
    // Reset Game State
    isGameStarted = false;
    
    // Show Start Screen Elements
    gamerNameInput.style.display = 'inline-block';
    startBtn.style.display = 'inline-block';
    
    const resumeMsg = document.getElementById('resume-msg');
    if (resumeMsg) {
        resumeMsg.style.display = 'none';
    }
    
    // Instructions are already visible because controls are unlocked
}

// Player Body (Visible when looking down)
const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.3, 1.4, 16);
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x0000ff });
const playerBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
playerBody.castShadow = true;
playerBody.receiveShadow = true;
scene.add(playerBody);

// Minimap Marker (Only visible on minimap)
const markerGeometry = new THREE.ConeGeometry(2, 6, 8);
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const playerMarker = new THREE.Mesh(markerGeometry, markerMaterial);
playerMarker.position.y = 10; // Float above player
playerMarker.layers.set(1); // Layer 1 (Minimap only)
scene.add(playerMarker);

// Weapon (Attached to camera)
const weaponGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.5);
const weaponMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
const weapon = new THREE.Mesh(weaponGeometry, weaponMaterial);
weapon.position.set(0.2, -0.2, -0.3); // Offset from camera
weapon.castShadow = true;
camera.add(weapon);

// Muzzle Flash
const flashGeometry = new THREE.SphereGeometry(0.05, 8, 8);
const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
const flash = new THREE.Mesh(flashGeometry, flashMaterial);
flash.position.set(0, 0, -0.3); // Tip of the weapon
flash.visible = false;
weapon.add(flash);

const flashLight = new THREE.PointLight(0xffff00, 0, 5);
flashLight.position.set(0, 0, -0.3);
weapon.add(flashLight);

scene.add(camera); // Ensure camera children are rendered

// Audio Setup
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playShootSound() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(200, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.2);
}

function playDamageSound() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(100, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);
}

// Shooting Logic
document.addEventListener('mousedown', (event) => {
    if (controls.isLocked && event.button === 0) { // Left click
        shoot();
    }
});

function shoot() {
    playShootSound();

    // Flash Animation
    flash.visible = true;
    flashLight.intensity = 2;
    setTimeout(() => {
        flash.visible = false;
        flashLight.intensity = 0;
    }, 50);

    // Play Shoot Sound
    playShootSound();

    // Raycast
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    // Get all zombie meshes
    const zombieMeshes = zombies.map(z => z.mesh);
    // Get all player meshes
    const playerMeshes = Object.values(otherPlayers).map(p => p.mesh);
    
    const allTargets = [...zombieMeshes, ...playerMeshes];
    const intersects = raycaster.intersectObjects(allTargets, true); // recursive for parts

    if (intersects.length > 0) {
        // Find what was hit
        let hitObject = intersects[0].object;
        // Traverse up to find the root group
        while(hitObject.parent && hitObject.parent !== scene) {
            hitObject = hitObject.parent;
        }
        
        // Check if it's a zombie
        const hitZombie = zombies.find(z => z.mesh === hitObject);
        if (hitZombie) {
            hitZombie.takeDamage(25); // 4 shots to kill
        } else {
            // Check if it's a player
            const hitPlayerId = Object.keys(otherPlayers).find(id => otherPlayers[id].mesh === hitObject);
            if (hitPlayerId && socket) {
                socket.emit('shootPlayer', hitPlayerId);
            }
        }
    }
}

// Movement Logic
const moveState = {
    forward: false,
    backward: false,
    left: false,
    right: false
};

let canJump = false;

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const speed = 10.0;

document.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'KeyW': moveState.forward = true; break;
        case 'KeyA': moveState.left = true; break;
        case 'KeyS': moveState.backward = true; break;
        case 'KeyD': moveState.right = true; break;
        case 'Space':
            if (canJump) {
                velocity.y = 15;
                canJump = false;
            }
            break;
    }
});

document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW': moveState.forward = false; break;
        case 'KeyA': moveState.left = false; break;
        case 'KeyS': moveState.backward = false; break;
        case 'KeyD': moveState.right = false; break;
    }
});

function checkCollisions(position) {
    const playerRadius = 0.5;
    const boundaryMargin = 2.0;

    // Check Boundaries
    const halfWidth = worldWidth / 2 - boundaryMargin;
    const halfDepth = worldDepth / 2 - boundaryMargin;

    if (position.x < -halfWidth || position.x > halfWidth || 
        position.z < -halfDepth || position.z > halfDepth) {
        return true;
    }

    // Check Trees
    for (const tree of trees.children) {
        const dx = position.x - tree.position.x;
        const dz = position.z - tree.position.z;
        const distance = Math.sqrt(dx*dx + dz*dz);
        
        if (distance < 0.5 + playerRadius) {
            return true;
        }
    }

    // Check Shacks
    for (const shack of shackGroup.children) {
        const dx = position.x - shack.position.x;
        const dz = position.z - shack.position.z;
        const distance = Math.sqrt(dx*dx + dz*dz);

        if (distance < 2.5 + playerRadius) {
            return true;
        }
    }
    
    return false;
}

// Animation Loop
let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    let delta = (time - prevTime) / 1000;
    
    // Cap delta to prevent physics explosions on lag spikes
    if (delta > 0.1) delta = 0.1;

    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveState.forward) - Number(moveState.backward);
        direction.x = Number(moveState.right) - Number(moveState.left);
        direction.normalize();

        if (moveState.forward || moveState.backward) velocity.z -= direction.z * 100.0 * delta;
        if (moveState.left || moveState.right) velocity.x -= direction.x * 100.0 * delta;

        // Move and Check Collisions (X Axis)
        const oldPos = camera.position.clone();
        controls.moveRight(-velocity.x * delta);
        if (checkCollisions(camera.position)) {
            camera.position.x = oldPos.x;
            camera.position.z = oldPos.z;
            velocity.x = 0;
        }

        // Move and Check Collisions (Z Axis)
        const oldPos2 = camera.position.clone();
        controls.moveForward(-velocity.z * delta);
        if (checkCollisions(camera.position)) {
            camera.position.x = oldPos2.x;
            camera.position.z = oldPos2.z;
            velocity.z = 0;
        }

        // Ground Following
        const groundHeight = getTerrainHeight(camera.position.x, camera.position.z);

        // Physics
        velocity.y -= 30.0 * delta; // Gravity
        camera.position.y += velocity.y * delta;

        // Ground Collision
        if (camera.position.y < groundHeight + 2) {
            velocity.y = 0;
            camera.position.y = groundHeight + 2;
            canJump = true;
        }

        // Update Body Position & Rotation
        playerBody.position.x = camera.position.x;
        playerBody.position.z = camera.position.z;
        playerBody.position.y = camera.position.y - 0.9; // Offset to be below camera
        
        // Sync body rotation with camera yaw (Y-axis only)
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        const playerRotation = Math.atan2(-camDir.x, -camDir.z) + Math.PI;
        playerBody.rotation.y = playerRotation;

        // Update Marker
        playerMarker.position.x = camera.position.x;
        playerMarker.position.z = camera.position.z;
        playerMarker.position.y = camera.position.y + 5; // Keep above player
        playerMarker.rotation.y = playerRotation; // Rotate with player

        // Network Update
        if (socket && socket.connected) {
            socket.emit('playerMovement', {
                x: camera.position.x,
                y: camera.position.y - 0.9, // Send body position
                z: camera.position.z,
                rotation: playerRotation
            });
        }

        // Update Zombies
        for (const zombie of zombies) {
            zombie.update(delta, camera.position);
        }
    }

    prevTime = time;
    
    // Main Render
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);

    // Minimap Render
    const mapPixelSize = 150;
    const mapPadding = 20;
    
    // Calculate position (Top Right) - Scissor uses (x, y) from bottom-left
    const mapX = window.innerWidth - mapPixelSize - mapPadding;
    const mapY = window.innerHeight - mapPixelSize - mapPadding;

    renderer.setViewport(mapX, mapY, mapPixelSize, mapPixelSize);
    renderer.setScissor(mapX, mapY, mapPixelSize, mapPixelSize);
    renderer.setScissorTest(true);
    
    // Update map camera to follow player
    mapCamera.position.x = camera.position.x;
    mapCamera.position.z = camera.position.z;
    mapCamera.position.y = camera.position.y + 100; // Follow height to avoid clipping
    mapCamera.lookAt(camera.position.x, camera.position.y, camera.position.z);
    
    // Disable fog for minimap so we can see the ground clearly
    const oldFog = scene.fog;
    scene.fog = null;

    renderer.render(scene, mapCamera);

    // Restore fog
    scene.fog = oldFog;

    renderer.setScissorTest(false);
}

animate();

// Resize Handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});