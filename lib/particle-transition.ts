"use client";

import { flushSync } from "react-dom";

type Pixel = { x: number; y: number; r: number; g: number; b: number };
type Particle = { from: Pixel; to: Pixel; burstX: number; burstY: number; targetCenterX: number; targetCenterY: number; curve: number; size: number; collapse: boolean };
type Capture = { canvas: HTMLCanvasElement; rect: DOMRect };
type ParticleGroup = { start: number; count: number; bounds: DOMRect; limit: number };

const pairs = [
  { from: ".setup-title", to: ".persona-ring", limit: 680 },
  { from: ".name-field", to: ".conversation-intro h1", limit: 400, collapse: true },
  { from: ".setup-continue-button", to: ".call-start-button, .call-control-row", limit: 420 },
];

let imageModule: Promise<typeof import("html-to-image")> | null = null;
let setupCapture: Capture | null = null;
let setupCaptureVersion = 0;

export async function transitionDeadline<T>(task: Promise<T>, timeoutMs = 1800): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Transition capture timed out")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function prepareParticleTransition(root?: HTMLElement) {
  imageModule ??= import("html-to-image");
  const image = await imageModule;
  if (root) {
    const version = ++setupCaptureVersion;
    root.getAnimations().forEach((animation) => animation.finish());
    await document.fonts.ready;
    const canvas = await image.toCanvas(root, { backgroundColor: "#fff", pixelRatio: 1 });
    if (version === setupCaptureVersion) setupCapture = { canvas, rect: root.getBoundingClientRect() };
  }
  return image;
}

function patchCurrentInput(capture: Capture, root: HTMLElement): Capture {
  const field = root.querySelector<HTMLElement>(".name-field");
  const input = field?.querySelector("input");
  if (!field || !input) return capture;

  const canvas = document.createElement("canvas");
  canvas.width = capture.canvas.width;
  canvas.height = capture.canvas.height;
  const context = canvas.getContext("2d");
  if (!context) return capture;
  context.drawImage(capture.canvas, 0, 0);

  const scaleX = canvas.width / capture.rect.width;
  const scaleY = canvas.height / capture.rect.height;
  const fieldBounds = field.getBoundingClientRect();
  const inputBounds = input.getBoundingClientRect();
  const fieldStyle = getComputedStyle(field);
  const inputStyle = getComputedStyle(input);
  const placeholderStyle = getComputedStyle(input, "::placeholder");
  const left = (fieldBounds.left - capture.rect.left) * scaleX;
  const top = (fieldBounds.top - capture.rect.top) * scaleY;
  const width = fieldBounds.width * scaleX;
  const height = fieldBounds.height * scaleY;

  context.fillStyle = "#fff";
  context.fillRect(left, top, width, height);
  context.fillStyle = input.value ? inputStyle.color : placeholderStyle.color;
  context.font = `${inputStyle.fontWeight} ${inputStyle.fontSize} ${inputStyle.fontFamily}`;
  context.textBaseline = "top";
  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  context.fillText(
    input.value || input.placeholder,
    (inputBounds.left - capture.rect.left) * scaleX,
    (inputBounds.top - capture.rect.top + 2) * scaleY,
    width,
  );
  context.restore();
  const borderWidth = Number.parseFloat(fieldStyle.borderBottomWidth) * scaleY;
  context.fillStyle = fieldStyle.borderBottomColor;
  context.fillRect(left, top + height - borderWidth, width, borderWidth);
  return { canvas, rect: capture.rect };
}

