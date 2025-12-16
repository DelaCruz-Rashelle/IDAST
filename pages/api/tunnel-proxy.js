// API route to proxy requests to Cloudflare tunnel
// This avoids CORS issues when accessing from Vercel
// Server-side requests are not subject to browser CORS restrictions

// Disable body parsing to handle form-urlencoded properly
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}

export default async function handler(req, res) {
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  const tunnelUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const endpoint = req.query.endpoint || '/data';
  
  if (!tunnelUrl) {
    console.error('Tunnel proxy: NEXT_PUBLIC_API_BASE_URL not set');
    return res.status(400).json({ 
      error: 'Tunnel URL not configured. Set NEXT_PUBLIC_API_BASE_URL environment variable.',
      endpoint: endpoint 
    });
  }

  // Construct full URL - ensure tunnelUrl doesn't end with / and endpoint starts with /
  const cleanTunnelUrl = tunnelUrl.endsWith('/') ? tunnelUrl.slice(0, -1) : tunnelUrl;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${cleanTunnelUrl}${cleanEndpoint}`;
  
  console.log('Tunnel proxy: Forwarding request to', fullUrl);

  try {
    // Forward the request to the tunnel (server-side, no CORS issues)
    const fetchOptions = {
      method: req.method,
      headers: {},
    };

    // Copy relevant headers
    if (req.headers['content-type']) {
      fetchOptions.headers['Content-Type'] = req.headers['content-type'];
    }

    // Handle POST/PUT requests with body
    if (req.method !== 'GET' && req.body) {
      if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
        // For form-urlencoded, convert object to URLSearchParams string
        if (typeof req.body === 'string') {
          fetchOptions.body = req.body;
        } else if (typeof req.body === 'object') {
          fetchOptions.body = new URLSearchParams(req.body).toString();
        }
      } else {
        // For JSON or other content types
        fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }
    }

    const response = await fetch(fullUrl, fetchOptions);

    // Handle different response types
    let data;
    const contentType = response.headers.get('content-type') || '';
    
    // Check if response is CSV (history endpoint) or text
    const isCSV = endpoint.includes('/api/history') || contentType.includes('text/csv') || contentType.includes('text/plain');
    const isJSON = contentType.includes('application/json');
    
    if (isJSON) {
      data = await response.json();
    } else {
      // For text/CSV responses (like CSV history)
      data = await response.text();
    }
    
    // Return response with CORS headers for the client
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Preserve content type - ensure CSV gets proper content-type
    if (isCSV && !contentType.includes('text/csv')) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    } else if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Return JSON for JSON responses, text for others
    if (isJSON) {
      return res.status(response.status).json(data);
    } else {
      return res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Tunnel proxy error:', error);
    console.error('Failed URL:', fullUrl);
    return res.status(500).json({ 
      error: 'Failed to connect via tunnel',
      message: error.message,
      url: fullUrl,
      endpoint: endpoint,
      details: 'Check if the Cloudflare tunnel is running and accessible'
    });
  }
}

