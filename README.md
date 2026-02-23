# IDAST — Intelligent Dual-Axis Solar Tracker

A distributed IoT system for monitoring a dual-axis solar panel tracker. It combines ESP32 hardware, a web dashboard, and a cloud backend so you can view real-time telemetry and historical data from anywhere.

## What It Does

- **Real-time monitoring**: Live sensor data (power, battery, tilt/pan, LDR readings) streamed to the dashboard over MQTT.
- **Historical data**: Energy and battery history stored in a database and shown in charts and reports.
- **Solar Unit management**: Register and track devices by name (Solar Name); telemetry is matched to the unit you register.
- **Grid price & savings**: Enter your grid price (e.g. Batelec) and see estimated savings from solar energy.

## High-Level Architecture

```
ESP32 Transmitter (sensors, servos)
        │ ESP-NOW
        ▼
ESP32 Receiver (WiFi, MQTT client)
        │ MQTT
        ▼
   EMQX Cloud (broker)
    │         │
    │ MQTT    │ MQTT
    ▼         ▼
Dashboard   Backend (Express + MySQL)
(Vercel)    (Railway)
```

- **ESP32**: Transmitter reads sensors and drives servos; receiver gets data via ESP-NOW and publishes to MQTT.
- **Dashboard**: Next.js app on Vercel; connects to MQTT (WebSocket) for live data and to the backend REST API for history, devices, and grid price.
- **Backend**: Express.js on Railway; subscribes to MQTT, writes to MySQL (`device_registration`, `device_state`, `grid_price`), and serves REST endpoints.
- **Broker**: EMQX Cloud (or any MQTT broker); no USB or tunnel required for telemetry.

## Tech Stack

| Part        | Technology                          |
|------------|--------------------------------------|
| Frontend   | Next.js 16, React 18, mqtt.js        |
| Backend    | Node.js 18+, Express 4, mysql2       |
| Database   | MySQL 9 (e.g. Railway)               |
| Broker     | EMQX Cloud (MQTT + WebSocket)        |
| Hardware   | ESP32 (Arduino), ESP-NOW, WiFi       |

## Repository Structure

```
IDAST/
├── backend/           # Express API + MQTT ingest
│   ├── src/
│   │   ├── server.js  # HTTP server and routes
│   │   ├── db.js      # Schema and pool
│   │   ├── ingest.js  # MQTT subscriber → DB
│   │   └── ...
│   └── package.json
├── pages/             # Next.js pages (dashboard, login, etc.)
├── hooks/             # React hooks (MQTT, history, devices, grid price)
├── styles/            # Dashboard CSS
├── utils/             # Shared utilities
├── docs/              # Documentation
│   ├── ARCHITECTURE.md
│   ├── deployement/   # Vercel & Railway guides
│   ├── mqtt/          # MQTT setup
│   └── arduino/       # ESP32 firmware docs
├── package.json       # Frontend (Next.js)
└── README.md
```

## Prerequisites

- **Node.js** 18+ (for frontend and backend)
- **MySQL** (e.g. Railway) for the backend
- **EMQX Cloud** (or other MQTT broker) for real-time data
- **ESP32** hardware and Arduino/PlatformIO for firmware

## Quick Start

### Frontend (dashboard)

```bash
npm install
npm run dev
```

Set environment variables (e.g. in `.env.local`):

- `NEXT_PUBLIC_RAILWAY_API_BASE_URL` — backend API URL (e.g. `https://your-app.up.railway.app`)
- `NEXT_PUBLIC_MQTT_BROKER_URL` — WebSocket URL (e.g. `wss://your-broker.emqx.cloud:8084/mqtt`)
- `NEXT_PUBLIC_MQTT_USERNAME` / `NEXT_PUBLIC_MQTT_PASSWORD` — optional broker auth
- `NEXT_PUBLIC_LOGIN_EMAIL` / `NEXT_PUBLIC_LOGIN_PASSWORD` — for dashboard login

### Backend

```bash
cd backend
npm install
```

Configure environment (e.g. `.env`):

- MySQL: `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` (or `MYSQL_URL` / `DATABASE_URL`)
- MQTT: `MQTT_BROKER_URL` (e.g. `mqtts://your-broker.emqx.cloud:8883`), optional `MQTT_USERNAME`, `MQTT_PASSWORD`
- Optional: `INGEST_ENABLED=false` to disable MQTT ingest

Then:

```bash
npm run dev   # development with watch
# or
npm start     # production
```

The backend creates the DB schema on startup (`device_registration`, `device_state`, `grid_price`).

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, APIs, and deployment |
| [docs/deployement/FRONTEND_VERCEL.md](docs/deployement/FRONTEND_VERCEL.md) | Deploy frontend to Vercel and env vars |
| [docs/deployement/BACKEND_RAILWAY.md](docs/deployement/BACKEND_RAILWAY.md) | Deploy backend to Railway, MySQL, and MQTT |
| [docs/mqtt/MQTT_SETUP.md](docs/mqtt/MQTT_SETUP.md) | EMQX Cloud and connection setup |
| [docs/arduino/](docs/arduino/) | ESP32 transmitter, receiver, and WiFi config |

## Main Backend Endpoints

- `GET /health` — Health check
- `GET /api/latest` — Latest device state (energy, battery, timestamp)
- `GET /api/history.csv?days=60` — History CSV (from `device_state`)
- `GET /api/telemetry` — Telemetry query (date range)
- `GET /api/device`, `POST /api/device` — Current / save device name
- `GET /api/devices` — All registered devices
- `GET /api/device-stats?days=60` — Device statistics
- `GET /api/grid-price`, `POST /api/grid-price` — Grid price and estimated savings
- `GET /api/history-logs` — History logs (devices and grid prices)

## License

Private project. See repository or team for terms.
