const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '20mb' }));

const SUPABASE_URL = 'https://mfakknusrwdfsorimaha.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mYWtrbnVzcndkZnNvcmltYWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDQzMDQsImV4cCI6MjA5MDkyMDMwNH0.8CR1aQYvpb3XpyzQCyJ6_p1QPUJat_0Cc38dVQFU3iY';

function supaHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

const GEMINI_KEY = process.env.GEMINI_KEY || '';

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Gemini proxy endpoint
app.post('/api/gemini', async (req, res) => {
  try {
    const { model, contents, generationConfig } = req.body;
    const modelId = model || 'gemini-2.5-flash-lite';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: generationConfig || { maxOutputTokens: 3000, temperature: 0.3 } }),
      }
    );
    const data = await response.json();
    if (!response.ok || data.error) {
      return res.status(response.status || 500).json({ error: data.error?.message || 'Gemini API error' });
    }
    res.json(data);
  } catch (err) {
    console.error('Gemini error:', err);
    res.status(500).json({ error: 'Gemini request failed' });
  }
});

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

// ── Hx Coach cache ─────────────────────────────────────────────
app.get('/api/hx-cache/:key', async (req, res) => {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/hx_cache?cache_key=eq.${encodeURIComponent(req.params.key)}&select=result&limit=1`,
      { headers: supaHeaders() }
    );
    const rows = await resp.json();
    if (!rows.length) return res.json({ cached: false });
    res.json({ cached: true, result: rows[0].result });
  } catch (err) {
    res.json({ cached: false });
  }
});

app.post('/api/hx-cache', async (req, res) => {
  try {
    const { cache_key, complaint, age_bracket, sex, visit_type, result } = req.body;
    await fetch(`${SUPABASE_URL}/rest/v1/hx_cache`, {
      method: 'POST',
      headers: { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ cache_key, complaint, age_bracket, sex, visit_type: visit_type || 'returning', result }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── Image search for maneuver curation ──────────────────────────
app.post('/api/search-images', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });

    const searchQuery = encodeURIComponent(query + ' physical exam maneuver');

    // Try Bing Images
    const response = await fetch(
      `https://www.bing.com/images/search?q=${searchQuery}&form=HDRSC2&first=1`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 10000,
      }
    );
    const html = await response.text();

    const images = [];

    // Bing embeds image URLs in m= parameter as JSON
    const mRegex = /murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/gi;
    let match;
    while ((match = mRegex.exec(html)) !== null) {
      let url = match[1].replace(/&amp;/g, '&');
      if (url.includes('bing.com') || url.includes('microsoft.com') || url.includes('favicon')) continue;
      if (url.length > 600) continue;
      if (!images.includes(url)) images.push(url);
      if (images.length >= 15) break;
    }

    // Fallback: try turl (thumbnail URLs)
    if (images.length < 3) {
      const turlRegex = /turl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/gi;
      while ((match = turlRegex.exec(html)) !== null) {
        let url = match[1].replace(/&amp;/g, '&');
        if (!images.includes(url)) images.push(url);
        if (images.length >= 15) break;
      }
    }

    // Fallback: src= in img tags
    if (images.length < 3) {
      const srcRegex = /src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
      while ((match = srcRegex.exec(html)) !== null) {
        const url = match[1];
        if (url.includes('bing.com') || url.includes('microsoft') || url.includes('favicon')) continue;
        if (!images.includes(url)) images.push(url);
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

// ── Image curation API (Supabase) ───────────────────────────────
// GET curated images + video for a maneuver
app.get('/api/curated-images/:maneuver', async (req, res) => {
  try {
    const key = req.params.maneuver.toLowerCase().trim();
    const [imgResp, vidResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/curated_images?maneuver=eq.${encodeURIComponent(key)}&select=*&limit=1`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/maneuver_videos?maneuver=eq.${encodeURIComponent(key)}&select=*&limit=1`, { headers: supaHeaders() }),
    ]);
    const imgRows = await imgResp.json();
    const vidRows = await vidResp.json();
    if (!imgRows.length && !vidRows.length) return res.json({ curated: false });
    res.json({
      curated: true,
      images: imgRows[0]?.images || [],
      video_url: vidRows[0]?.video_url || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save curated images for a maneuver (upsert)
app.post('/api/curated-images', async (req, res) => {
  try {
    const { maneuver, images } = req.body;
    if (!maneuver) return res.status(400).json({ error: 'maneuver required' });
    const key = maneuver.toLowerCase().trim();

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/curated_images`,
      {
        method: 'POST',
        headers: { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ maneuver: key, images: images || [], updated_at: new Date().toISOString() }),
      }
    );
    const data = await resp.json();
    res.json({ ok: true, maneuver: key, imageCount: (images || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save video URL for a maneuver
app.post('/api/maneuver-video', async (req, res) => {
  try {
    const { maneuver, video_url } = req.body;
    if (!maneuver) return res.status(400).json({ error: 'maneuver required' });
    const key = maneuver.toLowerCase().trim();
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/maneuver_videos`,
      {
        method: 'POST',
        headers: { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ maneuver: key, video_url: video_url || '' }),
      }
    );
    const data = await resp.json();
    res.json({ ok: true, maneuver: key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all curated maneuvers (admin overview)
app.get('/api/curated-images', async (req, res) => {
  try {
    const [imgResp, vidResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/curated_images?select=maneuver,images,updated_at&order=maneuver`, { headers: supaHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/maneuver_videos?select=maneuver,video_url`, { headers: supaHeaders() }),
    ]);
    const imgRows = await imgResp.json();
    const vidRows = await vidResp.json();
    const videoMap = {};
    for (const v of vidRows) { videoMap[v.maneuver] = v.video_url; }
    const result = {};
    // Merge images and videos
    const allKeys = new Set([...imgRows.map(r => r.maneuver), ...Object.keys(videoMap)]);
    for (const key of allKeys) {
      const imgRow = imgRows.find(r => r.maneuver === key);
      result[key] = {
        images: imgRow?.images || [],
        video_url: videoMap[key] || '',
        updated_at: imgRow?.updated_at || '',
      };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE curation for a maneuver
app.delete('/api/curated-images/:maneuver', async (req, res) => {
  try {
    const key = req.params.maneuver.toLowerCase().trim();
    await fetch(
      `${SUPABASE_URL}/rest/v1/curated_images?maneuver=eq.${encodeURIComponent(key)}`,
      { method: 'DELETE', headers: supaHeaders() }
    );
    res.json({ ok: true, deleted: key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Chinwe backend running on port ${PORT}`));
