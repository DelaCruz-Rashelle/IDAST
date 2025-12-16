# IDAST Solar Tracker - Architecture Design

This document describes the overall architecture, system design, and component interactions of the IDAST (Intelligent Dual-Axis Solar Tracker) system.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Layers](#architecture-layers)
3. [Component Diagram](#component-diagram)
4. [Data Flow Architecture](#data-flow-architecture)
5. [Deployment Architecture](#deployment-architecture)
6. [Communication Patterns](#communication-patterns)
7. [Technology Stack](#technology-stack)
8. [Data Storage Architecture](#data-storage-architecture)
9. [Security Architecture](#security-architecture)
10. [Scalability & Performance](#scalability--performance)

---

## System Overview

The IDAST system is a **distributed IoT application** for monitoring and controlling a dual-axis solar panel tracking system. It consists of:

- **ESP32 Hardware**: Solar tracker device with sensors, servos, and web server
- **Frontend Dashboard**: Next.js web application for real-time monitoring and control
- **Backend API**: Express.js service for telemetry storage and querying
- **Database**: MySQL database for persistent telemetry storage
- **Tunneling**: Cloudflare tunnel for remote ESP32 access

### Key Features

- **Real-time Telemetry**: Live sensor data updates every 350ms
- **Historical Data**: Energy history tracking and reporting
- **Remote Control**: Manual servo control and configuration
- **Multiple Connection Modes**: AP mode, Proxy mode, Tunnel mode
- **Automatic Data Ingestion**: Backend service fetches and stores telemetry
- **Cross-Platform Access**: Web-based dashboard accessible from any device

---

## Architecture Layers

The system follows a **3-tier architecture**:

```
┌─────────────────────────────────────────────────────────┐
│                    Presentation Layer                    │
│  Next.js Dashboard (Vercel) - React Components          │
└─────────────────────────────────────────────────────────┘
                          ↕ HTTP/HTTPS
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│  Express.js API (Railway) - Business Logic              │
│  Next.js API Routes - Proxy Layer                       │
└─────────────────────────────────────────────────────────┘
                          ↕ SQL
┌─────────────────────────────────────────────────────────┐
│                      Data Layer                          │
│  MySQL Database (Railway) - Persistent Storage           │
│  ESP32 LittleFS - Local History Storage                  │
└─────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**Presentation Layer:**
- User interface rendering
- Real-time data visualization
- User input handling
- Client-side state management

**Application Layer:**
- API endpoint handling
- Business logic processing
- Data transformation
- CORS handling
- Request proxying

**Data Layer:**
- Persistent data storage
- Data querying and aggregation
- Data validation
- Transaction management

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Browser                                 │
│                    (Chrome, Firefox, Safari)                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                    Frontend Dashboard                                │
│                    (Next.js on Vercel)                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  pages/dashboard.js - Main React Component                    │  │
│  │  - Real-time telemetry display                               │  │
│  │  - Historical charts                                         │  │
│  │  - Control interface                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  pages/api/tunnel-proxy.js - CORS Proxy                      │  │
│  │  pages/api/proxy.js - Direct Proxy                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────┬───────────────────────────────┬───────────────────────┘
             │                               │
             │ HTTPS                         │ HTTPS
             │                               │
    ┌────────▼────────┐            ┌─────────▼──────────┐
    │ Cloudflare      │            │ Backend API         │
    │ Tunnel          │            │ (Express.js)        │
    │                 │            │ (Railway)           │
    └────────┬────────┘            └─────────┬──────────┘
             │                               │
             │ HTTP                          │ SQL
             │                               │
    ┌────────▼────────┐            ┌─────────▼──────────┐
    │ ESP32 Device    │            │ MySQL Database      │
    │                 │            │ (Railway)           │
    │ - Web Server    │            │                     │
    │ - Sensors       │            │ - telemetry table   │
    │ - Servos        │            │ - Auto-schema       │
    │ - LittleFS      │            │                     │
    └─────────────────┘            └─────────────────────┘
```

### Component Descriptions

**1. Frontend Dashboard (Next.js/Vercel)**
- **Technology**: Next.js 14.2+, React 18.3
- **Deployment**: Vercel (serverless)
- **Responsibilities**:
  - Render user interface
  - Fetch and display telemetry data
  - Handle user interactions
  - Manage connection modes
  - Client-side data processing

**2. Backend API (Express.js/Railway)**
- **Technology**: Node.js 18+, Express.js 4.x
- **Deployment**: Railway (containerized)
- **Responsibilities**:
  - Provide REST API endpoints
  - Store telemetry in database
  - Query historical data
  - Automatic schema initialization
  - Telemetry ingestion service

**3. MySQL Database (Railway)**
- **Technology**: MySQL 9.x
- **Deployment**: Railway (managed service)
- **Responsibilities**:
  - Store telemetry records
  - Provide query interface
  - Data persistence
  - Automatic backups (Railway managed)

**4. ESP32 Device**
- **Technology**: ESP32 microcontroller, Arduino framework
- **Deployment**: Physical hardware
- **Responsibilities**:
  - Read sensor data
  - Control servo motors
  - Host web server
  - Store local history (CSV)
  - ESP-NOW communication (transmitter/receiver)

**5. Cloudflare Tunnel**
- **Technology**: Cloudflare Tunnel (cloudflared)
- **Deployment**: Cloudflare infrastructure
- **Responsibilities**:
  - Expose ESP32 to internet
  - Provide secure remote access
  - Handle SSL/TLS termination

---

## Data Flow Architecture

### Real-Time Telemetry Flow

```
ESP32 Sensors
    │
    ├─ Read sensors (LDR, battery, power, etc.)
    │
    ├─ Package into JSON
    │
    ├─ Store in memory (latestTelemetry)
    │
    └─ Serve via /data endpoint
         │
         ├─→ Frontend Dashboard (every 350ms)
         │   └─ Display in UI
         │
         └─→ Backend Ingestion Service (every 10s)
             └─ Store in MySQL database
```

### Historical Data Flow

```
ESP32 History Logging
    │
    ├─ Log data point every 10 minutes
    │
    ├─ Append to /history.csv (LittleFS)
    │
    └─ Serve via /api/history endpoint
         │
         └─→ Frontend Dashboard (every 30s)
             └─ Parse CSV and display charts
```

### Control Command Flow

```
Frontend Dashboard
    │
    ├─ User adjusts slider/input
    │
    ├─ Send POST /control
    │
    └─→ ESP32 Device
         │
         ├─ Update servo positions
         ├─ Update settings (grid price, device name)
         └─ Save to persistent storage
```

### Backend Query Flow

```
Frontend Dashboard
    │
    ├─ Request historical data
    │
    └─→ Backend API
         │
         ├─ Query MySQL database
         │
         ├─ Aggregate/transform data
         │
         └─ Return JSON/CSV
              │
              └─→ Frontend Dashboard
                   └─ Display in charts/reports
```

---

## Deployment Architecture

### Frontend Deployment (Vercel)

```
GitHub Repository
    │
    ├─ Push to main branch
    │
    └─→ Vercel Build Pipeline
         │
         ├─ Install dependencies (npm install)
         ├─ Build Next.js app (next build)
         ├─ Deploy to Vercel Edge Network
         └─ Environment Variables:
            - NEXT_PUBLIC_API_BASE_URL (Cloudflare tunnel URL)
            - NEXT_PUBLIC_RAILWAY_API_BASE_URL (Backend API URL)
```

**Deployment Characteristics:**
- **Type**: Serverless/Edge Functions
- **Regions**: Global CDN
- **Scaling**: Automatic
- **SSL**: Automatic (Vercel managed)

### Backend Deployment (Railway)

```
GitHub Repository (backend/)
    │
    ├─ Push to main branch
    │
    └─→ Railway Build Pipeline
         │
         ├─ Detect Node.js project
         ├─ Install dependencies (npm install)
         ├─ Build (if needed)
         ├─ Start service (npm start)
         └─ Environment Variables:
            - MYSQL_HOST, MYSQL_USER, etc. (from MySQL service)
            - TUNNEL_BASE_URL (for ingestion)
            - INGEST_ENABLED, INGEST_INTERVAL_MS
```

**Deployment Characteristics:**
- **Type**: Containerized service
- **Platform**: Railway infrastructure
- **Scaling**: Manual (can scale horizontally)
- **SSL**: Railway managed

### Database Deployment (Railway)

```
Railway MySQL Service
    │
    ├─ Provision MySQL 9.x container
    ├─ Create database
    ├─ Generate credentials
    └─ Expose connection variables
```

**Deployment Characteristics:**
- **Type**: Managed MySQL service
- **Version**: MySQL 9.4.0
- **Backups**: Railway managed (automatic)
- **Scaling**: Vertical (resource allocation)

### ESP32 Deployment

```
Arduino IDE / PlatformIO
    │
    ├─ Compile firmware
    ├─ Upload to ESP32
    └─ Configure:
       - WiFi credentials
       - Transmitter MAC address
       - Cloudflare tunnel (if used)
```

**Deployment Characteristics:**
- **Type**: Embedded firmware
- **Storage**: Flash memory
- **Network**: WiFi (Station or AP mode)
- **Update**: Manual re-flash

---

## Communication Patterns

### Connection Modes

The system supports **three connection modes** for accessing the ESP32:

#### 1. Access Point (AP) Mode

```
Frontend Dashboard
    │
    └─ Direct HTTP connection
         │
         └─→ ESP32 Access Point (192.168.4.1)
              │
              └─ Direct WiFi connection
```

**Use Case**: Local setup, initial configuration, offline operation

**Characteristics**:
- Direct connection (no internet required)
- ESP32 creates its own WiFi network
- IP: `192.168.4.1`
- No CORS issues (same origin)

#### 2. Proxy Mode

```
Frontend Dashboard (Vercel)
    │
    └─→ Next.js API Route (/api/proxy)
         │
         └─→ ESP32 Device (via public IP)
              │
              └─ Internet connection
```

**Use Case**: ESP32 has public IP or port forwarding configured

**Characteristics**:
- Requires ESP32 to be internet-accessible
- Uses Next.js API route as proxy
- Avoids CORS issues
- Requires ESP32 IP configuration

#### 3. Tunnel Mode (Cloudflare)

```
Frontend Dashboard (Vercel)
    │
    └─→ Next.js API Route (/api/tunnel-proxy)
         │
         └─→ Cloudflare Tunnel
              │
              └─→ ESP32 Device (local network)
                   │
                   └─ cloudflared client running
```

**Use Case**: Remote access without public IP, behind NAT/firewall

**Characteristics**:
- Requires Cloudflare tunnel setup
- ESP32 can be on private network
- Secure (Cloudflare SSL/TLS)
- Requires tunnel URL configuration

### API Communication Patterns

#### RESTful API Design

**Backend API (Railway):**
- `GET /health` - Health check
- `GET /api/latest` - Latest telemetry record
- `GET /api/history.csv` - Historical data (CSV)
- `GET /api/telemetry` - Query telemetry records

**ESP32 API:**
- `GET /data` - Real-time telemetry (JSON)
- `GET /api/history` - Historical data (CSV)
- `POST /control` - Control commands (form-urlencoded)

#### Request/Response Patterns

**Real-Time Data:**
- **Frequency**: 350ms (frontend polling)
- **Format**: JSON
- **Size**: ~1-2 KB per request
- **Caching**: None (always fresh)

**Historical Data:**
- **Frequency**: 30s (frontend polling)
- **Format**: CSV
- **Size**: Variable (depends on history length)
- **Caching**: Client-side (React state)

**Control Commands:**
- **Frequency**: On-demand (user interaction)
- **Format**: form-urlencoded
- **Size**: <1 KB
- **Debouncing**: 2.5s for grid price updates

---

## Technology Stack

### Frontend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Framework | Next.js | 14.2.35 | React framework with SSR |
| UI Library | React | 18.3.1 | Component library |
| Deployment | Vercel | Latest | Serverless hosting |
| Charts | Client-side JS | - | Data visualization |

### Backend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Node.js | 18+ | JavaScript runtime |
| Framework | Express.js | 4.19.2 | Web server framework |
| Database Driver | mysql2 | 3.11.5 | MySQL client |
| Deployment | Railway | Latest | Container hosting |

### Database

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Database | MySQL | 9.4.0 | Relational database |
| Deployment | Railway | Latest | Managed MySQL service |

### Hardware/Embedded

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Microcontroller | ESP32 | - | Main controller |
| Framework | Arduino | - | Development framework |
| Storage | LittleFS | - | File system |
| Communication | ESP-NOW | - | Device-to-device |
| Communication | WiFi | 802.11 | Network connectivity |

### Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Tunnel | Cloudflare Tunnel | Remote ESP32 access |
| CDN | Vercel Edge Network | Global content delivery |
| SSL/TLS | Automatic (Vercel/Railway) | Secure connections |

---

## Data Storage Architecture

### Database Schema (MySQL)

**Table: `telemetry`**

```sql
CREATE TABLE telemetry (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ts TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
  
  -- Device Info
  device_name VARCHAR(64),
  
  -- Sensor Data
  top INT, `left` INT, `right` INT, avg INT,
  horizontal_error INT, vertical_error INT,
  
  -- Tracking Data
  tilt_angle INT, pan_angle INT, pan_target INT,
  manual TINYINT(1), steady TINYINT(1),
  
  -- Power Metrics
  power_w DECIMAL(10,2), power_actual_w DECIMAL(10,2),
  temp_c DECIMAL(10,1),
  
  -- Battery
  battery_pct DECIMAL(5,1), battery_v DECIMAL(6,2),
  efficiency DECIMAL(6,1),
  
  -- Energy
  energy_wh DECIMAL(12,3), energy_kwh DECIMAL(12,6),
  
  -- Environmental Impact
  co2_kg DECIMAL(12,4), trees DECIMAL(12,4),
  phones DECIMAL(12,3), phone_minutes DECIMAL(12,0),
  pesos DECIMAL(12,2), grid_price DECIMAL(12,2),
  
  -- Raw Data
  raw_json JSON,
  
  INDEX idx_ts (ts)
);
```

**Key Design Decisions:**
- **Timestamp Precision**: `TIMESTAMP(3)` for millisecond precision
- **Indexing**: `idx_ts` on timestamp for fast time-based queries
- **JSON Storage**: `raw_json` column stores complete telemetry packet
- **Nullable Fields**: Most fields nullable to handle missing data

### Local Storage (ESP32)

**File: `/history.csv`**

```
timestamp,energy_wh,battery_pct,device_name,session_min
1702761600,1250.5,87.5,ESP32-Solar,120
1702848000,1320.2,89.1,ESP32-Solar,135
...
```

**Characteristics:**
- **Format**: CSV (comma-separated values)
- **Storage**: LittleFS filesystem
- **Update Frequency**: Every 10 minutes
- **Retention**: Limited by flash memory (~1-2 MB)

### Data Lifecycle

**Real-Time Data:**
1. Generated by ESP32 sensors
2. Stored in memory (latestTelemetry)
3. Served via `/data` endpoint
4. Displayed in frontend (not persisted)
5. Optionally ingested to MySQL (backend service)

**Historical Data:**
1. Logged periodically (every 10 min) by ESP32
2. Stored in `/history.csv` (LittleFS)
3. Served via `/api/history` endpoint
4. Displayed in frontend charts
5. Optionally synced to MySQL (backend service)

**Database Data:**
1. Ingested by backend service (every 10s)
2. Stored in MySQL `telemetry` table
3. Queryable via backend API endpoints
4. Used for advanced analytics and reporting

---

## Security Architecture

### Frontend Security

**CORS Handling:**
- Backend API allows all origins (`Access-Control-Allow-Origin: *`)
- Next.js API routes handle CORS for tunnel/proxy requests
- No authentication required (public dashboard)

**Environment Variables:**
- Sensitive values stored in Vercel environment variables
- Not exposed to client-side code (NEXT_PUBLIC_* prefix for public vars)

### Backend Security

**Database Security:**
- Credentials stored in Railway environment variables
- Connection pooling with connection limits
- SQL injection prevention via parameterized queries

**API Security:**
- CORS enabled for cross-origin requests
- Input validation on query parameters
- Rate limiting via Railway platform (if configured)

### ESP32 Security

**Network Security:**
- WiFi password protection (WPA2)
- Access Point password protection
- HTTPS via Cloudflare tunnel (when used)

**Data Security:**
- No sensitive data stored on device
- Settings stored in Preferences (encrypted flash)

### Infrastructure Security

**Vercel:**
- Automatic SSL/TLS certificates
- DDoS protection
- Global CDN with edge security

**Railway:**
- Container isolation
- Network isolation between services
- Automatic SSL/TLS termination

**Cloudflare Tunnel:**
- End-to-end encryption
- No open ports required
- DDoS protection

---

## Scalability & Performance

### Frontend Scalability

**Current Architecture:**
- Serverless functions (Vercel)
- Automatic scaling
- Global CDN distribution
- Edge caching

**Performance Optimizations:**
- Client-side data processing
- React state management
- Debounced user inputs
- Efficient polling intervals

**Limitations:**
- Client-side polling (350ms) creates high request volume
- No request batching
- No WebSocket for real-time updates

**Future Improvements:**
- WebSocket support for real-time updates
- Server-Sent Events (SSE) for telemetry streaming
- Request batching/aggregation
- Client-side caching strategies

### Backend Scalability

**Current Architecture:**
- Single container instance
- Connection pooling (10 connections)
- MySQL query optimization

**Performance Characteristics:**
- Ingestion rate: ~6 requests/minute per ESP32
- Query performance: Indexed timestamp queries
- Storage: ~1 KB per telemetry record

**Limitations:**
- Single instance (no horizontal scaling)
- Synchronous ingestion (one ESP32 at a time)
- No caching layer

**Future Improvements:**
- Horizontal scaling (multiple backend instances)
- Redis caching layer
- Message queue for ingestion (RabbitMQ/Kafka)
- Database read replicas
- Connection pool tuning

### Database Scalability

**Current Architecture:**
- Single MySQL instance
- Indexed queries
- Automatic schema initialization

**Performance Characteristics:**
- Write rate: ~6 inserts/minute
- Read rate: Variable (depends on frontend usage)
- Storage: Grows linearly with time

**Limitations:**
- Single instance (no replication)
- No partitioning
- Limited by Railway resource allocation

**Future Improvements:**
- Database partitioning by date
- Read replicas for query distribution
- Archival strategy for old data
- Connection pool optimization

### ESP32 Scalability

**Current Architecture:**
- Single device per instance
- Local storage (LittleFS)
- Direct HTTP server

**Limitations:**
- Single-threaded operation
- Limited flash memory
- No device clustering

**Future Improvements:**
- Multiple ESP32 devices per backend
- Device registration/management
- OTA (Over-The-Air) updates
- Device health monitoring

---

## System Integration Points

### Integration Flow

```
┌─────────────┐
│   ESP32     │──ESP-NOW──→│ Transmitter │
│ (Receiver)  │            │   ESP32     │
└──────┬──────┘            └─────────────┘
       │
       │ WiFi
       │
┌──────▼──────┐
│ Cloudflare │
│   Tunnel   │
└──────┬──────┘
       │
       │ HTTPS
       │
┌──────▼──────────────────┐
│  Frontend Dashboard     │
│  (Next.js/Vercel)        │
└──────┬───────────────────┘
       │
       │ HTTPS
       │
┌──────▼──────┐
│ Backend API │
│ (Railway)   │
└──────┬──────┘
       │
       │ SQL
       │
┌──────▼──────┐
│   MySQL     │
│ (Railway)   │
└─────────────┘
```

### Key Integration Points

1. **ESP32 ↔ Frontend**: Direct HTTP/HTTPS communication
2. **ESP32 ↔ Backend**: HTTP via Cloudflare tunnel (ingestion)
3. **Frontend ↔ Backend**: REST API calls
4. **Backend ↔ Database**: SQL queries via mysql2
5. **ESP32 ↔ Transmitter**: ESP-NOW protocol (device-to-device)

---

## Error Handling & Resilience

### Frontend Error Handling

- **Connection Errors**: Displayed to user, automatic retry
- **Data Parsing Errors**: Graceful degradation, show last known data
- **API Errors**: Error messages displayed, fallback to cached data

### Backend Error Handling

- **Database Errors**: Logged, return error response
- **Ingestion Errors**: Logged, continue loop (with backoff)
- **Schema Errors**: Exit on startup (fail-fast)

### ESP32 Error Handling

- **Sensor Errors**: Continue operation, log error
- **Network Errors**: Retry connection, fallback to AP mode
- **Storage Errors**: Continue operation, skip logging

---

## Monitoring & Observability

### Current Monitoring

**Frontend:**
- Browser console logging
- Error boundaries (React)
- Vercel analytics (if enabled)

**Backend:**
- Console logging (stdout/stderr)
- Railway logs dashboard
- Health check endpoint (`/health`)

**Database:**
- Railway metrics dashboard
- Connection pool monitoring

### Recommended Improvements

- **Application Monitoring**: Sentry, Datadog, or similar
- **Performance Monitoring**: APM tools
- **Log Aggregation**: Centralized logging (e.g., Logtail, Papertrail)
- **Uptime Monitoring**: External monitoring (e.g., UptimeRobot)
- **Alerting**: Email/SMS alerts for critical errors

---

## Future Architecture Considerations

### Short-Term Improvements

1. **WebSocket Support**: Real-time bidirectional communication
2. **Authentication**: User authentication and authorization
3. **Multi-Device Support**: Support multiple ESP32 devices
4. **Data Export**: CSV/JSON export functionality
5. **Mobile App**: React Native or PWA mobile application

### Long-Term Enhancements

1. **Microservices Architecture**: Split backend into services
2. **Message Queue**: Async processing with RabbitMQ/Kafka
3. **Time-Series Database**: InfluxDB for better telemetry storage
4. **Machine Learning**: Predictive analytics and optimization
5. **Edge Computing**: Process data closer to ESP32 devices
6. **Blockchain**: Immutable telemetry records (optional)

---

## Summary

The IDAST system follows a **modern, cloud-native architecture** with:

- **Frontend**: Next.js on Vercel (serverless, global CDN)
- **Backend**: Express.js on Railway (containerized, scalable)
- **Database**: MySQL on Railway (managed, reliable)
- **Hardware**: ESP32 with web server (embedded, IoT)
- **Tunneling**: Cloudflare Tunnel (secure, remote access)

**Key Architectural Strengths:**
- Separation of concerns (3-tier architecture)
- Multiple connection modes (flexibility)
- Automatic schema initialization (zero-config)
- Scalable deployment (serverless + containers)
- Secure communication (SSL/TLS everywhere)

**Areas for Improvement:**
- Real-time communication (WebSocket/SSE)
- Horizontal scaling (multiple instances)
- Caching layer (Redis)
- Authentication/authorization
- Advanced monitoring/observability

---

*Last Updated: December 2025*