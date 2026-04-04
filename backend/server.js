const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '20mb' }));

const fs = require('fs');
const path = require('path');
const CURATED_PATH = path.join(__dirname, 'curated-images.json');

function loadCurated() {
  try { return JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8')); } catch { return {}; }
}
function saveCurated(data) {
  fs.writeFileSync(CURATED_PATH, JSON.stringify(data, null, 2));
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
  try {
    const { model, max_tokens, system, messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 6000,
        system,
        messages,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }
    res.json(data);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  try {
    const { model, max_tokens, system, messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 6000,
        system,
        messages,
        stream: true,
      }),
    });
    if (!response.ok) {
      const data = await response.json();
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let buf = '';
    response.body.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            res.write('data: ' + JSON.stringify({ text: ev.delta.text }) + '\n\n');
          }
        } catch (e) {}
      }
    });
    response.body.on('end', () => {
      if (buf.trim().startsWith('data:')) {
        try {
          const ev = JSON.parse(buf.trim().slice(5).trim());
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            res.write('data: ' + JSON.stringify({ text: ev.delta.text }) + '\n\n');
          }
        } catch (e) {}
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
    response.body.on('error', (err) => { console.error('Stream error:', err); res.end(); });
    req.on('close', () => { response.body.destroy(); });
  } catch (err) {
    console.error('Stream server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Stanford Medicine 25 page fetcher ──────────────────────────
app.post('/api/stanford-fetch', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.startsWith('https://stanfordmedicine25.stanford.edu/') && !url.startsWith('https://med.stanford.edu/')) {
      return res.status(400).json({ error: 'Invalid Stanford URL' });
    }
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 10000,
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: `Stanford returned ${response.status}` });
    }
    const html = await response.text();

    // Extract images with src containing stanford
    const images = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      let src = match[1];
      // Skip tiny icons, tracking pixels, logos
      if (src.includes('logo') || src.includes('icon') || src.includes('favicon') || src.includes('pixel') || src.includes('badge')) continue;
      // Make absolute
      if (src.startsWith('/')) src = 'https://stanfordmedicine25.stanford.edu' + src;
      else if (src.startsWith('//')) src = 'https:' + src;
      if (!src.startsWith('http')) continue;
      images.push({ src, alt: match[2] || '' });
    }

    // Extract YouTube embed URLs
    const youtubeLinks = [];
    const ytRegex = /(?:src=["']|href=["'])([^"']*(?:youtube\.com|youtu\.be)[^"']*)["']/gi;
    while ((match = ytRegex.exec(html)) !== null) {
      youtubeLinks.push(match[1]);
    }

    // Also check for YouTube video IDs in iframes
    const iframeRegex = /<iframe[^>]+src=["']([^"']*youtube[^"']*)["'][^>]*>/gi;
    while ((match = iframeRegex.exec(html)) !== null) {
      if (!youtubeLinks.includes(match[1])) youtubeLinks.push(match[1]);
    }

    // Extract main content text (strip HTML, get body text)
    let bodyText = '';
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                      html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                      html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (mainMatch) {
      bodyText = mainMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 3000);
    }

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i) ||
                       html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    res.json({
      title,
      images: images.slice(0, 10), // max 10 images
      youtubeLinks: youtubeLinks.slice(0, 3),
      bodyText,
      url,
    });
  } catch (err) {
    console.error('Stanford fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch Stanford page' });
  }
});

// ── Image search for maneuver curation ──────────────────────────
app.post('/api/search-images', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });

    const searchQuery = encodeURIComponent(query + ' physical exam maneuver');
    // Fetch from Google Images via scraping
    const response = await fetch(
      `https://www.google.com/search?q=${searchQuery}&tbm=isch&safe=active`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        timeout: 10000,
      }
    );
    const html = await response.text();

    // Extract image URLs from Google Images results
    const images = [];
    // Google embeds image URLs in various formats
    const patterns = [
      /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp)[^"]*)",\d+,\d+\]/gi,
      /ou":"(https?:\/\/[^"]+)"/gi,
      /\["(https?:\/\/[^"]+)",\s*\d+,\s*\d+\s*\]/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        if (url.includes('gstatic') || url.includes('google') || url.includes('favicon')) continue;
        if (url.length > 500) continue;
        if (!images.includes(url)) images.push(url);
        if (images.length >= 15) break;
      }
      if (images.length >= 15) break;
    }

    // Also try data-src pattern
    if (images.length < 5) {
      const dataSrcRegex = /data-src="(https?:\/\/[^"]+)"/gi;
      let match;
      while ((match = dataSrcRegex.exec(html)) !== null) {
        const url = match[1];
        if (!url.includes('gstatic') && !images.includes(url)) images.push(url);
        if (images.length >= 15) break;
      }
    }

    res.json({ images: images.slice(0, 15), query });
  } catch (err) {
    console.error('Image search error:', err);
    res.status(500).json({ error: 'Image search failed', details: err.message });
  }
});

// Proxy an image URL to base64 (avoids CORS for dragging from search results)
app.post('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' });

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      timeout: 8000,
    });
    if (!response.ok) return res.status(response.status).json({ error: 'Fetch failed' });

    const buffer = await response.buffer();
    const mime = response.headers.get('content-type') || 'image/jpeg';
    const b64 = buffer.toString('base64');

    res.json({ data: b64, mime });
  } catch (err) {
    res.status(500).json({ error: 'Proxy failed', details: err.message });
  }
});

// ── Image curation API ──────────────────────────────────────────
// GET curated images for a maneuver
app.get('/api/curated-images/:maneuver', (req, res) => {
  const curated = loadCurated();
  const key = req.params.maneuver.toLowerCase().trim();
  const entry = curated[key];
  if (!entry) return res.json({ curated: false });
  res.json({ curated: true, images: entry.images || [], approved: entry.approved || [], rejected: entry.rejected || [] });
});

// POST save curated images for a maneuver
// body: { maneuver: "Hawkins test", images: [{data:"base64...",mime:"image/jpeg",caption:"..."}] }
app.post('/api/curated-images', (req, res) => {
  const { maneuver, images, approved, rejected } = req.body;
  if (!maneuver) return res.status(400).json({ error: 'maneuver required' });
  const curated = loadCurated();
  const key = maneuver.toLowerCase().trim();
  curated[key] = {
    maneuver,
    images: images || [],
    approved: approved || [],
    rejected: rejected || [],
    updated_at: new Date().toISOString(),
  };
  saveCurated(curated);
  res.json({ ok: true, maneuver: key, imageCount: (images || []).length });
});

// GET all curated maneuvers (admin overview)
app.get('/api/curated-images', (req, res) => {
  const curated = loadCurated();
  res.json(curated);
});

// DELETE curation for a maneuver (reset to uncurated)
app.delete('/api/curated-images/:maneuver', (req, res) => {
  const curated = loadCurated();
  const key = req.params.maneuver.toLowerCase().trim();
  delete curated[key];
  saveCurated(curated);
  res.json({ ok: true, deleted: key });
});

app.listen(PORT, () => console.log(`Chinwe backend running on port ${PORT}`));
