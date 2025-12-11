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
    return res.status(400).json({ error: 'Tunnel URL not configured. Set NEXT_PUBLIC_API_BASE_URL environment variable.' });
  }

  // Construct full URL
  const fullUrl = `${tunnelUrl}${endpoint}`;

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
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      // For text responses (like CSV history)
      data = await response.text();
    }
    
    // Return response with CORS headers for the client
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Preserve content type
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Return JSON for JSON responses, text for others
    if (contentType?.includes('application/json')) {
      return res.status(response.status).json(data);
    } else {
      return res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('Tunnel proxy error:', error);
    return res.status(500).json({ 
      error: 'Failed to connect via tunnel',
      message: error.message,
      details: 'Check if the Cloudflare tunnel is running and accessible'
    });
  }
}

