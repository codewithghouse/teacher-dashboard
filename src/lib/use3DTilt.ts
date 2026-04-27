import type React from "react";

/**
 * 3D tilt hover handlers for cards. Attach via
 * `onMouseEnter/onMouseMove/onMouseLeave`.
 *
 * On hover, the card lifts (translateY + slight scale) AND the
 * `box-shadow` intensifies into a blue halo around the card.
 *
 * Usage:
 *   <div {...tilt3D} style={{ boxShadow: BLUE_SHADOW_LG, ...tilt3DStyle }}>
 *
 * The base `boxShadow` you pass on the card is remembered on mouse-enter
 * and restored on leave — no cursor-tracking overlay needed.
 */
type TiltEl = HTMLElement;

// Stored per-element so we can restore the original shadow on leave.
const ORIGINAL_SHADOW = new WeakMap<HTMLElement, string>();

// Soft blue hover halo — matches principal dashboard's signature.
const HOVER_SHADOW =
  "0 0 0 0.5px rgba(0,85,255,0.14)," +
  " 0 8px 24px rgba(0,85,255,0.16)," +
  " 0 20px 46px rgba(0,85,255,0.18)";

// Helper: set inline style with `!important` priority so it wins over any
// stylesheet rule (including our global `!important` hover rules).
const setImp = (el: HTMLElement, prop: string, val: string) => {
  el.style.setProperty(prop, val, "important");
};

// ── Default: Dashboard-style pop (lift + slight grow) ──────────────────
// Scale uses ease-out-expo (`cubic-bezier(0.16, 1, 0.3, 1)`) — front-loaded
// deceleration so the grow settles cleanly without mid-animation stutter.
// Box-shadow uses a gentler ease so it tracks the lift without lagging.
// Scale held to 1.015 (not 1.02) — smaller delta reads as smoother.
const SCALE_EASE  = "cubic-bezier(0.16, 1, 0.3, 1)";
const SHADOW_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const ENTER_MS = 550;
const LEAVE_MS = 650;

export const tilt3D = {
  onMouseEnter: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    if (!ORIGINAL_SHADOW.has(el)) {
      ORIGINAL_SHADOW.set(el, el.style.boxShadow);
    }
    el.style.backfaceVisibility = "hidden";
    (el.style as any).webkitBackfaceVisibility = "hidden";
    el.style.transformOrigin = "center center";
    setImp(el, "transition", `transform ${ENTER_MS}ms ${SCALE_EASE}, box-shadow ${ENTER_MS - 100}ms ${SHADOW_EASE}`);
    setImp(el, "transform", "translate3d(0,-5px,0)");
    setImp(el, "box-shadow", HOVER_SHADOW);
    setImp(el, "z-index", "3");
  },
  onMouseMove: (_e: React.MouseEvent<TiltEl>) => {
    // no-op — no cursor-tracking tilt on regular cards
  },
  onMouseLeave: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    setImp(el, "transition", `transform ${LEAVE_MS}ms ${SCALE_EASE}, box-shadow ${LEAVE_MS - 100}ms ${SHADOW_EASE}`);
    setImp(el, "transform", "translate3d(0,0,0)");
    const orig = ORIGINAL_SHADOW.get(el);
    if (orig !== undefined && orig !== "") {
      setImp(el, "box-shadow", orig);
    } else {
      el.style.removeProperty("box-shadow");
    }
    el.style.removeProperty("z-index");
  },
};

// ── Profile variant: stronger pop ──────────────────────────────────────
export const tilt3DProfile = {
  onMouseEnter: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    if (!ORIGINAL_SHADOW.has(el)) {
      ORIGINAL_SHADOW.set(el, el.style.boxShadow);
    }
    el.style.backfaceVisibility = "hidden";
    (el.style as any).webkitBackfaceVisibility = "hidden";
    el.style.transformOrigin = "center center";
    setImp(el, "transition", `transform ${ENTER_MS}ms ${SCALE_EASE}, box-shadow ${ENTER_MS - 100}ms ${SHADOW_EASE}`);
    setImp(el, "transform", "translate3d(0,-7px,0)");
    setImp(el, "box-shadow", HOVER_SHADOW);
    setImp(el, "z-index", "3");
  },
  onMouseMove: (_e: React.MouseEvent<TiltEl>) => {},
  onMouseLeave: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    setImp(el, "transition", `transform ${LEAVE_MS}ms ${SCALE_EASE}, box-shadow ${LEAVE_MS - 100}ms ${SHADOW_EASE}`);
    setImp(el, "transform", "translate3d(0,0,0)");
    const orig = ORIGINAL_SHADOW.get(el);
    if (orig !== undefined && orig !== "") {
      setImp(el, "box-shadow", orig);
    } else {
      el.style.removeProperty("box-shadow");
    }
    el.style.removeProperty("z-index");
  },
};

/** Style fragment to spread on the card's `style` prop.
 * backface-visibility + flat transform-style keep text perfectly crisp
 * whether the card is at rest or lifted. */
export const tilt3DStyle = {
  transformStyle: "flat" as const,
  backfaceVisibility: "hidden" as const,
  WebkitBackfaceVisibility: "hidden" as const,
};

// ── Canonical blue-halo card shadows (principal dashboard signature) ────────
export const BLUE_SHADOW =
  "0 0 0 0.5px rgba(0,85,255,0.09), " +
  "0 2px 10px rgba(0,85,255,0.10), " +
  "0 10px 26px rgba(0,85,255,0.12)";

export const BLUE_SHADOW_LG =
  "0 0 0 0.5px rgba(0,85,255,0.10), " +
  "0 4px 16px rgba(0,85,255,0.12), " +
  "0 18px 44px rgba(0,85,255,0.15)";

export const BLUE_SHADOW_BTN =
  "0 5px 18px rgba(0,85,255,0.34), " +
  "0 2px 5px rgba(0,85,255,0.18)";
