import { browser } from 'wxt/browser';

const AudioContextCtor = globalThis.AudioContext || (globalThis as any).webkitAudioContext;
let audioContext: AudioContext | null = null;
let soundBufferCacheContext: AudioContext | null = null;
let soundBufferCache = new Map<string, Promise<AudioBuffer>>();

function getAudioContext(): AudioContext | null {
  if (!AudioContextCtor) return null;
  if (audioContext) return audioContext;
  try {
    audioContext = new AudioContextCtor();
    return audioContext;
  } catch {
    return null;
  }
}

async function loadSoundBuffer(ctx: AudioContext, soundPath: string): Promise<AudioBuffer> {
  if (soundBufferCacheContext !== ctx) {
    soundBufferCacheContext = ctx;
    soundBufferCache = new Map();
  }
  if (soundBufferCache.has(soundPath)) {
    return soundBufferCache.get(soundPath)!;
  }

  const promise = (async () => {
    const response = await fetch(browser.runtime.getURL(soundPath as any));
    if (!response.ok) throw new Error('Failed to load sound: ' + soundPath);
    const base64 = (await response.text()).replace(/\s+/g, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
  })();

  soundBufferCache.set(soundPath, promise);
  return promise;
}

async function playSound(soundPath: string, normalizedVolume: number): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) throw new Error('AudioContext unavailable in offscreen document');

  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  if (normalizedVolume <= 0) return;

  const startTime = ctx.currentTime + 0.03;
  const soundBuffer = await loadSoundBuffer(ctx, soundPath);
  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();

  source.buffer = soundBuffer;
  source.loop = false;
  gainNode.gain.setValueAtTime(
    Math.max(0, Math.min(2.5, Math.pow(normalizedVolume, 0.55) * 2.2)),
    startTime,
  );
  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  return new Promise<void>((resolve) => {
    source.onended = () => {
      try {
        source.disconnect();
        gainNode.disconnect();
      } catch {}
      resolve();
    };
    source.start(startTime);
  });
}

interface OffscreenMessage {
  action: string;
  soundPath: string;
  normalizedVolume: number;
}

browser.runtime.onMessage.addListener(
  (message: OffscreenMessage, _sender: any, sendResponse: (response: { ok: boolean; error?: string }) => void) => {
    if (!message || message.action !== 'offscreenPlaySound') return false;

    playSound(message.soundPath, message.normalizedVolume)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: String(err instanceof Error ? err.message : err),
        }),
      );

    return true;
  },
);
