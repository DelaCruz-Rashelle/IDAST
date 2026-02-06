# MQTT Setup Guide for Solar Tracker

## Overview

MQTT is like a **mail delivery service** for solar tracker. Instead of the dashboard constantly asking "Do you have data?" the solar tracker **automatically sends updates** whenever something changes. EMQX Cloud is the "post office" that delivers these messages.

## Why Use This System?

- **No cables needed**: The ESP32 device works wirelessly via WiFi
- **Real-time updates**: Dashboard gets fresh data instantly
- **Reliable**: Messages don't get lost if there's a brief disconnect
- **Easy to expand**: You can add more solar trackers without changes

## Setting Up EMQX Cloud (The Message Service)

### Step 1: Create an Account

1. Go to [EMQX Cloud](https://www.emqx.com/en/cloud)
2. Click "Sign up" and create a free account
3. Click "Create Deployment" to set up a new service

### Step 2: Configure Your Service

1. **Select a location**: Choose a region near where your solar tracker will be used
2. **Choose the Free plan**: This is fine for testing and development
3. **Create**: Wait a few minutes for the service to start

### Step 3: Get Your Service Details

Once running, you'll need to copy these details:

1. **Service Address** (you'll see a code like `abc123xyz.emqx.cloud`)
2. **Username & Password** (optional but recommended):
   - Go to "Authentication" → "Create" 
   - Make up a username and password
   - Save these in a secure place

### Step 4: Set Up Connection Information

You'll need to add your service details in three places:

#### ESP32 Device (Solar Tracker)

In your device settings, add:
```
Service Address: your-code.emqx.cloud
Username: your-username
Password: your-password
```

#### Website (Vercel)

Go to Vercel → Project Settings → Environment Variables, add:
```
NEXT_PUBLIC_MQTT_BROKER_URL = wss://your-code.emqx.cloud:8084/mqtt
NEXT_PUBLIC_MQTT_USERNAME = your-username
NEXT_PUBLIC_MQTT_PASSWORD = your-password
```

#### Backend Server (Railway)

Go to Railway → Service → Variables, add:
```
MQTT_BROKER_URL = mqtt://your-code.emqx.cloud:1883
MQTT_USERNAME = your-username
MQTT_PASSWORD = your-password
```

## Testing the Connection

### Does the Device Connect?

1. Turn on your solar tracker
2. Open the Serial Monitor (for developers)
3. Look for a message that says "✅ MQTT connected"
4. If you see this, the tracker is talking to the service correctly

### Does the Dashboard Show Data?

1. Open your dashboard website
2. Check if you see "MQTT Connected" in the top right
3. If you see data updating (power, battery %), it's working!

### Check the EMQX Service

1. Go back to EMQX Cloud
2. Look at "Status" or "Monitoring"
3. You should see messages being sent and received
4. If there are 0 messages, something isn't connecting

## Troubleshooting (Problems & Fixes)

### Problem: Solar Tracker Won't Connect

**What you'll see**: Error message on device or no "MQTT connected" message

**Try these fixes**:
1. Check that the WiFi is working on the tracker
2. Verify the service address is typed correctly
3. Check that your username/password are correct
4. Make sure the EMQX service is still running (check the website)

### Problem: Dashboard Shows "MQTT Disconnected"

**What you'll see**: Red warning on the dashboard

**Try these fixes**:
1. Check that the service address is correct in Vercel settings
2. Make sure you're using the correct format: `wss://your-code.emqx.cloud:8084/mqtt`
3. Refresh the dashboard page
4. Check if the EMQX service is running

### Problem: No Data on Dashboard (But Device is Connected)

**What you'll see**: Connected message, but no power, battery, or other readings

**Try these fixes**:
1. Make sure the solar tracker is turned on and outdoors
2. Wait a minute for data to start flowing
3. Try turning the tracker off and back on
4. Check EMQX website to see if messages are being received

## Security Tips

1. **Use a password**: Always set a username and password in EMQX
2. **Keep credentials secret**: Don't share your username/password with others
3. **Unique names**: Use unique names for each device you add
4. **Watch your usage**: The free plan has limits (100,000 messages/month)

## Free Plan Limits

The free EMQX service includes:
- **1 service** (messaging system)
- **1000 connections** (devices that can connect)
- **100,000 messages/month** (plenty for testing)
- **Username/Password authentication**

This is plenty for testing and small projects. If you need more, you can upgrade to a paid plan.

## Next Steps

1. Create your EMQX Cloud account
2. Add the service details to Vercel and Railway
3. Update your solar tracker with the service address
4. Check that everything connects properly
5. Monitor data flowing to the dashboard

