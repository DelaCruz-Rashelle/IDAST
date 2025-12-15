// Next.js API route to proxy requests to ESP32
// This eliminates the need for manual Cloudflare tunnel setup

export default async function handler(req, res) {
  // Get ESP32 IP from request or environment
  const esp32IP = req.query.ip || process.env.ESP32_IP || '';
  const endpoint = req.query.endpoint || '/data';
  
  if (!esp32IP) {
    return res.status(400).json({ error: 'ESP32 IP address not provided' });
  }

  // Construct ESP32 URL
  const esp32Url = `http://${esp32IP}${endpoint}`;

  try {
    // Forward the request to ESP32
    const response = await fetch(esp32Url, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...req.headers,
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    // Handle different response types (JSON or CSV)
    const contentType = response.headers.get('content-type') || '';
    let data;
    
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      // For CSV or text responses (like /api/history endpoint)
      data = await response.text();
    }
    
    // Return ESP32 response with CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Preserve content type
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Return appropriate format
    if (contentType.includes('application/json')) {
      return res.status(response.status).json(data);
    } else {
      return res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ 
      error: 'Failed to connect to ESP32',
      message: error.message 
    });
  }
}

