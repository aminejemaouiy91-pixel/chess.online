/* sound.js — realistic chess sound effects, synthesized with Web Audio (no audio files).
   Piece sounds are built from a tiny contact "click" plus a resonant wood-like body,
   the way a real piece sounds hitting the board. Check/checkmate/draw use a bell-toll
   (a fundamental plus slightly inharmonic overtones that decay naturally), not a
   melodic jingle. */

const SFX = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function noiseBuffer(ac, duration) {
    const size = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buffer = ac.createBuffer(1, size, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /* A wood-like "knock": a hair-thin broadband click (the instant of contact) plus a
     short bandpass-filtered noise "ring" at a given pitch (the resonance of the
     piece/board). Two real, physical-feeling layers instead of a synth tone. */
  function knock({ pitch = 1100, q = 5, duration = 0.07, gain = 0.5, transientMix = 0.32, delay = 0 } = {}) {
    const ac = getCtx();
    if (!ac) return;
    const t0 = ac.currentTime + delay;

    // Transient: ~8ms of high-passed noise — the sharp "tick" of contact
    const click = ac.createBufferSource();
    click.buffer = noiseBuffer(ac, 0.008);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1600;
    const clickGain = ac.createGain();
    clickGain.gain.setValueAtTime(gain * transientMix, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.008);
    click.connect(hp).connect(clickGain).connect(ac.destination);
    click.start(t0);

    // Body: bandpass noise ringing at `pitch`, decaying — the wood/board resonance
    const ring = ac.createBufferSource();
    ring.buffer = noiseBuffer(ac, duration);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = pitch;
    bp.Q.value = q;
    const ringGain = ac.createGain();
    ringGain.gain.setValueAtTime(gain * (1 - transientMix), t0 + 0.002);
    ringGain.gain.exponentialRampToValueAtTime(0.0006, t0 + duration);
    ring.connect(bp).connect(ringGain).connect(ac.destination);
    ring.start(t0);
  }

  /* A real bell/gong has a fundamental plus a handful of *inharmonic* overtones that
     each decay at their own rate. This approximates that instead of a clean musical
     chord, so it reads as a physical toll rather than a game jingle. */
  function bellToll(freq, { duration = 0.9, gain = 0.18, delay = 0, partials = [1, 2.0, 2.76, 4.07] } = {}) {
    const ac = getCtx();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    partials.forEach((p, i) => {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * p, t0);
      const g = ac.createGain();
      const partGain = gain / (i + 1);
      const partDuration = duration / (1 + i * 0.35);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(partGain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0006, t0 + partDuration);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + partDuration + 0.08);
    });
  }

  return {
    /* light tap when a piece is picked up */
    select() {
      knock({ pitch: 2200, q: 8, duration: 0.02, gain: 0.14, transientMix: 0.55 });
    },
    /* a piece set down on an empty square */
    move() {
      knock({ pitch: 1100, q: 5, duration: 0.06, gain: 0.5, transientMix: 0.3 });
    },
    /* heavier double-contact knock for a capture */
    capture() {
      knock({ pitch: 750, q: 4, duration: 0.09, gain: 0.62, transientMix: 0.35 });
      knock({ pitch: 2400, q: 9, duration: 0.02, gain: 0.2, transientMix: 0.7, delay: 0.012 });
    },
    /* two knocks close together — king lands, then the rook */
    castle() {
      knock({ pitch: 1100, q: 5, duration: 0.06, gain: 0.48, transientMix: 0.3 });
      knock({ pitch: 1000, q: 5, duration: 0.06, gain: 0.4, transientMix: 0.3, delay: 0.11 });
    },
    /* the piece lands, plus a very short soft shimmer as it becomes a queen */
    promote() {
      knock({ pitch: 1100, q: 5, duration: 0.06, gain: 0.48, transientMix: 0.3 });
      bellToll(760, { duration: 0.3, gain: 0.09, delay: 0.05, partials: [1, 2] });
      bellToll(1015, { duration: 0.25, gain: 0.07, delay: 0.11, partials: [1, 2] });
    },
    /* a firm follow-up knock, same family as a normal move — signals check without
       switching to a different (bell) sound palette */
    check() {
      knock({ pitch: 1150, q: 6, duration: 0.055, gain: 0.55, transientMix: 0.35, delay: 0.09 });
    },
    /* end of game. 'checkmate' → a firm final knock and a low, grave toll.
       'win' (resignation/timeout) → a lighter knock and a brighter, shorter toll.
       'draw' → two flat, unresolved tones with no low toll. */
    gameEnd(kind) {
      if (kind === 'checkmate') {
        knock({ pitch: 550, q: 3, duration: 0.1, gain: 0.6, transientMix: 0.4 });
        bellToll(196, { duration: 1.7, gain: 0.22, delay: 0.06 });
      } else if (kind === 'win') {
        knock({ pitch: 900, q: 4, duration: 0.08, gain: 0.45, transientMix: 0.35 });
        bellToll(349, { duration: 0.9, gain: 0.15, delay: 0.05 });
      } else {
        bellToll(440, { duration: 0.5, gain: 0.11, partials: [1, 2.2] });
        bellToll(415, { duration: 0.5, gain: 0.09, delay: 0.14, partials: [1, 2.2] });
      }
    },
  };
})();

window.SFX = SFX;
