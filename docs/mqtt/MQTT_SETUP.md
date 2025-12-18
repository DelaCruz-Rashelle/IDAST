# MQTT Setup Guide for Solar Tracker

This guide explains how to set up EMQX Cloud as the MQTT broker for the solar tracker system.

## Overview

The solar tracker system uses MQTT (Message Queuing Telemetry Transport) for real-time data communication. ESP32 devices publish telemetry data to an MQTT broker (EMQX Cloud), and the frontend dashboard and backend API subscribe to receive this data.

## Why MQTT?

- **No USB Required**: ESP32 runs independently after initial firmware flash
- **No Tunneling**: Direct internet connection via WiFi, no port forwarding needed
- **Real-time**: Push-based notifications instead of polling
- **Reliable**: Message persistence (QoS 1) prevents data loss
- **Scalable**: Easy to add more devices

## EMQX Cloud Setup

### Step 1: Create EMQX Cloud Account

1. Go to [EMQX Cloud](https://www.emqx.com/en/cloud)
2. Sign up for a free account
3. Create a new deployment (Free tier available)

### Step 2: Configure Deployment

1. **Choose Region**: Select a region close to your ESP32 devices
2. **Select Plan**: Free tier is sufficient for development/testing
3. **Create Deployment**: Wait for deployment to be ready (2-3 minutes)

### Step 3: Get Connection Details

After deployment is ready, you'll need:

1. **Broker URL**: 
   - MQTT: `mqtt://{deployment-id}.emqx.cloud:1883`
   - WebSocket: `wss://{deployment-id}.emqx.cloud:8084/mqtt`

2. **Authentication** (Optional but recommended):
   - Go to "Authentication" → "Authentication"
   - Create a username/password
   - Or use API keys for more security

### Step 4: Configure Environment Variables

#### ESP32 (Arduino IDE)

Add these to your `arduino_receiver.md` or set via Preferences:

```cpp
// In Preferences namespace "solar_rx"
mqttBroker = "your-deployment-id.emqx.cloud"
mqttPort = 1883
mqttUsername = "your-username"  // Optional
mqttPassword = "your-password"  // Optional
```

Or modify the code directly:
```cpp
const char* MQTT_BROKER_HOST = "your-deployment-id.emqx.cloud";
const int MQTT_BROKER_PORT = 1883;
```

#### Vercel (Frontend)

Go to Vercel → Project Settings → Environment Variables:

```
NEXT_PUBLIC_MQTT_BROKER_URL=wss://your-deployment-id.emqx.cloud:8084/mqtt
NEXT_PUBLIC_MQTT_USERNAME=your-username  (optional)
NEXT_PUBLIC_MQTT_PASSWORD=your-password  (optional)
```

#### Railway (Backend)

Go to Railway → Service → Variables:

```
MQTT_BROKER_URL=mqtt://your-deployment-id.emqx.cloud:1883
MQTT_USERNAME=your-username  (optional)
MQTT_PASSWORD=your-password  (optional)
```

## Testing MQTT Connection

### Test with MQTT Client

1. Install an MQTT client (e.g., MQTTX, MQTT.fx, or mosquitto-clients)
2. Connect to your EMQX deployment:
   - Host: `your-deployment-id.emqx.cloud`
   - Port: `1883` (MQTT) or `8084` (WebSocket)
   - Username/Password: (if configured)

3. Subscribe to telemetry topic:
   ```
   solar-tracker/+/telemetry
   ```

4. You should see messages when ESP32 is publishing

### Test ESP32 Connection

1. Flash the updated firmware to ESP32 receiver
2. Configure WiFi via AP mode (http://192.168.4.1/wifi-setup)
3. Check Serial Monitor for MQTT connection status:
   ```
   ✅ MQTT connected
   ✅ Subscribed to: solar-tracker/+/telemetry
   ```

### Test Frontend Connection

1. Deploy frontend with MQTT environment variables
2. Open browser console
3. Look for:
   ```
   ✅ MQTT connected
   ✅ Subscribed to: solar-tracker/+/telemetry
   ```

## Troubleshooting

### ESP32 Can't Connect to MQTT

**Symptoms**: Serial Monitor shows "MQTT connection failed"

**Solutions**:
1. Check WiFi connection: `WiFi.status() == WL_CONNECTED`
2. Verify broker hostname is correct
3. Check firewall/router settings (port 1883 should be open)
4. Verify username/password if authentication is enabled
5. Check EMQX Cloud deployment status

### Frontend Can't Connect

**Symptoms**: Dashboard shows "MQTT Disconnected"

**Solutions**:
1. Verify `NEXT_PUBLIC_MQTT_BROKER_URL` is set correctly
2. Use WebSocket URL format: `wss://...` (not `mqtt://...`)
3. Check browser console for connection errors
4. Verify CORS settings in EMQX (WebSocket should work by default)

### Backend Can't Subscribe

**Symptoms**: No telemetry in database

**Solutions**:
1. Check Railway logs for MQTT connection errors
2. Verify `MQTT_BROKER_URL` uses `mqtt://` protocol (not `wss://`)
3. Check subscription topic: `solar-tracker/+/telemetry`
4. Verify ESP32 is publishing messages

### No Messages Received

**Symptoms**: Connected but no data

**Solutions**:
1. Verify ESP32 is publishing (check Serial Monitor)
2. Check topic name matches: `solar-tracker/{device_id}/telemetry`
3. Verify device_id is set correctly
4. Check EMQX Cloud message statistics

## Security Best Practices

1. **Enable Authentication**: Always use username/password
2. **Use TLS/SSL**: For production, use `mqtts://` and `wss://` with certificates
3. **Topic Permissions**: Configure ACL (Access Control List) in EMQX
4. **Device IDs**: Use unique, non-guessable device IDs
5. **Rate Limiting**: Configure message rate limits in EMQX

## Free Tier Limitations

EMQX Cloud Free tier typically includes:
- 1 deployment
- 1000 connections
- 100,000 messages/month
- Basic authentication

For production with multiple devices, consider upgrading to a paid plan.

## Alternative MQTT Brokers

If you prefer a different MQTT broker:

- **Mosquitto**: Self-hosted, free
- **HiveMQ Cloud**: Managed service
- **AWS IoT Core**: AWS-managed
- **Azure IoT Hub**: Azure-managed

Update connection details accordingly in environment variables.

## Next Steps

1. ✅ Set up EMQX Cloud deployment
2. ✅ Configure environment variables
3. ✅ Flash ESP32 with updated firmware
4. ✅ Deploy frontend and backend
5. ✅ Test end-to-end data flow
6. ✅ Monitor message statistics in EMQX dashboard

## Additional Resources

- [EMQX Cloud Documentation](https://docs.emqx.com/en/cloud/latest/)
- [MQTT Protocol Specification](https://mqtt.org/mqtt-specification/)
- [PubSubClient Library](https://github.com/knolleary/pubsubclient) (ESP32 MQTT client)

