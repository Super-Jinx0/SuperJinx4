// Brand catalog: maps a model id to a brand (name, colors, glyph) and a human-friendly name/version.
// Pure module (no DOM) so it can be tested in Node.

const rays = (n, r1, r2, w) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  const c = Math.cos(a), s = Math.sin(a);
  return `<path d="M${(12 + c * r1).toFixed(2)} ${(12 + s * r1).toFixed(2)}L${(12 + c * r2).toFixed(2)} ${(12 + s * r2).toFixed(2)}" stroke-width="${w}"/>`;
}).join('');

const GLYPH = {
  claude: `<g stroke="currentColor" stroke-linecap="round" fill="none">${rays(10, 2.6, 10, 2.1)}</g>`,
  gemini: '<path fill="currentColor" d="M12 1.5C12.7 7.3 16.7 11.3 22.5 12 16.7 12.7 12.7 16.7 12 22.5 11.3 16.7 7.3 12.7 1.5 12 7.3 11.3 11.3 7.3 12 1.5Z"/>',
  openai: `<g stroke="currentColor" stroke-linecap="round" fill="none" stroke-width="2.1"><circle cx="12" cy="12" r="3.2"/>${rays(6, 5.6, 10, 2.1)}</g>`,
  grok: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M5 5l14 14M19 5L5 19"/>',
  deepseek: '<path fill="currentColor" d="M3 12.5c2.5-5.5 9-7.5 14-4.5l3-2-1 4c1.6 3.2-.6 7.5-5.5 8.5-4 .8-8.5-.5-10.5-6Z"/><circle cx="15.5" cy="10.3" r="1.2" fill="#fff"/>',
  letter: null,
};

// key -> brand. accent = main colour (light theme), dark = lighter variant used on dark theme,
// soft = tinted background, tint = page glow, grad = optional gradient for primary buttons.
export const BRANDS = {
  claude:     { name: 'Claude',     maker: 'Anthropic',  accent: '#c8643c', dark: '#e08a66', soft: '#f7e4da', tint: '#f3d9c9', glyph: 'claude' },
  gemini:     { name: 'Gemini',     maker: 'Google',     accent: '#4a6cf0', dark: '#8aa2ff', soft: '#e4eafd', tint: '#d7defa', glyph: 'gemini', grad: 'linear-gradient(135deg,#4285f4 0%,#9b72cb 55%,#d96570 100%)' },
  gpt:        { name: 'GPT',        maker: 'OpenAI',     accent: '#0f9a77', dark: '#34c9a3', soft: '#d9f3ea', tint: '#c4eadc', glyph: 'openai' },
  grok:       { name: 'Grok',       maker: 'xAI',        accent: '#1b1b1d', dark: '#e8e8ea', soft: '#ececee', tint: '#dcdce0', glyph: 'grok' },
  deepseek:   { name: 'DeepSeek',   maker: 'DeepSeek',   accent: '#4263eb', dark: '#7e95ff', soft: '#e2e8ff', tint: '#d3dcff', glyph: 'deepseek' },
  llama:      { name: 'Llama',      maker: 'Meta',       accent: '#0866ff', dark: '#5b9bff', soft: '#e0ecff', tint: '#cfe0ff', letter: 'L' },
  mistral:    { name: 'Mistral',    maker: 'Mistral AI', accent: '#e8590c', dark: '#ff8a4a', soft: '#ffe8da', tint: '#ffd9c2', letter: 'M' },
  qwen:       { name: 'Qwen',       maker: 'Alibaba',    accent: '#6a5cf0', dark: '#9b90ff', soft: '#e9e7fd', tint: '#dbd8fb', letter: 'Q' },
  kimi:       { name: 'Kimi',       maker: 'Moonshot',   accent: '#1578e8', dark: '#5aa4ff', soft: '#e0eefd', tint: '#cfe3fb', letter: 'K' },
  glm:        { name: 'GLM',        maker: 'Zhipu',      accent: '#2f55f0', dark: '#7b96ff', soft: '#e1e7fe', tint: '#d0d9fc', letter: 'Z' },
  cohere:     { name: 'Command',    maker: 'Cohere',     accent: '#3b6b58', dark: '#74b79d', soft: '#e0eee8', tint: '#cfe3da', letter: 'C' },
  perplexity: { name: 'Perplexity', maker: 'Perplexity', accent: '#1f8a99', dark: '#58c4d3', soft: '#dbf0f3', tint: '#c6e6ea', letter: 'P' },
  nvidia:     { name: 'Nemotron',   maker: 'NVIDIA',     accent: '#5f9a00', dark: '#8fd12a', soft: '#e7f3cf', tint: '#d9ecb3', letter: 'N' },
  microsoft:  { name: 'Phi',        maker: 'Microsoft',  accent: '#0a78d4', dark: '#58aef0', soft: '#dcecfa', tint: '#c8e0f6', letter: 'P' },
  amazon:     { name: 'Nova',       maker: 'Amazon',     accent: '#e58a00', dark: '#ffb340', soft: '#fdecd0', tint: '#fadfb0', letter: 'N' },
  flux:       { name: 'FLUX',       maker: 'Black Forest Labs', accent: '#2b2b33', dark: '#d8d8e0', soft: '#ebebf0', tint: '#dcdce4', letter: 'F' },
  stability:  { name: 'Stable Diffusion', maker: 'Stability AI', accent: '#7a3cf0', dark: '#a98aff', soft: '#ece3fd', tint: '#ddd0fb', letter: 'S' },
  video:      { name: 'Video',      maker: '',           accent: '#d6336c', dark: '#ff7aa5', soft: '#fde1ea', tint: '#fbcfdc', letter: 'V' },
  other:      { name: 'Jinx',       maker: '',           accent: '#5b3df5', dark: '#9a86ff', soft: '#e9e5fe', tint: '#dcd5fc', letter: 'J' },
};
BRANDS.other.grad = 'linear-gradient(135deg,#5b3df5 0%,#c026d3 100%)';

