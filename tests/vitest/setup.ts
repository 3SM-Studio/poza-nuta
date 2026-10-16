import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Component tests render the same locale boundary as RootLayout. Tests can
// provide a nested EN provider to exercise the actual next-intl implementation.
vi.mock("@testing-library/react", async importOriginal => {
  const actual = await importOriginal<typeof import("@testing-library/react")>();
  const { createElement } = await import("react");
  const { NextIntlClientProvider } = await import("next-intl");
  const { default: messages } = await import("../../src/i18n/messages/pl.json");
  return {
    ...actual,
    render: ((ui: Parameters<typeof actual.render>[0], options?: Parameters<typeof actual.render>[1]) => {
      const Wrapper = options?.wrapper;
      function LocaleTestBoundary({ children }: { children: import("react").ReactNode }) {
        return createElement(NextIntlClientProvider, { locale: "pl", messages, timeZone: "Europe/Warsaw",
          children: Wrapper ? createElement(Wrapper, null, children) : children });
      }
      return actual.render(ui, { ...options, wrapper: LocaleTestBoundary });
    }) as typeof actual.render,
  };
});

class TestResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: TestResizeObserver,
  });
}

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect() {}
  observe(target: Element) {
    this.callback([], this);
    void target;
  }
  takeRecords() {
    return [];
  }
  unobserve() {}
}

if (!("IntersectionObserver" in globalThis)) {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: TestIntersectionObserver,
  });
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes("prefers-color-scheme: dark"),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
});
