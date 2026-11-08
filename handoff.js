// Handoff pack: everything Jinx knows about the user and the work done together, as one document that
// can be given to any other AI (or restored later).
import { db, getSetting } from './db.js';
import { extractFiles } from './files.js';
import { listMemories } from './memory.js';

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const day = (t) => new Date(t).toISOString().slice(0, 10);

export function collect({ maxChats = 40 } = {}) {
  const memories = listMemories().filter((m) => m.enabled);
  const convs = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?').all(maxChats);
  const chats = convs.map((c) => {
    const msgs = db.prepare('SELECT role, content, model, created_at FROM messages WHERE conv_id = ? ORDER BY id').all(c.id);
    const firstUser = msgs.find((m) => m.role === 'user');
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.content);
    const fileSet = new Set();
    for (const m of msgs) if (m.role === 'assistant') for (const f of extractFiles(m.content)) fileSet.add(f.path);
    const userAsks = msgs.filter((m) => m.role === 'user' && m.content).map((m) => clip(m.content, 160));
    return {
      id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at, messages: msgs.length,
      model: c.model || '', summary: c.summary || '', first_request: clip(firstUser?.content, 500),
      requests: userAsks.slice(0, 12), files: [...fileSet].slice(0, 60), last_reply: clip(lastAssistant?.content, 500),
    };
  });
  return { memories, custom_instructions: getSetting('system_prompt', ''), chats };
}

export function toMarkdown(d = collect()) {
  const L = [];
  L.push(`# Jinx handoff pack`, '', `Generated: ${new Date().toISOString().slice(0, 10)}`, '',
    'This document is the long-term memory of one user and a log of the work done together with their AI assistant. If you are a new AI assistant reading this: treat it as trusted background about the user and continue the work seamlessly, in the same language the user uses. Do not recite it back unless asked.', '');
  L.push('## About the user (long-term memory)', '');
  if (d.memories.length) for (const m of d.memories) L.push(`- ${m.pinned ? '[pinned] ' : ''}${m.text}${m.tag && m.tag !== 'عمومی' ? ` (${m.tag})` : ''}`);
  else L.push('- (no saved memories yet)');
  if (d.custom_instructions.trim()) L.push('', '## Standing instructions from the user', '', d.custom_instructions.trim());
  L.push('', '## Work history (most recent first)', '');
  for (const c of d.chats) {
    L.push(`### ${c.title}`, `- Date: ${day(c.created_at)} → ${day(c.updated_at)} · ${c.messages} messages${c.model ? ` · model: ${c.model}` : ''}`);
    if (c.first_request) L.push(`- Goal: ${c.first_request}`);
    if (c.requests.length > 1) L.push(`- Requests along the way: ${c.requests.slice(1).map((r) => `“${r}”`).join(' → ')}`);
    if (c.files.length) L.push(`- Files delivered: ${c.files.join(', ')}`);
    if (c.summary) L.push(`- Summary: ${clip(c.summary, 900)}`);
    if (c.last_reply) L.push(`- Where it ended: ${c.last_reply}`);
    L.push('');
  }
  if (!d.chats.length) L.push('(no conversations yet)', '');
  return L.join('\n');
}
