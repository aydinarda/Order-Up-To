import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't reliably expose Web Storage here and Node 22+ ships an
// experimental global `localStorage` that is unavailable. Install a small
// in-memory implementation so app code using bare `localStorage` works.
class MemoryStorage {
  #store = new Map();

  get length() {
    return this.#store.size;
  }

  getItem(key) {
    return this.#store.has(key) ? this.#store.get(key) : null;
  }

  setItem(key, value) {
    this.#store.set(String(key), String(value));
  }

  removeItem(key) {
    this.#store.delete(String(key));
  }

  clear() {
    this.#store.clear();
  }

  key(index) {
    return Array.from(this.#store.keys())[index] ?? null;
  }
}

for (const name of ["localStorage", "sessionStorage"]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: new MemoryStorage()
  });
}

// Unmount React trees and reset jsdom between tests.
afterEach(() => {
  cleanup();
});
