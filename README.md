# Woodland Walk

A simple Three.js exploration game with procedural terrain.

## Features
- Procedural terrain generation using Simplex Noise.
- Diverse elevation with hills and rivers.
- Trees and shacks scattered across the landscape.
- First-person character controller (WASD + Mouse + Jump).
- Zombie survival gameplay with health and damage system.
- Shooting mechanics with audio feedback.
- "Gamer Name" entry at start.
- Game Over and Respawn system.

## How to Run
Since this project uses ES modules, you need to serve it with a local web server.

### Using VS Code Live Server
1. Install the "Live Server" extension in VS Code.
2. Right-click `index.html` and select "Open with Live Server".

### Using Python
If you have Python installed:
```bash
python -m http.server
```
Then open `http://localhost:8000` in your browser.

### Using Node.js (if installed later)
```bash
npx vite
```
