// Media helpers built on ffmpeg/ffprobe (optional: every function degrades gracefully when they are missing).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

let _has = null;
export function hasFfmpeg() {
  if (_has === null) {
    try { _has = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { _has = false; }
  }
  return _has;
}

function run(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`)); });
  });
}

/** { width, height, hasAudio, duration } of an image/video file, or null */
export async function probe(file) {
  if (!hasFfmpeg()) return null;
  try {
    const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 20000 }));
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    return {
      width: v?.width || 0, height: v?.height || 0,
      hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
      duration: Number(j.format?.duration) || 0,
    };
  } catch { return null; }
}

export const AUDIO_FORMATS = {
  mp3: { args: ['-c:a', 'libmp3lame', '-q:a', '2'], mime: 'audio/mpeg' },
  m4a: { args: ['-c:a', 'aac', '-b:a', '192k'], mime: 'audio/mp4' },
  wav: { args: ['-c:a', 'pcm_s16le'], mime: 'audio/wav' },
};

/** Extract the soundtrack of a video into dest. Returns true on success. */
export async function extractAudio(src, dest, format = 'mp3') {
  const f = AUDIO_FORMATS[format] || AUDIO_FORMATS.mp3;
  await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', ...f.args, '-f', format === 'm4a' ? 'ipod' : format, dest]);
  return fs.existsSync(dest) && fs.statSync(dest).size > 0;
}

/**
 * Upscale small images so they never look soft or pixelated: Lanczos resample plus a light sharpen.
 * Only runs when the longest side is below `minSide`. Returns { path, width, height } or null when untouched.
 */
export async function upscaleImage(src, dest, minSide = 1536) {
  const info = await probe(src);
  if (!info || !info.width || Math.max(info.width, info.height) >= minSide) return null;
  const factor = Math.min(4, Math.ceil(minSide / Math.max(info.width, info.height) * 10) / 10);
  const vf = `scale=iw*${factor}:ih*${factor}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0`;
  await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', vf, '-frames:v', '1', dest], { timeoutMs: 60000 });
  if (!fs.existsSync(dest) || !fs.statSync(dest).size) return null;
  return { path: dest, width: Math.round(info.width * factor), height: Math.round(info.height * factor) };
}
