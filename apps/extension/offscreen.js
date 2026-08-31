"use strict";

let playing = null;

async function playCartReadyCue() {
  if (playing) return playing;
  playing = (async () => {
    const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    gain.connect(context.destination);
    for (const [frequency, offset, duration] of [[659.25, 0, 0.16], [880, 0.18, 0.22]]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + duration);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await context.close();
  })().finally(() => { playing = null; });
  return playing;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "yoink:play-cart-ready-sound") return false;
  void playCartReadyCue();
  return false;
});
