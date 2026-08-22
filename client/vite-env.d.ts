/// <reference types="vite/client" />

// sfx.js is a plain global script (shared with the sound lab) — see index.html
declare const SFX: {
  SOUNDS: Record<string, { layers: any[] }>;
  play(name: string): void;
  tone(freq: number, opts: any): void;
  noise(opts: any): void;
};
