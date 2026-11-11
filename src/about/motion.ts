import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { startBackground } from "./background";

gsap.registerPlugin(ScrollTrigger);

type MotionOptions = {
  canvas: HTMLCanvasElement | null;
  lowPower: boolean;
  onIntroDone: () => void;
};

const DIGITS = "0123456789";

function flip(el: HTMLElement, delay = 0) {
  const final = el.dataset.numeral ?? "";
  const cells = Array.from(el.children) as HTMLElement[];
  const state = { t: 0 };
  return gsap.to(state, {
    t: 1,
    duration: 0.9,
    delay,
    ease: "steps(18)",
    onUpdate() {
      cells.forEach((cell, i) => {
        // Each cell settles a little later than the one to its left.
        const settle = 0.55 + i * 0.25;
        cell.textContent =
          state.t >= settle ? final[i] : DIGITS[Math.floor(Math.random() * DIGITS.length)];
      });
    },
    onComplete() {
      cells.forEach((cell, i) => (cell.textContent = final[i]));
    },
  });
}

export function initMotion(root: HTMLElement, { canvas, lowPower, onIntroDone }: MotionOptions) {
  const cleanups: (() => void)[] = [];
  const bg = canvas ? startBackground(canvas, lowPower) : null;
  if (bg) cleanups.push(bg.destroy);

  const lenis = new Lenis({ lerp: 0.11 });
  lenis.on("scroll", ScrollTrigger.update);
  const tickLenis = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tickLenis);
  gsap.ticker.lagSmoothing(0);
  cleanups.push(() => {
    gsap.ticker.remove(tickLenis);
    lenis.destroy();
  });

  const fine = window.matchMedia("(pointer: fine)").matches;
  const reticle = root.querySelector<HTMLElement>(".ab-reticle");
  if (fine && reticle) {
    root.classList.add("has-reticle");
    const xTo = gsap.quickTo(reticle, "x", { duration: 0.18, ease: "power3.out" });
    const yTo = gsap.quickTo(reticle, "y", { duration: 0.18, ease: "power3.out" });
    const snap = 8;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      reticle.style.opacity = "1";
      xTo(Math.round(e.clientX / snap) * snap);
      yTo(Math.round(e.clientY / snap) * snap);
      const overLink = (e.target as Element | null)?.closest?.("a, button");
      reticle.classList.toggle("is-link", Boolean(overLink));
    };
    const onLeave = () => (reticle.style.opacity = "0");
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    cleanups.push(() => {
      root.classList.remove("has-reticle");
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    });
  }

  const ctx = gsap.context(() => {
    // Intro: the 64 squares assemble into a board, then fall away.
    const intro = root.querySelector<HTMLElement>("[data-intro]");
    const page = gsap.timeline({ paused: true });
    page
      .from(".ab-hero-title .ab-line > span", {
        yPercent: 108,
        duration: 1.1,
        ease: "expo.out",
        stagger: 0.07,
      })
      .from(".ab-top", { clipPath: "inset(0 100% 0 0)", duration: 0.8, ease: "power2.inOut" }, 0.1)
      .from(".ab-hero .ab-vlabel", { clipPath: "inset(0 0 100% 0)", duration: 0.7, ease: "steps(8)" }, 0.2)
      .from(".ab-hero-aside", { x: 40, autoAlpha: 0, duration: 0.9, ease: "power3.out" }, 0.45);

    if (intro) {
      lenis.stop();
      const squares = intro.querySelectorAll(".ab-intro-grid span");
      const tl = gsap.timeline({
        onComplete: () => {
          lenis.start();
          onIntroDone();
        },
      });
      tl.from(squares, {
        scale: 0,
        duration: 0.32,
        ease: "back.out(2)",
        stagger: { each: 0.008, grid: [8, 8], from: "random" },
      })
        .to(squares, {
          yPercent: 120,
          autoAlpha: 0,
          duration: 0.4,
          ease: "power3.in",
          stagger: { each: 0.006, grid: [8, 8], from: "end" },
        }, "+=0.08")
        .to(intro, { autoAlpha: 0, duration: 0.25, ease: "none" }, "-=0.2")
        .add(() => void page.play(), "-=0.3");

      const skip = () => tl.progress(1);
      const skipButton = intro.querySelector("[data-intro-skip]");
      window.addEventListener("keydown", skip, { once: true });
      intro.addEventListener("click", skip, { once: true });
      skipButton?.addEventListener("click", skip, { once: true });
      cleanups.push(() => window.removeEventListener("keydown", skip));
    } else {
      page.play();
    }

    // Section headings: masked lines that wipe up with a heavier in-out curve.
    gsap.utils.toArray<HTMLElement>(".ab-timeline-title, .ab-me-title, .ab-contact-title").forEach((h) => {
      gsap.from(h.querySelectorAll(".ab-line > span"), {
        yPercent: 105,
        duration: 1,
        ease: "power4.inOut",
        stagger: 0.09,
        scrollTrigger: { trigger: h, start: "top 85%" },
      });
    });

    gsap.utils.toArray<HTMLElement>(".ab-colophon [data-reveal='row']").forEach((row, i) => {
      gsap.from(row, {
        clipPath: "inset(0 100% 0 0)",
        duration: 0.6,
        delay: (i % 4) * 0.05,
        ease: "power1.inOut",
        scrollTrigger: { trigger: row, start: "top 92%" },
      });
    });

    gsap.from(".ab-photo", {
      clipPath: "inset(100% 0 0 0)",
      duration: 1.3,
      ease: "expo.inOut",
      scrollTrigger: { trigger: ".ab-me", start: "top 75%" },
    });
    gsap.from(".ab-me-text [data-reveal='body']", {
      y: 18,
      autoAlpha: 0,
      duration: 0.8,
      ease: "sine.out",
      stagger: 0.08,
      scrollTrigger: { trigger: ".ab-me-text", start: "top 80%" },
    });
    gsap.from(".ab-contact-links li", {
      x: -24,
      autoAlpha: 0,
      duration: 0.7,
      ease: "circ.out",
      stagger: 0.1,
      scrollTrigger: { trigger: ".ab-contact-links", start: "top 90%" },
    });

    const mm = gsap.matchMedia();
    const section = root.querySelector<HTMLElement>(".ab-timeline")!;
    const track = root.querySelector<HTMLElement>(".ab-track")!;
    const stops = gsap.utils.toArray<HTMLElement>(".ab-stop");
    const scannerStop = stops[3];

    mm.add("(min-width: 901px)", () => {
      const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
      const horizontal = gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: section,
          pin: true,
          start: "top top",
          end: () => `+=${distance()}`,
          scrub: 0.8,
          invalidateOnRefresh: true,
          onUpdate(self) {
            if (!bg) return;
            const p = self.progress;
            const d = distance() || 1;
            const scanIn = (scannerStop.offsetLeft - window.innerWidth * 0.9) / d;
            const scanOut = (scannerStop.offsetLeft - window.innerWidth * 0.25) / d;
            const unwarp = gsap.utils.clamp(0, 1, (p - scanIn) / (scanOut - scanIn));
            const warmUp = gsap.utils.clamp(0, 1, p / Math.max(scanIn, 0.01));
            bg.controls.unwarp = p > scanOut ? 1 : unwarp;
            bg.controls.tilt = 0.08 + warmUp * 0.42;
            bg.controls.rotate = -0.03 - warmUp * 0.22;
            bg.controls.shift = -p * 900;
          },
          onLeaveBack() {
            if (!bg) return;
            bg.controls.unwarp = 0;
            bg.controls.tilt = 0.08;
            bg.controls.rotate = 0;
            bg.controls.shift = 0;
          },
        },
      });

      stops.forEach((stop) => {
        const numeral = stop.querySelector<HTMLElement>("[data-numeral]");
        ScrollTrigger.create({
          trigger: stop,
          containerAnimation: horizontal,
          start: "left 85%",
          once: true,
          onEnter: () => numeral && flip(numeral),
        });
        gsap.from(stop.querySelector("h3"), {
          clipPath: "inset(0 0 100% 0)",
          y: 24,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: stop, containerAnimation: horizontal, start: "left 80%" },
        });
        gsap.from(stop.querySelectorAll("[data-reveal='body']"), {
          autoAlpha: 0,
          x: 30,
          duration: 1,
          ease: "power2.out",
          stagger: 0.12,
          scrollTrigger: { trigger: stop, containerAnimation: horizontal, start: "left 75%" },
        });
        gsap.from(stop.querySelector(".ab-visual"), {
          clipPath: "inset(0 0 0 100%)",
          duration: 1.1,
          ease: "expo.out",
          scrollTrigger: { trigger: stop, containerAnimation: horizontal, start: "left 70%" },
        });
      });
    });

    mm.add("(max-width: 900px)", () => {
      stops.forEach((stop) => {
        const numeral = stop.querySelector<HTMLElement>("[data-numeral]");
        ScrollTrigger.create({
          trigger: stop,
          start: "top 85%",
          once: true,
          onEnter: () => numeral && flip(numeral),
        });
        gsap.from(stop.querySelectorAll("h3, [data-reveal='body']"), {
          y: 20,
          autoAlpha: 0,
          duration: 0.7,
          ease: "power2.out",
          stagger: 0.08,
          scrollTrigger: { trigger: stop, start: "top 80%" },
        });
      });
      if (bg) {
        ScrollTrigger.create({
          trigger: scannerStop,
          start: "top 90%",
          end: "top 30%",
          scrub: true,
          onUpdate(self) {
            bg.controls.unwarp = self.progress;
          },
        });
        ScrollTrigger.create({
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          onUpdate(self) {
            bg.controls.tilt = 0.08 + Math.min(1, self.progress * 2) * 0.35;
            bg.controls.rotate = -self.progress * 0.2;
          },
        });
      }
    });
  }, root);

  const refresh = () => ScrollTrigger.refresh();
  if (document.fonts?.ready) void document.fonts.ready.then(refresh);
  window.addEventListener("load", refresh);
  cleanups.push(() => window.removeEventListener("load", refresh));

  return () => {
    ctx.revert();
    cleanups.forEach((fn) => fn());
  };
}
