const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '20mb' }));

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
        max_tokens: max_tokens || 1200,
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
        max_tokens: max_tokens || 1200,
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

app.listen(PORT, () => console.log(`Chinwe backend running on port ${PORT}`));