const PROVIDER = {
  anthropic: 'claude', google: 'gemini', openai: 'gpt', 'x-ai': 'grok', xai: 'grok', deepseek: 'deepseek', 'meta-llama': 'llama', meta: 'llama',
  mistralai: 'mistral', mistral: 'mistral', qwen: 'qwen', alibaba: 'qwen', moonshotai: 'kimi', moonshot: 'kimi', 'z-ai': 'glm', zhipu: 'glm', thudm: 'glm',
  cohere: 'cohere', perplexity: 'perplexity', nvidia: 'nvidia', microsoft: 'microsoft', amazon: 'amazon', 'black-forest-labs': 'flux', stabilityai: 'stability',
};
const PATTERNS = [
  [/claude|anthropic/i, 'claude'], [/gemini|gemma|imagen|veo|nano-banana/i, 'gemini'], [/gpt|chatgpt|dall-?e|sora|\bo[1-9](-|$)|openai/i, 'gpt'],
  [/grok/i, 'grok'], [/deepseek/i, 'deepseek'], [/llama/i, 'llama'], [/mistral|mixtral|codestral|pixtral|ministral/i, 'mistral'],
  [/qwen|\bwan\b/i, 'qwen'], [/kimi|moonshot/i, 'kimi'], [/glm|zhipu|cogview/i, 'glm'], [/command|cohere/i, 'cohere'], [/sonar|perplexity/i, 'perplexity'],
  [/nemotron|nvidia/i, 'nvidia'], [/\bphi-?\d/i, 'microsoft'], [/\bnova\b|titan/i, 'amazon'], [/flux/i, 'flux'], [/stable|sdxl|stability/i, 'stability'],
  [/kling|runway|luma|pika|hailuo|video/i, 'video'],
];

export function brandKey(id) {
  const s = String(id || '');
  const prov = s.includes('/') ? s.split('/')[0].toLowerCase() : '';
  if (PROVIDER[prov]) return PROVIDER[prov];
  for (const [re, k] of PATTERNS) if (re.test(s)) return k;
  return 'other';
}
export const brandOf = (id) => ({ key: brandKey(id), ...BRANDS[brandKey(id)] });

