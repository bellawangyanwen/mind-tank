import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* ═══════════════════════════════════════════════════════════════
   ROOT BUG FIX NOTES:
   - Win95Dialog: removed inline transform from style (conflicts with
     Framer Motion's transform pipeline). Now uses top/left + marginLeft/marginTop.
   - alert state now stores fish.id, not the whole object, so it's
     always looked up live from fishes[] — no stale snapshot.
   - ✕ button no longer uses index check; has its own explicit handler.
   - Dialog z-index lifted to 9999 to clear all tank overlays.
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   GLOBAL STYLES
═══════════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #000;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    image-rendering: pixelated;
  }

  /* ── GameBoy dither water pattern ── */
  .dither-water {
    background-color: #000;
    background-image:
      radial-gradient(circle, #fff 1px, transparent 1px),
      radial-gradient(circle, #fff 1px, transparent 1px);
    background-size: 4px 4px;
    background-position: 0 0, 2px 2px;
    image-rendering: pixelated;
  }

  /* ── Heavy dither shadow (top-right spotlight) ── */
  .dither-light {
    background-image:
      radial-gradient(circle, #fff 1px, transparent 1px);
    background-size: 3px 3px;
    background-position: 0 0;
    image-rendering: pixelated;
  }

  /* ── Dither mid-shadow ── */
  .dither-shadow {
    background-image:
      radial-gradient(circle, #333 1px, transparent 1px),
      radial-gradient(circle, #333 1px, transparent 1px);
    background-size: 3px 3px;
    background-position: 0 0, 1.5px 1.5px;
    image-rendering: pixelated;
  }

  /* ── Concrete grain for bezel ── */
  .concrete-grain {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 180px 180px;
  }

  /* ── Pixel fish — no anti-aliasing ── */
  .pixel-fish {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  /* ── Fish swim bob ── */
  @keyframes fishBob {
    0%,100% { transform: translateY(0px); }
    50%      { transform: translateY(-3px); }
  }

  /* ── Tail wag (pixel steps) ── */
  @keyframes tailWagPixel {
    0%,100% { transform: translateX(0px); }
    33%     { transform: translateX(2px); }
    66%     { transform: translateX(-1px); }
  }

  /* ── Bubble rise ── */
  @keyframes bubbleRise {
    0%   { transform: translateY(0) translateX(0); opacity: 0; }
    8%   { opacity: 0.9; }
    90%  { opacity: 0.6; }
    100% { transform: translateY(-400px) translateX(var(--drift,8px)); opacity: 0; }
  }
  .bubble { animation: bubbleRise var(--bdur,6s) steps(60) infinite var(--bdelay,0s); }

  /* ── Flake fall ── */
  @keyframes flakeFall {
    0%   { transform: translateY(0) translateX(0); opacity: 1; }
    100% { transform: translateY(420px) translateX(var(--fdrift,15px)); opacity: 0; }
  }
  .flake { animation: flakeFall var(--fdur,4s) steps(40) forwards var(--fdelay,0s); }

  /* ── Happy fish idle pulse ── */
  @keyframes happyPulse {
    0%,100% { opacity: 0.55; }
    50%     { opacity: 0.85; }
  }
  .happy-fish { animation: happyPulse 3s steps(4) infinite; }

  /* ── Scan-line CRT overlay ── */
  .scanlines {
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.08) 2px,
      rgba(0,0,0,0.08) 4px
    );
    pointer-events: none;
  }

  /* Win95 button press */
  .w95btn:active {
    border-color: #555 #ddd #ddd #555 !important;
    transform: translate(1px,1px) !important;
  }

  input::placeholder { color: #555; }
`;

const TANK_W = 570;
const TANK_H = 400;

/* ═══════════════════════════════════════════════════════════════
   8-BIT PAC-MAN FISH SPRITE (pure SVG, pixel-art, no AA)
═══════════════════════════════════════════════════════════════ */
function PixelFishSprite({ color, flipped, bobPhase }) {
  // color: "#ffffff" for thought-fish, "#1A1A1A" for happy-fish
  const C = color;
  const eye = color === "#ffffff" ? "#000000" : "#555555";
  const mouthOpen = Math.sin(bobPhase * 2) > 0;

  return (
    <svg
      className="pixel-fish"
      width="32" height="20"
      viewBox="0 0 16 10"
      style={{
        transform: flipped ? "scaleX(-1)" : undefined,
        imageRendering: "pixelated",
        overflow: "visible",
        display: "block",
      }}
    >
      {/* ── TAIL (2-pixel chevron) ── */}
      <rect x="13" y="2"  width="2" height="2" fill={C}/>
      <rect x="13" y="6"  width="2" height="2" fill={C}/>
      <rect x="14" y="0"  width="2" height="2" fill={C}/>
      <rect x="14" y="8"  width="2" height="2" fill={C}/>

      {/* ── BODY (ellipse via rects) ── */}
      <rect x="2"  y="1"  width="11" height="8" fill={C}/>
      <rect x="1"  y="2"  width="1"  height="6" fill={C}/>
      <rect x="3"  y="0"  width="7"  height="1" fill={C}/>
      <rect x="3"  y="9"  width="7"  height="1" fill={C}/>

      {/* ── MOUTH (Pac-Man wedge) ── */}
      {mouthOpen ? (
        <>
          <rect x="0" y="3" width="3" height="2" fill={C}/>
          {/* open mouth — gap at y=5 row */}
        </>
      ) : (
        <>
          <rect x="0" y="3" width="3" height="4" fill={C}/>
        </>
      )}

      {/* ── EYE ── */}
      <rect x="4" y="2" width="2" height="2" fill={eye}/>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FISH ENTITY — rAF physics
═══════════════════════════════════════════════════════════════ */
function FishEntity({ fish, allRef, onClickFish }) {
  const posRef = useRef({ x: fish.x, y: fish.y });
  const velRef = useRef({ x: fish.vx, y: fish.vy });
  const rafRef = useRef(null);
  const lastRef = useRef(performance.now());
  const bobRef = useRef(0);

  const [renderPos, setRenderPos] = useState({ x: fish.x, y: fish.y });
  const [flipped, setFlipped] = useState(fish.vx > 0);
  const [bobPhase, setBobPhase] = useState(0);

  const FW = 32, FH = 20, PAD = 8;

  useEffect(() => {
    const step = (now) => {
      const dt = Math.min((now - lastRef.current) / 1000, 0.05);
      lastRef.current = now;

      bobRef.current += dt * 3;
      setBobPhase(bobRef.current);

      let { x, y } = posRef.current;
      let { x: vx, y: vy } = velRef.current;

      vx += (Math.random() - 0.5) * 0.06;
      vy += (Math.random() - 0.5) * 0.04;

      // Soft repulsion from neighbours
      for (const o of allRef.current) {
        if (o.id === fish.id) continue;
        const dx = o.x - x, dy = o.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 60 && d > 0) {
          vx -= (dx / d) * 0.015;
          vy -= (dy / d) * 0.010;
        }
      }

      const spd = Math.sqrt(vx * vx + vy * vy);
      const MAX = 1.1, MIN = 0.22;
      if (spd > MAX) { vx = (vx / spd) * MAX; vy = (vy / spd) * MAX; }
      if (spd < MIN && spd > 0) { vx = (vx / spd) * MIN; vy = (vy / spd) * MIN; }

      x += vx * 60 * dt;
      y += vy * 60 * dt;

      if (x < PAD)            { x = PAD;            vx =  Math.abs(vx) + 0.1; }
      if (x > TANK_W - FW - PAD) { x = TANK_W - FW - PAD; vx = -Math.abs(vx) - 0.1; }
      if (y < PAD)            { y = PAD;            vy =  Math.abs(vy) + 0.08; }
      if (y > TANK_H - FH - 44) { y = TANK_H - FH - 44; vy = -Math.abs(vy) - 0.08; }

      if (vx > 0.08) setFlipped(true);
      if (vx < -0.08) setFlipped(false);

      posRef.current = { x, y };
      velRef.current = { x: vx, y: vy };
      const idx = allRef.current.findIndex(f => f.id === fish.id);
      if (idx >= 0) { allRef.current[idx].x = x; allRef.current[idx].y = y; }
      setRenderPos({ x, y });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [fish.id]);

  const happy = fish.noteOpacity <= 0;
  const fishColor = "#ffffff";

  return (
    <div
      onClick={() => !happy && onClickFish(fish.id)}
      style={{
        position: "absolute",
        left: Math.round(renderPos.x),
        top:  Math.round(renderPos.y),
        cursor: happy ? "default" : "pointer",
        userSelect: "none",
        zIndex: 20,
        transform: `scale(2)`,
        transformOrigin: "top left",
        opacity: happy ? 0 : Math.max(0.15, fish.noteOpacity),
        imageRendering: "pixelated",
        pointerEvents: happy ? "none" : "auto",
        transition: "opacity 0.6s steps(6)",
      }}
    >
      <PixelFishSprite
        color={fishColor}
        flipped={flipped}
        bobPhase={bobPhase}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WIN 95 DIALOG — BUG-FIXED
   - No inline transform (conflicts with Framer Motion)
   - Uses position + margin trick for centering
   - alertFishId looked up live from fishes[] — never stale
   - ✕ has its own dedicated onClick, not an index comparison
═══════════════════════════════════════════════════════════════ */
function Win95Dialog({ fish, onClose }) {
  return (
    <motion.div
      key={fish.id + "-dialog"}
      initial={{ scale: 0.82, opacity: 0 }}
      animate={{ scale: 1,    opacity: 1 }}
      exit={{   scale: 0.82, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      style={{
        /* ── CENTERING: position absolute, percentage offsets + negative margin ── */
        position: "absolute",
        top: "50%",
        left: "50%",
        marginTop: -90,   /* half of approx dialog height */
        marginLeft: -159, /* half of dialog width (318/2) */
        zIndex: 9999,
        width: 318,
        fontFamily: "Tahoma, 'MS Sans Serif', sans-serif",
        fontSize: 12,
        background: "#c0c0c0",
        border: "2px solid",
        borderColor: "#ffffff #555555 #555555 #ffffff",
        boxShadow: "inset -1px -1px 0 #333, inset 1px 1px 0 #e8e8e8, 4px 5px 0 #000",
        imageRendering: "pixelated",
      }}
    >
      {/* ── Title bar ── */}
      <div style={{
        background: "linear-gradient(90deg, #000080, #1a5fc8)",
        padding: "3px 4px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        userSelect: "none",
      }}>
        <span style={{
          color: "#fff", fontSize: 11, fontWeight: "bold",
          fontFamily: "Tahoma", display: "flex", alignItems: "center", gap: 4,
        }}>
          📄 D:\MIND_FILE.TXT
        </span>

        {/* Window controls — each is its own button with explicit handler */}
        <div style={{ display: "flex", gap: 2 }}>
          <button style={{
            width: 16, height: 14, fontSize: 9, cursor: "pointer",
            background: "#c0c0c0",
            border: "1px solid", borderColor: "#fff #555 #555 #fff",
            fontFamily: "Tahoma", padding: 0, lineHeight: 1,
          }}>_</button>
          <button style={{
            width: 16, height: 14, fontSize: 9, cursor: "pointer",
            background: "#c0c0c0",
            border: "1px solid", borderColor: "#fff #555 #555 #fff",
            fontFamily: "Tahoma", padding: 0, lineHeight: 1,
          }}>□</button>
          {/* ✕ close — standalone onClick, not an index check */}
          <button
            onClick={onClose}
            style={{
              width: 16, height: 14, fontSize: 9, cursor: "pointer",
              background: "#c0c0c0",
              border: "1px solid", borderColor: "#fff #555 #555 #fff",
              fontFamily: "Tahoma", padding: 0, lineHeight: 1,
            }}
          >✕</button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "14px 12px 10px", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{
          width: 32, height: 32, flexShrink: 0, fontSize: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#c0c0c0",
          border: "2px solid", borderColor: "#555 #fff #fff #555",
        }}>ℹ</div>

        <div style={{ flex: 1 }}>
          <p style={{ color: "#000", lineHeight: 1.6, marginBottom: 8, wordBreak: "break-word", fontSize: 12 }}>
            {fish.text}
          </p>
          <p style={{
            fontSize: 9, color: "#444", fontFamily: "Courier New",
            marginBottom: 12, fontWeight: "bold",
            letterSpacing: "0.05em",
          }}>
            FEED TO FADE
          </p>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              onClick={onClose}
              className="w95btn"
              style={{
                fontFamily: "Tahoma", fontSize: 11,
                padding: "4px 28px",
                background: "#c0c0c0",
                border: "2px solid",
                borderColor: "#fff #555 #555 #fff",
                cursor: "pointer",
                boxShadow: "inset 1px 1px 0 #e8e8e8, inset -1px -1px 0 #888",
              }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════ */
let _palIdx = 0;
let _flakeKey = 0;

export default function MonochromeFishTank() {
  const [fishes,    setFishes]    = useState([]);
  const [flakes,    setFlakes]    = useState([]);
  const [input,     setInput]     = useState("");
  const [alertId,   setAlertId]   = useState(null); // ← stores fish.id, NOT the whole object
  const [feedPulse, setFeedPulse] = useState(false);
  const allRef = useRef([]);

  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  // Live lookup — never stale
  const alertFish = alertId !== null ? fishes.find(f => f.id === alertId) ?? null : null;

  const bubbles = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    id: i,
    left: 14 + Math.random() * (TANK_W - 28),
    size: 2 + Math.random() * 3,
    dur:  5 + Math.random() * 5,
    delay: i * 0.7 + Math.random() * 3,
    drift: (Math.random() - 0.5) * 28,
  })), []);

  const spawnFish = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const angle = Math.random() * Math.PI * 2;
    const spd   = 0.4 + Math.random() * 0.5;
    const fish  = {
      id: Date.now() + Math.random(),
      text,
      noteOpacity: 1,
      x:  40 + Math.random() * (TANK_W - 110),
      y:  30 + Math.random() * (TANK_H - 120),
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd * 0.35,
    };
    setFishes(f => [...f, fish]);
    allRef.current = [...allRef.current, { ...fish }];
    setInput("");
  }, [input]);

  const feedAll = useCallback(() => {
    setFishes(f => f.map(fish => ({
      ...fish,
      noteOpacity: Math.max(0, fish.noteOpacity - 0.2),
    })));
    allRef.current = allRef.current.map(f => ({
      ...f, noteOpacity: Math.max(0, f.noteOpacity - 0.2),
    }));

    // If the open dialog's fish just hit 0, close it
    setAlertId(prev => {
      if (prev === null) return null;
      const fish = allRef.current.find(f => f.id === prev);
      return (fish && fish.noteOpacity > 0) ? prev : null;
    });

    // Data-flakes (white pixels, varied sizes)
    const batch = Array.from({ length: 28 }, (_, i) => ({
      id: ++_flakeKey,
      left: 10 + Math.random() * (TANK_W - 20),
      dur:  2.5 + Math.random() * 2.5,
      delay: i * 0.06,
      drift: (Math.random() - 0.5) * 40,
      big: i % 5 === 0,
    }));
    setFlakes(fl => [...fl, ...batch]);
    setTimeout(() => setFlakes(fl => fl.filter(f => !batch.find(b => b.id === f.id))), 8000);

    setFeedPulse(true);
    setTimeout(() => setFeedPulse(false), 300);
  }, []);

  const onKey = (e) => { if (e.key === "Enter") spawnFish(); };

  // Close dialog if the fish became happy (auto-close after feed reaches 0)
  useEffect(() => {
    if (alertId === null) return;
    const fish = fishes.find(f => f.id === alertId);
    if (!fish || fish.noteOpacity <= 0) setAlertId(null);
  }, [fishes, alertId]);

  const happyCount  = fishes.filter(f => f.noteOpacity <= 0).length;
  const activeCount = fishes.length - happyCount;

  /* ── DITHER SHADOW CONFIG (top-right spotlight regions) ── */
  const ditherRegions = [
    { top:0,  right:0,  w:"55%", h:"38%", opacity:0.22, cls:"dither-light"  }, // bright spot
    { top:0,  left:0,   w:"30%", h:"55%", opacity:0.18, cls:"dither-shadow" }, // left shadow
    { bottom:0, left:0, w:"45%", h:"30%", opacity:0.22, cls:"dither-shadow" }, // bottom-left
    { bottom:0, right:0,w:"35%", h:"25%", opacity:0.16, cls:"dither-shadow" }, // bottom-right
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>

      {/* ══════════════════════════════════════════════
          CONCRETE MAC CHASSIS
      ══════════════════════════════════════════════ */}
      <div style={{
        position: "relative",
        width: 650,
        filter: "drop-shadow(4px 4px 0 #000) drop-shadow(8px 8px 0 rgba(0,0,0,0.5))",
      }}>
        <div
          className="concrete-grain"
          style={{
            position: "relative",
            width: "100%",
            borderRadius: 0,  // Sharp, angular — no soft rounding
            // Concrete grey, NO smooth gradients — flat sections with sharp borders
            background: "#888",
            // 2px hard black outlines everywhere (the "angular 2-pixel" spec)
            outline: "2px solid #000",
            boxShadow: [
              // Hard angular shadows — no blur radius (pixel-art shadow)
              "4px 4px 0 #000",
              "8px 8px 0 rgba(0,0,0,0.35)",
              // Inner panel edges
              "inset 2px 2px 0 #ccc",
              "inset -2px -2px 0 #444",
            ].join(", "),
            padding: "10px 26px 0 26px",
          }}
        >

          {/* Dither shadow/light overlays for spotlight effect */}
          {ditherRegions.map((r, i) => (
            <div key={i} className={r.cls} style={{
              position: "absolute",
              top: r.top, bottom: r.bottom,
              left: r.left, right: r.right,
              width: r.w, height: r.h,
              opacity: r.opacity,
              pointerEvents: "none",
              zIndex: 80,
            }}/>
          ))}

          {/* Concrete texture overlay */}
          <div className="concrete-grain" style={{
            position: "absolute", inset: 0,
            opacity: 0.12,
            mixBlendMode: "multiply",
            pointerEvents: "none",
            zIndex: 81,
          }}/>

          {/* Hard-light top edge */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2,
            background: "#ddd", pointerEvents: "none", zIndex: 82,
          }}/>
          <div style={{
            position: "absolute", top: 0, left: 0, bottom: 0, width: 2,
            background: "#ccc", pointerEvents: "none", zIndex: 82,
          }}/>

          {/* ── SCREEN BEZEL — 2px hard borders ── */}
          <div style={{
            width: TANK_W + 24,
            margin: "0 auto",
            padding: "8px 8px 6px",
            background: "#555",
            outline: "2px solid #000",
            boxShadow: [
              "inset 2px 2px 0 #333",
              "inset -2px -2px 0 #777",
            ].join(", "),
          }}>

            {/* ══════════════════════════════════════
                THE TANK
            ══════════════════════════════════════ */}
            <div style={{
              position: "relative",
              width: TANK_W, height: TANK_H,
              outline: "2px solid #000",
              overflow: "hidden",
              boxShadow: "inset 2px 2px 0 #000, inset -2px -2px 0 #222",
            }}>

              {/* ── DITHER WATER (GameBoy-style) ── */}
              <div className="dither-water" style={{
                position: "absolute", inset: 0,
              }}/>

              {/* Dark depth layer (bottom gets denser) */}
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                background: "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.0) 40%, rgba(0,0,0,0.55) 100%)",
              }}/>

              {/* ── GLASS GLARE — top-right, 20% opacity ── */}
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none", zIndex: 35,
                background: "linear-gradient(125deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 22%, transparent 40%)",
              }}/>
              {/* Hard glare line */}
              <div style={{
                position: "absolute", top: 6, left: "8%", width: "28%", height: 2,
                background: "rgba(255,255,255,0.55)",
                pointerEvents: "none", zIndex: 36,
              }}/>

              {/* Scan-lines over water */}
              <div className="scanlines" style={{ position:"absolute", inset:0, zIndex:32, pointerEvents:"none" }}/>

              {/* Bubbles (white dots, pixel-crisp) */}
              {bubbles.map(b => (
                <div key={b.id} className="bubble"
                  style={{
                    position: "absolute",
                    left: Math.round(b.left), bottom: 38,
                    width: Math.round(b.size), height: Math.round(b.size),
                    background: "#fff",
                    imageRendering: "pixelated",
                    pointerEvents: "none", zIndex: 18,
                    "--bdur":   `${b.dur}s`,
                    "--bdelay": `${b.delay}s`,
                    "--drift":  `${b.drift}px`,
                  }}
                />
              ))}

              {/* Data-flakes — animated food pellets with Framer Motion */}
              <AnimatePresence>
                {flakes.map(f => (
                  <motion.div
                    key={f.id}
                    initial={{ y: 0, x: 0, opacity: 1 }}
                    animate={{
                      y: TANK_H + 20,
                      x: [0, f.drift * 0.3, f.drift * 0.7, f.drift],
                      opacity: [1, 1, 0.7, 0],
                    }}
                    transition={{
                      duration: f.dur,
                    delay: f.delay,
                      ease: [0.2, 0, 0.8, 1],
                    }}
                    style={{
                      position: "absolute",
                      left: Math.round(f.left), top: 0,
                      width: f.big ? 4 : 2,
                      height: f.big ? 4 : 2,
                      background: "#fff",
                      imageRendering: "pixelated",
                      pointerEvents: "none", zIndex: 22,
                    }}
                  />
                ))}
              </AnimatePresence>

              {/* Gravel bed */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0, height: 44,
                zIndex: 30, pointerEvents: "none",
              }}>
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0, height: 22,
                  background: "#111",
                  outline: "2px solid #000",
                }}/>
                {/* Pixel pebbles */}
                {Array.from({ length: 40 }, (_, i) => (
                  <div key={i} style={{
                    position: "absolute",
                    bottom: 20 + (i % 3) * 4,
                    left: `${(i * 2.6) % 98}%`,
                    width: 4 + (i % 4) * 2, height: 4,
                    background: i % 3 === 0 ? "#fff" : i % 3 === 1 ? "#666" : "#333",
                    imageRendering: "pixelated",
                  }}/>
                ))}
                {/* Pixel RAM sticks */}
                {[20,90,170,250,330,410,490].map((lx, i) => (
                  <div key={i} style={{
                    position: "absolute", bottom: 22, left: lx,
                    width: 48 + (i % 3) * 8, height: 14,
                    background: "#222",
                    outline: "1px solid #000",
                  }}>
                    {Array.from({ length: 5 }, (_, j) => (
                      <div key={j} style={{
                        position: "absolute", top: 3, left: 4 + j * 9,
                        width: 4, height: 8, background: "#444",
                      }}/>
                    ))}
                  </div>
                ))}
              </div>

             {/* Empty state */}
              {fishes.length === 0 && (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  color: "#fff", fontFamily: "'VT323', monospace",
                  fontSize: 15, textAlign: "center", letterSpacing: "0.1em",
                  pointerEvents: "none", zIndex: 90,
                  imageRendering: "pixelated",
                  textShadow: `
                    2px 2px 0 #000, -2px -2px 0 #000, 
                    2px -2px 0 #000, -2px 2px 0 #000,
                    0px 2px 0 #000, 0px -2px 0 #000,
                    2px 0px 0 #000, -2px 0px 0 #000
                  `,
                }}>
                  <div style={{ marginBottom: 6, fontSize: 28, color: "#fff" }}>
                    &gt;_
                  </div>
                  TYPE A BURDEN. PRESS ENTER.<br/>RELEASE IT INTO THE DEEP.
                </div>
              )}
              {/* Fish layer */}
              <div style={{ position: "absolute", inset: 0, zIndex: 20 }}>
                {fishes.map(fish => (
                  <FishEntity
                    key={fish.id}
                    fish={fish}
                    allRef={allRef}
                    onClickFish={setAlertId}
                  />
                ))}
              </div>

              {/* ── WIN95 DIALOG — FIXED CLOSE ── */}
              <AnimatePresence>
                {alertFish && (
                  <Win95Dialog
                    fish={alertFish}
                    onClose={() => setAlertId(null)}
                  />
                )}
              </AnimatePresence>

            </div>{/* /tank */}
          </div>{/* /bezel */}

          {/* ── CHIN ── */}
          <div style={{
            padding: "16px 26px 14px",
            background: "#888",
            borderTop: "2px solid #000",
            boxShadow: "inset 0 2px 0 #aaa, inset 0 -2px 0 #555",
          }}>
            {/* Floppy + label + speaker */}
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:12 }}>
              <div style={{
                width: 64, height: 10,
                background: "#111",
                outline: "1px solid #000",
                boxShadow: "inset 1px 1px 0 #333",
              }}/>
              <div style={{ flex:1, textAlign:"center",
                fontFamily:"'Share Tech Mono', monospace", fontSize:8,
                letterSpacing:"0.28em", color:"#222", textTransform:"uppercase",
                userSelect:"none",
              }}>
                ✦ MIND·TANK ✦
              </div>
              {/* Speaker grille — pixel dots */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,5px)", gap:2 }}>
                {Array.from({ length:24 },(_,i)=>(
                  <div key={i} style={{ width:3,height:3, background:"#333" }}/>
                ))}
              </div>
            </div>

            {/* Input + Feed */}
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <div style={{
                flex:1, display:"flex", alignItems:"center", padding:"0 10px",
                background:"#000",
                outline:"2px solid #000",
                boxShadow:"inset 2px 2px 0 #222",
              }}>
                <span style={{
                  color:"#888", fontFamily:"'VT323',monospace",
                  fontSize:16, marginRight:6, userSelect:"none",
                }}>C:\&gt;</span>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="What is weighing on you?"
                  maxLength={120}
                  style={{
                    flex:1, background:"transparent", border:"none", outline:"none",
                    color:"#fff", fontFamily:"'VT323',monospace", fontSize:16,
                    letterSpacing:"0.04em", caretColor:"#fff", padding:"9px 0",
                    imageRendering:"pixelated",
                  }}
                />
              </div>

              {/* Win95 FEED FISH button */}
              <motion.button
                animate={feedPulse ? { x:[0,1,0], y:[0,1,0] } : {}}
                transition={{ duration:0.15 }}
                onClick={feedAll}
                disabled={fishes.length === 0}
                style={{
                  fontFamily:"Tahoma,'MS Sans Serif',sans-serif",
                  fontSize:11, fontWeight:"bold",
                  padding:"8px 16px",
                  background: fishes.length > 0 ? "#c0c0c0" : "#999",
                  border:"2px solid",
                  borderColor: fishes.length > 0
                    ? "#fff #333 #333 #fff"
                    : "#bbb #555 #555 #bbb",
                  borderRadius:0,
                  color: fishes.length > 0 ? "#000" : "#555",
                  cursor: fishes.length > 0 ? "pointer" : "default",
                  whiteSpace:"nowrap",
                  boxShadow: fishes.length > 0
                    ? "inset 1px 1px 0 #e8e8e8, inset -1px -1px 0 #888, 2px 2px 0 #000"
                    : "inset 1px 1px 0 #bbb, 1px 1px 0 #555",
                  letterSpacing:"0.02em",
                }}
              >
                Feed Fish
              </motion.button>
            </div>

            {/* Status */}
            <div style={{
              marginTop:8, display:"flex", justifyContent:"space-between",
              fontFamily:"'Share Tech Mono', monospace", fontSize:9,
              color:"#333", letterSpacing:"0.1em", textTransform:"uppercase",
            }}>
              <span>
                {fishes.length === 0
                  ? "TANK EMPTY"
                  : `${activeCount} HELD · ${happyCount} RELEASED`}
              </span>
              <span style={{ color:"#555" }}>ENTER ↵</span>
            </div>
          </div>

          {/* Base bar */}
          <div style={{
            height:16,
            background:"#666",
            outline:"2px solid #000",
            borderTop:"2px solid #000",
            display:"flex", justifyContent:"space-between", padding:"0 44px",
            boxShadow:"inset 0 1px 0 #999, inset 0 -1px 0 #333",
          }}>
            {[0,1].map(i=>(
              <div key={i} style={{
                width:40, height:"100%",
                background:"#444",
                outline:"1px solid #000",
              }}/>
            ))}
          </div>

        </div>{/* /chassis */}
      </div>{/* /outer */}

      {/* Hard pixel desk shadow */}
      <div style={{
        width:660, height:4, marginTop:0,
        background:"#000",
        opacity:0.6,
      }}/>
      <div style={{
        width:640, height:3, marginTop:0,
        background:"#000",
        opacity:0.25,
      }}/>

      {/* Bottom hint */}
      <div style={{
        marginTop:18, fontFamily:"'Share Tech Mono', monospace", fontSize:9,
        letterSpacing:"0.18em", textTransform:"uppercase", color:"#444",
      }}>
        CLICK A FISH · FEED TO FADE · GONE IS GONE
      </div>

    </div>
  );
}