function ease(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function sample(capture: Capture, bounds: DOMRect, limit: number): Pixel[] {
  const context = capture.canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const { width, height } = capture.canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  const left = Math.max(0, Math.floor(bounds.left - capture.rect.left));
  const right = Math.min(width, Math.ceil(bounds.right - capture.rect.left));
  const top = Math.max(0, Math.floor(bounds.top - capture.rect.top));
  const bottom = Math.min(height, Math.ceil(bounds.bottom - capture.rect.top));
  const result: Pixel[] = [];
  let seen = 0;

  for (let y = top; y < bottom; y += 3) {
    for (let x = left; x < right; x += 3) {
      const offset = (y * width + x) * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      if (pixels[offset + 3] < 120 || r + g + b > 735) continue;
      const point = { x: x + capture.rect.left, y: y + capture.rect.top, r, g, b };
      seen += 1;
      if (result.length < limit) result.push(point);
      else {
        const replacement = Math.floor(Math.random() * seen);
        if (replacement < limit) result[replacement] = point;
      }
    }
  }

  for (let index = result.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(Math.random() * (index + 1));
    [result[index], result[replacement]] = [result[replacement], result[index]];
  }
  return result;
}

function buildParticles(oldCapture: Capture, oldBounds: DOMRect[], newBounds: DOMRect[]): { particles: Particle[]; groups: ParticleGroup[] } {
  const particles: Particle[] = [];
  const groups: ParticleGroup[] = [];
  pairs.forEach((pair, index) => {
    const oldPixels = sample(oldCapture, oldBounds[index], pair.limit);
    const centerX = oldBounds[index].left + oldBounds[index].width / 2;
    const centerY = oldBounds[index].top + oldBounds[index].height / 2;
    const targetCenterX = newBounds[index].left + newBounds[index].width / 2;
    const targetCenterY = newBounds[index].top + newBounds[index].height / 2;
    const start = particles.length;
    groups.push({ start, count: oldPixels.length, bounds: newBounds[index], limit: pair.limit });
    for (const from of oldPixels) {
      const to = { x: targetCenterX, y: targetCenterY, r: from.r, g: from.g, b: from.b };
      const collapse = pair.collapse === true;
      const burstX = collapse ? centerX + (Math.random() - .5) * 8 : from.x;
      const burstY = collapse ? centerY + (Math.random() - .5) * 8 : from.y;
      particles.push({
        from, to,
        burstX, burstY,
        targetCenterX,
        targetCenterY,
        curve: (Math.random() - .5) * 36,
        size: 2 + Math.random() * 1.6,
        collapse,
      });
    }
  });
  return { particles, groups };
}

function applyParticleTargets(particles: Particle[], groups: ParticleGroup[], capture: Capture) {
  for (const group of groups) {
    const targets = sample(capture, group.bounds, group.limit);
    const count = Math.min(group.count, targets.length);
    for (let index = 0; index < count; index += 1) {
      particles[group.start + index].to = targets[index];
    }
  }
}

function render(context: CanvasRenderingContext2D, oldCapture: Capture, newCapture: Capture | null, logoBounds: DOMRect, particles: Particle[], progress: number, targetBlend: number, width: number, height: number) {
  context.globalAlpha = 1;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  if (progress < .14) {
    context.globalAlpha = 1 - ease(progress / .14);
    context.drawImage(oldCapture.canvas, oldCapture.rect.left, oldCapture.rect.top);
  }
  if (newCapture && progress > .68) {
    context.globalAlpha = ease((progress - .68) / .2);
    context.drawImage(newCapture.canvas, newCapture.rect.left, newCapture.rect.top);
  }

  context.globalAlpha = 1;
  const padding = 4;
  context.drawImage(
    oldCapture.canvas,
    logoBounds.left - oldCapture.rect.left - padding,
    logoBounds.top - oldCapture.rect.top - padding,
    logoBounds.width + padding * 2,
    logoBounds.height + padding * 2,
    logoBounds.left - padding,
    logoBounds.top - padding,
    logoBounds.width + padding * 2,
    logoBounds.height + padding * 2,
  );

  const visibility = ease(progress / .08) * (1 - ease((progress - .89) / .11));
  context.globalAlpha = visibility;
  if (visibility <= 0) return;
  for (const particle of particles) {
    const sourceX = particle.collapse ? particle.burstX : particle.from.x;
    const sourceY = particle.collapse ? particle.burstY : particle.from.y;
    const motionStart = particle.collapse ? .12 : 0;
    const motion = ease((progress - motionStart) / (1 - motionStart));
    const destinationX = particle.targetCenterX + (particle.to.x - particle.targetCenterX) * targetBlend;
    const destinationY = particle.targetCenterY + (particle.to.y - particle.targetCenterY) * targetBlend;
    const dx = destinationX - sourceX;
    const dy = destinationY - sourceY;
    const length = Math.hypot(dx, dy) || 1;
    const x = sourceX + dx * motion - dy / length * particle.curve * Math.sin(Math.PI * motion);
    const y = sourceY + dy * motion + dx / length * particle.curve * Math.sin(Math.PI * motion);
    const colorProgress = motion;
    const contrast = 1 - .22 * Math.sin(Math.PI * progress);
    const r = Math.round((particle.from.r + (particle.to.r - particle.from.r) * colorProgress) * contrast);
    const g = Math.round((particle.from.g + (particle.to.g - particle.from.g) * colorProgress) * contrast);
    const b = Math.round((particle.from.b + (particle.to.b - particle.from.b) * colorProgress) * contrast);
    const size = particle.size * (.85 + .15 * colorProgress);
    context.fillStyle = `rgb(${r} ${g} ${b})`;
    context.fillRect(x - size / 2, y - size / 2, size, size);
  }
  context.globalAlpha = 1;
}

function fallback(continueToCall: () => void) {
  const start = document.startViewTransition;
  if (start) start.call(document, () => flushSync(continueToCall));
  else continueToCall();
}

export async function transitionToCall(continueToCall: () => void): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    continueToCall();
    return;
  }

  let committed = false;
  let overlay: HTMLCanvasElement | null = null;
  try {
    const oldRoot = document.querySelector<HTMLElement>(".setup-screen");
    if (!oldRoot) throw new Error("Setup screen is unavailable");
    oldRoot.getAnimations().forEach((animation) => animation.finish());
    const logoBounds = oldRoot.querySelector<HTMLElement>(".wordmark-link")?.getBoundingClientRect();
    if (!logoBounds) throw new Error("Persona logo is unavailable");
    const oldBounds = pairs.map(({ from }) => oldRoot.querySelector<HTMLElement>(from)?.getBoundingClientRect());
    if (oldBounds.some((bounds) => !bounds)) throw new Error("Setup elements are unavailable");
    const { toCanvas } = await transitionDeadline(prepareParticleTransition());
    const rootBounds = oldRoot.getBoundingClientRect();
    const cached = setupCapture;
    const cacheMatches = cached && cached.rect.width === rootBounds.width && cached.rect.height === rootBounds.height;
    const oldCapture = cacheMatches
      ? patchCurrentInput(cached, oldRoot)
      : { canvas: await transitionDeadline(toCanvas(oldRoot, { backgroundColor: "#fff", pixelRatio: 1 })), rect: rootBounds };
    const width = window.innerWidth;
    const height = window.innerHeight;
    overlay = document.createElement("canvas");
    overlay.width = width;
    overlay.height = height;
    overlay.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;pointer-events:auto;background:#fff";
    overlay.dataset.particleTransition = "active";
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);
    const context = overlay.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(oldCapture.canvas, oldCapture.rect.left, oldCapture.rect.top);

    committed = true;
    flushSync(continueToCall);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const newRoot = document.querySelector<HTMLElement>(".experience-screen");
    if (!newRoot) throw new Error("Conversation screen is unavailable");
    const newBounds = pairs.map(({ to }) => newRoot.querySelector<HTMLElement>(to)?.getBoundingClientRect());
    if (newBounds.some((bounds) => !bounds)) throw new Error("Conversation elements are unavailable");
    const { particles, groups } = buildParticles(oldCapture, oldBounds as DOMRect[], newBounds as DOMRect[]);
    if (particles.length < 100) throw new Error("Particle capture was incomplete");

    const started = performance.now();
    let newCapture: Capture | null = null;
    let targetsReadyAt: number | null = null;
    let progressAtReady = 0;
    let captureFailed = false;
    const capturePromise = transitionDeadline(toCanvas(newRoot, { backgroundColor: "#fff", pixelRatio: 1 }))
      .then((canvas) => {
        newCapture = { canvas, rect: newRoot.getBoundingClientRect() };
        applyParticleTargets(particles, groups, newCapture);
        targetsReadyAt = performance.now();
        progressAtReady = Math.min((targetsReadyAt - started) / 720, .5);
      })
      .catch(() => {
        captureFailed = true;
        targetsReadyAt = performance.now();
        progressAtReady = .45;
      });

    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const elapsed = now - started;
        const readyAt = targetsReadyAt;
        const progress = readyAt === null
          ? Math.min(elapsed / 720, .5)
          : progressAtReady + (1 - progressAtReady) * ease((now - readyAt) / Math.max(220, 720 - (readyAt - started)));
        const targetBlend = readyAt === null ? 0 : captureFailed ? 1 : ease((now - readyAt) / 140);
        render(context, oldCapture, newCapture, logoBounds, particles, progress, targetBlend, width, height);
        if (progress < 1 || readyAt === null) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    await capturePromise;
  } catch {
    if (!committed) fallback(continueToCall);
  } finally {
    overlay?.remove();
  }
}
