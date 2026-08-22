// The agent's thoughts run as a ticker beside the typing dots: lines queue up
// as they stream in and the display advances every half second, holding on the
// last one.
import { create } from "zustand";
import type { BrainEntry } from "../../types";

interface Peek {
  queue: { text: string; seq: number }[];
  index: number;
  push(entry: BrainEntry): void;
  advance(): void;
  clear(): void;
}

export const usePeek = create<Peek>((set, get) => ({
  queue: [],
  index: -1,
  push(entry) {
    // narration and thinking only — tool calls are noise here
    if (!["text", "thinking"].includes(entry.kind)) return;
    // split multi-line thoughts so the ticker reveals them line by line
    const lines = entry.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((t) => ({ text: t.length > 140 ? t.slice(0, 140) + "…" : t, seq: entry.seq }));
    if (lines.length) set((s) => ({ queue: [...s.queue, ...lines] }));
  },
  advance() {
    const { index, queue } = get();
    if (index < queue.length - 1) set({ index: index + 1 });
  },
  clear() {
    set({ queue: [], index: -1 });
  },
}));
