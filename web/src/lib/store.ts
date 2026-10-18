import { create } from "zustand";

type Span = { t0: number; t1: number };
type S = {
  range: [number, number] | null; // visible window in seconds from log start; null = whole flight
  focus: Span | null; // selected event span, drawn on every chart
  setRange: (r: [number, number] | null) => void;
  setFocus: (f: Span | null) => void;
  reset: () => void;
};

export const useView = create<S>((set) => ({
  range: null,
  focus: null,
  setRange: (range) => set({ range }),
  setFocus: (focus) => set({ focus }),
  reset: () => set({ range: null, focus: null }),
}));
