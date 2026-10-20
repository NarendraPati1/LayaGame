# 🎮 LAYA ARENA — Shooting Game

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![PyTorch](https://img.shields.io/badge/PyTorch-CUDA%20Accelerated-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)](https://pytorch.org)
[![HTML5](https://img.shields.io/badge/HTML5-Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Zero-Dependency Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](#)

A fast-paced, cyber-tactical 1v1 top-down shooter pitting you against **Laya** — an autonomous AI agent powered by a local deep learning neural decision core running on PyTorch / CUDA.

Unlike scripted bots that read player variables to cheat, Laya operates under realistic battlefield conditions: she **only reacts to observable game states** (raycast line-of-sight, distance, cover status, and incoming fire). Break line of sight behind crates, flank around obstacles, or pin her down when her magazine runs dry!

---

## ⚡ Highlights & Features

* **🧠 Autonomous Neural Decision Core:** Laya evaluates dynamic tactical postures and combat actions using a local language/decision model (`laya` + `torch`).
* **👁️ Realistic Line of Sight (Raycasting):** Crates block both bullets and visibility. If you duck behind cover, Laya loses sight and must adapt by flanking or laying down suppressive fire.
* **⚖️ Fair-Play Observable Context:** Laya does *not* read your secret HP or remaining ammo. Her decisions are computed solely from observable battlefield context.
* **🎲 Procedural Dynamic Arenas:** Procedurally generates tactical crate clusters, barricades, and flanking lanes each match.
* **📊 Live Neural Telemetry HUD:** Real-time HUD displaying compute device (CUDA / CPU), line-of-sight acquisition, current tactical stance, confidence level, and FPS.
* **🚀 Lightweight Architecture:** Built on Python's built-in `http.server` and Vanilla JS Canvas — zero Node.js or heavy web framework overhead.

---

## 🎯 Tactical AI Architecture

Laya pairs higher-level **tactical stances** with concrete **combat actions** and temperature-based probability sampling:

```
                      ┌──────────────────────────────────────┐
                      │    Observable Game State (JSON)     │
                      │  • Distance (px & range category)    │
                      │  • Line-of-sight & cover status      │
                      │  • Laya's own ammo & HP              │
                      │  • Bullets in air & elapsed time     │
                      └──────────────────┬───────────────────┘
                                         ▼
                      ┌──────────────────────────────────────┐
                      │    Laya Neural Decision Engine       │
                      │       (CUDA / CPU Inference)         │
                      └──────────────────┬───────────────────┘
                                         ▼
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     ┌───────────────────────┐                       ┌───────────────────────┐
     │    Tactical Stances   │                       │    Combat Actions     │
     ├───────────────────────┤                       ├───────────────────────┤
     │ • aggressive_push     │                       │ • shoot               │
     │ • flank_and_outposition│                       │ • burst_fire          │
     │ • suppressive_fire    │                       │ • strafe_left / right │
     │ • defensive_reposition│                       │ • dash_to_cover       │
     └───────────────────────┘                       │ • reload              │
                                                     └───────────────────────┘
```

* **Action Masking:** Prevents contradictory or physically impossible moves (e.g. reloading with a full magazine, or rushing recklessly during defensive retreats).
* **Stickiness Control:** Restricts defensive repositioning duration to prevent endless turtling.

---

## 🕹️ Controls

| Key / Input | Action |
| :--- | :--- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Move Character |
| <kbd>Mouse</kbd> | Aim Weapon |
| <kbd>Left Click</kbd> | Fire Weapon |
| <kbd>R</kbd> | Reload Magazine (30 Rounds) |
| Cover Crates | Break enemy line of sight & block ballistic fire |

---

## 📂 Project Structure

```
├── app.py                      # Main entry point (launches server & opens browser)
├── backend/
│   ├── __init__.py
│   ├── engine.py               # Neural inference engine, action masking, state builder
│   └── server.py               # HTTP server & API endpoint (/api/ai_decision)
├── frontend/
│   ├── index.html              # Cyber-styled HUD, arena canvas & telemetry overlay
│   └── game.js                 # 2D game loop, physics, raycasting, particles, audio
├── model/
│   └── laya-english/           # Neural model directory (tokenizer, configs, safetensors)
├── .gitignore
└── README.md
```

---

## 🛠️ Getting Started

### 1. Prerequisites
* **Python 3.10+**
* An NVIDIA GPU with CUDA support (recommended for lowest latency) or a multi-core CPU.

### 2. Clone the Repository
```bash
git clone https://github.com/NarendraPati1/LayaGame.git
cd LayaGame
```

### 3. Set Up Virtual Environment & Dependencies
```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install torch transformers safetensors tokenizers laya
```

> **Note on Model Weights:**  
> The neural core expects the model files inside `model/laya-english/` (specifically `model.safetensors`). Ensure the weights are placed in this directory before launching.

---

## 🚀 Running the Game

Simply run:

```bash
python app.py
```

* The backend initializes the neural engine, auto-detects CUDA / CPU hardware, and starts the server on port `8080`.
* Your default web browser will automatically open to `http://localhost:8080`.

To run on a custom port:
```bash
python app.py 9000
```

---

## 📊 Live In-Game Telemetry

The telemetry panel at the bottom of the arena streams real-time AI states:
* **AI ENGINE:** Active device (e.g., `CUDA (RTX 3050)` or `CPU`).
* **VISION:** Line-of-sight status (`TARGET IN SIGHT` vs. `ACQUIRING...`).
* **LAYA STANCE:** Current tactical posture.
* **AI DECISION:** Chosen action (e.g., `burst_fire`, `flank_and_outposition`).
* **CONFIDENCE:** Neural model probability score.
* **FPS:** Real-time client rendering performance.

---
