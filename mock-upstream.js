// Minimal OpenAI-compatible server used ONLY for automated tests.
import http from 'node:http';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const calls = [];
const vids = new Map();

export function startMock(port) {
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ url: req.url, body });
    const auth = req.headers.authorization;
    if (auth !== 'Bearer test-key') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    }
    const j = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/models') {
      return j({ data: [
        { id: 'mock/chat-model', name: 'Mock Chat', context_length: 32000 },
        { id: 'mock/image-model', name: 'Mock Image', architecture: { output_modalities: ['image'] } },
        { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } },
        { id: 'anthropic/claude-opus-4.1', name: 'Claude Opus 4.1', context_length: 200000 },
        { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', context_length: 1000000 },
        { id: 'google/gemini-2.5-flash-image-preview', name: 'Gemini Flash Image', architecture: { output_modalities: ['image', 'text'] } },
        { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000 },
        { id: 'openai/gpt-5', name: 'GPT-5', context_length: 400000 },
        { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1', context_length: 64000, pricing: { prompt: '0', completion: '0' } },
        { id: 'x-ai/grok-4', name: 'Grok 4', context_length: 256000 },
        { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3', context_length: 131000 },
      ] });
    }
    if (req.url === '/v1/images/generations') {
      if (body.quality) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'quality not supported' } })); }
      return j({ data: Array.from({ length: body.n || 1 }, () => ({ b64_json: PNG })) });
    }
    if (req.url === '/v1/key') return j({ data: { label: 'test', usage: 12.5, limit: 50, limit_remaining: 37.5, is_free_tier: false } });
    if (req.url === '/v1/videos' && req.method === 'POST') { vids.set('vid_1', { polls: 0, prompt: body.prompt, size: body.size, seconds: body.seconds }); return j({ id: 'vid_1', status: 'queued', progress: 0 }); }
    if (req.url === '/v1/videos/vid_1' && req.method === 'GET') { const v = vids.get('vid_1'); v.polls++; return j({ id: 'vid_1', status: v.polls >= 3 ? 'completed' : 'in_progress', progress: v.polls * 30 }); }
    if (req.url === '/v1/videos/vid_1/content') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(Buffer.from('FAKE-MP4-BYTES-0123456789')); }
    if (req.url === '/v1/chat/completions') {
      const msgs = body.messages;
      const sys = String(msgs[0]?.content || '');
      const lastUser = msgs.filter((m) => m.role === 'user').at(-1);
      const lastText = typeof lastUser?.content === 'string' ? lastUser.content : lastUser?.content?.find((p) => p.type === 'text')?.text || '';
      let reply;
      if (sys.includes('long-term memory')) reply = lastText.includes('Termux') ? '[{"text":"Ali develops on Android with Termux","tag":"tool"}]' : '[]';
      else if (sys.includes('text-to-image')) reply = 'A breathtaking cinematic scene of a neon city at night, volumetric rain, reflective streets, teal and magenta palette, ultra detailed composition with dramatic lighting.';
      else if (sys.includes('running summary')) reply = 'SUMMARY: earlier discussion';
      else if (lastText.includes('pong')) reply = 'pong';
      else if (lastText.includes('make a website'))
        reply = 'Here you go:\n```html file:index.html\n<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello</h1><script src="app.js"></script></body></html>\n```\n```css file:style.css\nh1{color:#0f4d3f}\n```\n```js file:app.js\nconsole.log("ok")\n```\nDone.';
      else if (lastText.includes('FAIL_MID')) reply = null;
      else reply = 'Echo: ' + lastText.slice(0, 80) + (sys.includes('Persistent memory') ? ' [mem]' : '');
      if (!body.stream) return j({ choices: [{ message: { role: 'assistant', content: reply || '' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (reply === null) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial ' } }] })}\n\n`);
        return setTimeout(() => res.destroy(), 30);
      }
      if (lastText.includes('think hard')) res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Let me think about it. ' } }] })}\n\n`);
      const parts = reply.match(/[\s\S]{1,12}/g);
      for (const p of parts) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`); if (process.env.MOCK_SLOW) await new Promise((r) => setTimeout(r, Number(process.env.MOCK_SLOW))); }
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 42, completion_tokens: parts.length, cost: 0.001 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}
