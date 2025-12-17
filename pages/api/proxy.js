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
    // Determine request content type and body format
    const requestContentType = req.headers['content-type'] || 'application/json';
    let requestBody = undefined;
    
    if (req.method !== 'GET' && req.body) {
      if (requestContentType.includes('application/x-www-form-urlencoded')) {
        // For form-urlencoded, use URLSearchParams or string directly
        if (typeof req.body === 'string') {
          requestBody = req.body;
        } else if (typeof req.body === 'object') {
          requestBody = new URLSearchParams(req.body).toString();
        }
      } else {
        // For JSON or other content types
        requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }
    }
    
    // Forward the request to ESP32
    const response = await fetch(esp32Url, {
      method: req.method,
      headers: {
        'Content-Type': requestContentType,
        ...req.headers,
      },
      body: requestBody,
    });

    // Handle different response types (JSON or CSV)
    const responseContentType = response.headers.get('content-type') || '';
    let data;
    
    if (responseContentType.includes('application/json')) {
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
    if (responseContentType) {
      res.setHeader('Content-Type', responseContentType);
    }
    
    // Return appropriate format
    if (responseContentType.includes('application/json')) {
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

