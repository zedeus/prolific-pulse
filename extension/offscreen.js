// offscreen.js — Chrome offscreen document for audio playback.
// Created by the background service worker when a priority alert sound needs to play.
(() => {
  "use strict";

  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  let audioContext = null;
  let soundBufferCacheContext = null;
  let soundBufferCache = new Map();

  function getAudioContext() {
    if (!AudioContextCtor) return null;
    if (audioContext) return audioContext;
    try {
      audioContext = new AudioContextCtor();
      return audioContext;
    } catch {
      return null;
    }
  }

  async function loadSoundBuffer(ctx, soundPath) {
    if (soundBufferCacheContext !== ctx) {
      soundBufferCacheContext = ctx;
      soundBufferCache = new Map();
    }
    if (soundBufferCache.has(soundPath)) {
      return soundBufferCache.get(soundPath);
    }

    const promise = (async () => {
      const response = await fetch(chrome.runtime.getURL(soundPath));
      if (!response.ok) throw new Error("Failed to load sound: " + soundPath);
      const base64 = (await response.text()).replace(/\s+/g, "");
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return ctx.decodeAudioData(bytes.buffer.slice(0));
    })();

    soundBufferCache.set(soundPath, promise);
    return promise;
  }

  async function playSound(soundPath, normalizedVolume) {
    const ctx = getAudioContext();
    if (!ctx) throw new Error("AudioContext unavailable in offscreen document");

    if (ctx.state === "suspended") {
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
      startTime
    );
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    return new Promise((resolve) => {
      source.onended = () => {
        try { source.disconnect(); gainNode.disconnect(); } catch {}
        resolve();
      };
      source.start(startTime);
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== "offscreenPlaySound") return false;

    playSound(message.soundPath, message.normalizedVolume)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({
        ok: false,
        error: String(err && err.message ? err.message : err)
      }));

    return true;
  });
})();
