import test from "node:test";
import assert from "node:assert/strict";

// Exercise UI lifecycle independently of worker timing and the browser's event queue.
test("ZIP analysis is cancelled on close or replacement and ignores stale results", async () => {
  class Element {
    constructor() {
      this.listeners = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.dataset = {};
      this.children = [];
      this.textContent = "";
    }
    addEventListener(type, callback) {
      this.listeners[type] = callback;
    }
    dispatch(type, event = {}) {
      this.listeners[type]?.(event);
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    setAttribute() {}
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const opener = new Element();
  const workers = [];
  class FakeWorker {
    constructor() {
      workers.push(this);
    }
    postMessage(file) {
      this.file = file;
    }
    terminate() {
      this.terminated = true;
    }
  }
  globalThis.document = {
    getElementById: get,
    createElement: () => new Element(),
    querySelectorAll: () => [opener],
  };
  globalThis.Worker = FakeWorker;
  try {
    await import("../public/zip-ui.js");
    const choose = (name) => {
      get("zip-file").files = [new File([], name)];
      get("zip-file").dispatch("change");
    };
    opener.dispatch("click");
    choose("first.zip");
    get("zip-close").dispatch("click");
    assert.equal(workers[0].terminated, true);
    assert.equal(get("zip-dialog").open, false);
    workers[0].onmessage({ data: { error: "stale" } });
    assert.equal(get("zip-error").textContent, "");

    opener.dispatch("click");
    choose("first.zip");
    choose("second.zip");
    assert.equal(workers[1].terminated, true);
    workers[1].onmessage({ data: { error: "stale" } });
    assert.equal(get("zip-error").textContent, "");
    workers[2].onmessage({
      data: {
        result: {
          images: [{ path: "plex.png", size: "512x512", bytes: 33, app: "plex", category: "apps" }],
          skipped: [],
        },
      },
    });
    assert.equal(workers[2].terminated, true);
    assert.match(get("zip-summary").textContent, /^1 giltiga PNG/);
    assert.equal(get("zip-upload").disabled, false);
  } finally {
    delete globalThis.document;
    delete globalThis.Worker;
  }
});
