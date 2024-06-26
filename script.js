if (typeof browser == 'undefined') {
  globalThis.browser = chrome;
}

const AD_WORDS = [
  'ads?', // en
  'iklan', // id
  // add more if you see in your language
];
const rgxAdd = new RegExp(`^(${AD_WORDS.join('|')})$`, 'i');

const DB_KEY_CONFIG = 'config';
const DB_KEY_BLOCKED_COUNT = 'blockedCount';

class Blocker {
  static EVENT_POST_BLOCKED = 'BLOCKER_POST_BLOCKED';
  static EVENT_CONFIG_CHANGED = 'BLOCKER_CONFIG_CHANGED';

  #config;
  #domObserver;
  #eventBroker;

  constructor({ config = defaultConfig, eventBroker = new EventTarget() }) {
    this.#config = config;
    this.#iniConfig();
    this.#initEventBroker(eventBroker);
    this.start();
  }

  #initEventBroker(eventBroker) {
    this.#eventBroker = eventBroker;

    this.#eventBroker?.addEventListener(Blocker.EVENT_CONFIG_CHANGED, async (event) => {
      this.#log('blocker config changed');

      // activate/deactivate blocker
      if (this.#config?.isActive) {
        this.start();
      } else {
        this.stop();
      }

      if (this.#config?.isRestartAfterConfigChanged) this.restart();
    });

    this.#eventBroker?.addEventListener(Blocker.EVENT_POST_BLOCKED, async (event) => {
      this.#incBlockCount();
    });
  }

  getConfig() {
    return this.#config;
  }

  setConfig(config) {
    this.#iniConfig(config);
    this.#eventBroker?.dispatchEvent(
      new CustomEvent(Blocker.EVENT_CONFIG_CHANGED, { detail: { config: this.#config } }),
    );
  }

  #iniConfig(config) {
    this.#config = { ...this.#config, ...config };
    this.#config._rgxBlocked = new RegExp((this.#config?.blockedKeywords ?? []).join('|'), 'i');
  }

  restart() {
    this.#log('blocker observer restart...');
    this.stop();
    this.start();
    this.#log('blocker observer restarted');
  }

  start() {
    if (this.#isRunning()) return;
    this.#domObserver = new MutationObserver((mutations) => {
      this.#mutationObserverCallback(mutations);
    });
    this.#domObserver?.observe(document.body, { childList: true, subtree: true });
    this.#log('blocker observer started');
  }

  stop() {
    if (!this.#isRunning()) return;
    this.#domObserver?.disconnect();
    this.#domObserver = null;
    this.#log('blocker observer stopped');
  }

  #isRunning() {
    return !!this.#domObserver;
  }

  #mutationObserverCallback(mutations) {
    if (!this.#config?.isActive) return;

    for (let mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      for (let node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (!this.#isPostBlocked(node)) continue;

        // for now, set display to none
        // last time, removing node break the website
        node.style.display = 'none';
        this.#eventBroker?.dispatchEvent(new CustomEvent(Blocker.EVENT_POST_BLOCKED));
      }
    }
  }

  #isPostBlocked(element) {
    return this.#isPost(element) && this.#hasBlockedElement(element);
  }

  #isPost(element) {
    return element.getAttribute('data-testid') === 'cellInnerDiv';
  }

  #hasBlockedElement({ textContent, children }) {
    // ads
    if (this.#config?.isBlockAd && rgxAdd.test(textContent)) {
      this.#log('blocked ad:', textContent);
      return true;
    }

    // blocked keywords
    if (this.#config?.blockedKeywords?.length > 0 && this.#config?._rgxBlocked.test(textContent)) {
      this.#log('blocked keyword:', textContent);
      return true;
    }

    // find it inside the children
    for (const child of children) {
      if (!this.#hasBlockedElement(child)) continue;
      return true;
    }

    return false;
  }

  async #incBlockCount() {
    const db = await browser?.storage?.sync?.get(DB_KEY_BLOCKED_COUNT);
    const count = (db?.[DB_KEY_BLOCKED_COUNT] ?? 0) + 1;
    await browser?.storage?.sync?.set({ [DB_KEY_BLOCKED_COUNT]: count });
    return count;
  }

  #log(...data) {
    if (!this.#config?.verbose) return;
    console.log(...data);
  }
}

async function exec() {
  const db = await browser?.storage?.sync?.get(DB_KEY_CONFIG);
  const config = db?.[DB_KEY_CONFIG];
  if (!config?.isActive) return;

  const eventBroker = new EventTarget();
  const blocker = new Blocker({ config, eventBroker });

  browser?.storage?.onChanged?.addListener((changes, area) => {
    if (area != 'sync') return;

    const config = changes?.[DB_KEY_CONFIG]?.newValue;
    if (!config) return;
    blocker.setConfig(config);
  });
}

exec();
