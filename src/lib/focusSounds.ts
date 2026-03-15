// Synthesized sound effects for Focus Mode via Web Audio API

function createNote(ctx: AudioContext, freq: number, start: number, duration: number, volume = 0.25, type: OscillatorType = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration);
}

/** Ascending energetic – 3 rising notes (A4→C#5→E5) */
export function playStartSound() {
  try {
    const ctx = new AudioContext();
    createNote(ctx, 440, 0, 0.15, 0.3, 'triangle');
    createNote(ctx, 554.37, 0.12, 0.15, 0.3, 'triangle');
    createNote(ctx, 659.25, 0.24, 0.25, 0.35, 'triangle');
  } catch {}
}

/** Soft descending – 2 falling notes (E5→A4) */
export function playPauseSound() {
  try {
    const ctx = new AudioContext();
    createNote(ctx, 659.25, 0, 0.2, 0.2, 'sine');
    createNote(ctx, 440, 0.18, 0.3, 0.15, 'sine');
  } catch {}
}

/** Quick double beep (C5→C5) */
export function playResumeSound() {
  try {
    const ctx = new AudioContext();
    createNote(ctx, 523.25, 0, 0.08, 0.25, 'square');
    createNote(ctx, 523.25, 0.12, 0.08, 0.25, 'square');
  } catch {}
}

/** Pomodoro focus end – triumphant fanfare (C5→E5→G5→C6) */
export function playFocusEndSound() {
  try {
    const ctx = new AudioContext();
    createNote(ctx, 523.25, 0, 0.18, 0.3, 'triangle');
    createNote(ctx, 659.25, 0.15, 0.18, 0.3, 'triangle');
    createNote(ctx, 783.99, 0.30, 0.18, 0.3, 'triangle');
    createNote(ctx, 1046.5, 0.45, 0.35, 0.35, 'triangle');
  } catch {}
}

/** Break end – soft bell + rising note */
export function playBreakEndSound() {
  try {
    const ctx = new AudioContext();
    createNote(ctx, 830.61, 0, 0.4, 0.15, 'sine');     // bell
    createNote(ctx, 415.30, 0.3, 0.12, 0.1, 'triangle'); // soft low
    createNote(ctx, 622.25, 0.42, 0.25, 0.2, 'triangle'); // rising
  } catch {}
}

/** Task complete – 5-note triumphant chord (C5→E5→G5→B5→C6) */
export function playCompleteSound() {
  try {
    const ctx = new AudioContext();
    const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
    notes.forEach((freq, i) => {
      createNote(ctx, freq, i * 0.1, 0.3, 0.25, 'triangle');
    });
    // Sustained chord
    notes.forEach((freq) => {
      createNote(ctx, freq, 0.5, 0.6, 0.12, 'sine');
    });
  } catch {}
}
