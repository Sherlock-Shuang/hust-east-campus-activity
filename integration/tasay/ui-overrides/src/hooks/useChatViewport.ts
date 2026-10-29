import { useEffect } from "react";

/** Fit the fixed chat shell to the visible screen without disabling pinch zoom. */
export function useChatViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const properties = ["--chat-viewport-height", "--chat-viewport-top"];
    const previous = properties.map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
    const previousKeyboard = root.dataset.chatKeyboard;
    const windows: Window[] = [window];
    const frames: { child: Window; element: HTMLElement }[] = [];
    let current: Window = window;
    // An iframe's own visualViewport normally still reports its full layout
    // height. Same-origin hosts expose the part actually above their keyboard.
    try {
      while (current.parent !== current && windows.length < 8) {
        const element = current.frameElement as HTMLElement | null;
        const parent = current.parent;
        if (!element || !parent.document.documentElement) break;
        frames.push({ child: current, element });
        windows.push(parent);
        current = parent;
      }
    } catch { /* Cross-origin hosts: use this document's available viewport. */ }

    let frame = 0, disposed = false, baselineHeight = 0;
    let layoutWidth = windows[windows.length - 1].innerWidth;
    const timers = new Set<number>();
    const cleanups: (() => void)[] = [];
    const ownBounds = (win: Window, visual: boolean) => {
      const viewport = visual ? win.visualViewport : null;
      const top = Math.max(0, viewport?.offsetTop ?? 0);
      return { top, bottom: top + (viewport?.height ?? win.innerHeight) };
    };
    const visibleBounds = (visual: boolean) => {
      let bounds = ownBounds(windows[windows.length - 1], visual);
      for (let i = frames.length - 1; i >= 0; i--) {
        const { child, element } = frames[i], rect = element.getBoundingClientRect();
        const scale = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1;
        if (!(scale > 0)) return { top: 0, bottom: 0 };
        const contentTop = rect.top + element.clientTop * scale;
        const own = ownBounds(child, visual);
        bounds = {
          top: Math.max(own.top, (bounds.top - contentTop) / scale),
          bottom: Math.min(own.bottom, (bounds.bottom - contentTop) / scale),
        };
      }
      return bounds;
    };
    const isEditing = () => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (active instanceof HTMLTextAreaElement) return !active.disabled && !active.readOnly && active.inputMode !== "none";
      if (active instanceof HTMLInputElement) return !active.disabled && !active.readOnly && active.inputMode !== "none" && /^(text|search|email|url|tel|password|number)$/.test(active.type);
      return active instanceof HTMLElement && active.isContentEditable === true && active.getAttribute("inputmode") !== "none";
    };
    const measure = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed) return;
        const editing = isEditing();
        if (!editing) root.dataset.chatKeyboard = "false";
        // Zoom changes the visible rectangle too. Keep the last layout while
        // zooming, so users can magnify and pan instead of shrinking the chat.
        if (windows.some(win => Math.abs((win.visualViewport?.scale ?? 1) - 1) > .01)) return;
        const width = windows[windows.length - 1].innerWidth;
        if (Math.abs(width - layoutWidth) > 40) baselineHeight = 0;
        layoutWidth = width;
        const bounds = visibleBounds(true), height = bounds.bottom - bounds.top;
        if (!Number.isFinite(height) || height <= 0) return;
        const layout = visibleBounds(false), layoutHeight = layout.bottom - layout.top;
        if (!editing || baselineHeight === 0) baselineHeight = height;
        root.dataset.chatKeyboard = String(editing && Math.max(baselineHeight, layoutHeight) - height > 120);
        const values = [height, bounds.top];
        properties.forEach((name, index) => {
          const value = `${Math.round(values[index] * 100) / 100}px`;
          if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
        });
      });
    };
    // Focus and rotation events can precede Safari's final keyboard pan. Keep
    // bounded settling checks, without scrolling the page or stealing focus.
    const settle = () => {
      timers.forEach(id => window.clearTimeout(id)); timers.clear();
      measure();
      for (const delay of [250, 600]) {
        const id = window.setTimeout(() => { timers.delete(id); measure(); }, delay);
        timers.add(id);
      }
    };
    const rotate = () => { baselineHeight = 0; settle(); };
    const listen = (target: EventTarget | null | undefined, type: string, listener: () => void, capture = false) => {
      target?.addEventListener(type, listener, capture);
      if (target) cleanups.push(() => target.removeEventListener(type, listener, capture));
    };
    for (const win of windows) {
      listen(win.visualViewport, "resize", measure);
      listen(win.visualViewport, "scroll", measure);
      listen(win, "resize", measure);
      listen(win, "scroll", measure, win !== window);
      listen(win, "orientationchange", rotate);
      listen(win.screen?.orientation, "change", rotate);
    }
    listen(document, "focusin", settle);
    listen(document, "focusout", settle);
    listen(document, "visibilitychange", settle);
    listen(window, "pageshow", settle);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    frames.forEach(({ element }) => observer?.observe(element));
    measure();
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      timers.forEach(id => window.clearTimeout(id));
      cleanups.forEach(cleanup => cleanup()); observer?.disconnect();
      previous.forEach(([name, value, priority]) => {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      });
      if (previousKeyboard === undefined) delete root.dataset.chatKeyboard;
      else root.dataset.chatKeyboard = previousKeyboard;
    };
  }, []);
}