const WORDS = {
  gpt: 'GPT', llama: 'Llama', deepseek: 'DeepSeek', qwen: 'Qwen', grok: 'Grok', mistral: 'Mistral', mixtral: 'Mixtral', kimi: 'Kimi', glm: 'GLM',
  gemini: 'Gemini', gemma: 'Gemma', claude: 'Claude', flux: 'FLUX', sdxl: 'SDXL', sora: 'Sora', veo: 'Veo', dalle: 'DALL·E', 'dall-e': 'DALL·E',
  instruct: 'Instruct', chat: 'Chat', mini: 'Mini', nano: 'Nano', pro: 'Pro', flash: 'Flash', lite: 'Lite', ultra: 'Ultra', max: 'Max', plus: 'Plus',
  turbo: 'Turbo', preview: 'Preview', thinking: 'Thinking', image: 'Image', codex: 'Codex', coder: 'Coder', vl: 'VL', moe: 'MoE', r1: 'R1', v3: 'V3',
  opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', large: 'Large', medium: 'Medium', small: 'Small', fast: 'Fast', reasoning: 'Reasoning', beta: 'Beta',
};

function titleWords(tokens) {
  return tokens.filter(Boolean).map((t) => {
    const low = t.toLowerCase();
    if (WORDS[low]) return WORDS[low];
    if (/^\d+(\.\d+)?b$/i.test(t)) return t.toUpperCase();
    if (/^\d{8}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) return '';
    if (/^[a-z]\d/.test(low) && low.length <= 4) return low.toUpperCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }).filter(Boolean);
}
const dotVer = (v) => String(v || '').replace(/-/g, '.');

/** Returns { name, version, tags, brand }. name is a clean, human-friendly name; version is the numeric part if any. */
export function prettyModel(id, apiName = '') {
  const raw = String(id || '');
  const brand = brandKey(raw);
  let tail = raw.split('/').pop();
  const tags = [];
  const colon = tail.split(':');
  tail = colon[0];
  for (const t of colon.slice(1)) tags.push(t === 'free' ? 'رایگان' : t === 'thinking' ? 'تفکر' : t);
  let name = '', version = '';
  let m;
  if ((m = /^claude-(opus|sonnet|haiku)-(\d+(?:[.-]\d+)?)(?:-\d{8})?(.*)$/i.exec(tail))) {
    version = dotVer(m[2]); name = `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${version}`;
    const rest = titleWords(m[3].split('-')); if (rest.length) name += ' ' + rest.join(' ');
  } else if ((m = /^claude-(\d+(?:[.-]\d+)?)-(opus|sonnet|haiku)(?:-\d{8})?(.*)$/i.exec(tail))) {
    version = dotVer(m[1]); name = `Claude ${m[2][0].toUpperCase()}${m[2].slice(1)} ${version}`;
    const rest = titleWords(m[3].split('-')); if (rest.length) name += ' ' + rest.join(' ');
  } else if ((m = /^gemini-(\d+(?:\.\d+)?)-(.+)$/i.exec(tail))) {
    version = m[1]; name = `Gemini ${version} ${titleWords(m[2].split('-')).join(' ')}`;
  } else if ((m = /^gpt-(\d+(?:\.\d+)?o?)(?:-(.+))?$/i.exec(tail))) {
    version = m[1]; name = `GPT-${version}` + (m[2] ? ' ' + titleWords(m[2].split('-')).join(' ') : '');
  } else if ((m = /^(o\d)(?:-(.+))?$/i.exec(tail))) {
    version = m[1].slice(1); name = m[1].toLowerCase() + (m[2] ? ' ' + titleWords(m[2].split('-')).join(' ') : '');
  } else {
    const parts = tail.split(/[-_]/);
    name = titleWords(parts).join(' ');
    const v = /(\d+(?:\.\d+)?)/.exec(tail);
    version = v ? v[1] : '';
  }
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) name = apiName || raw;
  return { name, version, tags, brand };
}

export function themeVars(id, dark = false) {
  const b = brandOf(id);
  const a = dark ? b.dark : b.accent;
  return {
    '--jade': a, '--jade-2': a, '--jade-soft': dark ? 'color-mix(in srgb, ' + a + ' 22%, #15171a)' : b.soft,
    '--tint': b.tint, '--grad': b.grad || a, '--on-accent': dark && b.key === 'grok' ? '#111' : '#fff',
  };
}

export function glyphSvg(id, cls = 'bg') {
  const b = brandOf(id);
  const inner = b.glyph ? GLYPH[b.glyph] : `<text x="12" y="16.6" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">${b.letter || 'J'}</text>`;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

/** coloured round badge with the brand glyph */
export function badge(id, size = '') {
  const b = brandOf(id);
  return `<span class="bbadge${size ? ' ' + size : ''}" style="--bc:${b.accent};--bg:${b.grad || b.accent}" data-brand="${b.key}">${glyphSvg(id)}</span>`;
}
