export type DeepQueryRoot = Document | ShadowRoot | Element;

function childElements(root: DeepQueryRoot): Element[] {
  return Array.from(root.querySelectorAll('*'));
}

/**
 * Returns selector matches from the document and every reachable open shadow
 * root. Closed shadow roots are intentionally inaccessible to extensions.
 */
export function querySelectorAllDeep<T extends Element = Element>(
  selector: string,
  root: DeepQueryRoot = document,
): T[] {
  const matches: T[] = [];
  const visitedRoots = new Set<DeepQueryRoot>();

  const visit = (currentRoot: DeepQueryRoot): void => {
    if (visitedRoots.has(currentRoot)) return;
    visitedRoots.add(currentRoot);

    if (currentRoot instanceof Element && currentRoot.matches(selector)) {
      matches.push(currentRoot as T);
    }

    for (const element of childElements(currentRoot)) {
      if (element.matches(selector)) matches.push(element as T);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };

  visit(root);
  return matches;
}

export function querySelectorDeep<T extends Element = Element>(
  selector: string,
  root: DeepQueryRoot = document,
): T | null {
  return querySelectorAllDeep<T>(selector, root)[0] ?? null;
}

export function openShadowRoots(root: DeepQueryRoot = document): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  const visitedRoots = new Set<DeepQueryRoot>();

  const visit = (currentRoot: DeepQueryRoot): void => {
    if (visitedRoots.has(currentRoot)) return;
    visitedRoots.add(currentRoot);

    for (const element of childElements(currentRoot)) {
      if (!element.shadowRoot) continue;
      roots.push(element.shadowRoot);
      visit(element.shadowRoot);
    }
  };

  visit(root);
  return roots;
}

export function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active: Element | null = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export type DeepMutationObserverOptions = MutationObserverInit & {
  /** Detect an open root attached to an already-connected host without a DOM mutation. */
  shadowRootPollMs?: number;
};

/** Observe the document plus open shadow roots that exist now or are added later. */
export function observeDeepMutations(
  callback: MutationCallback,
  options: DeepMutationObserverOptions,
  root: Document = document,
): () => void {
  const observers = new Map<Document | ShadowRoot, MutationObserver>();
  const { shadowRootPollMs = 500, ...mutationOptions } = options;

  const discoverRoots = (): boolean => {
    let discovered = false;
    const roots: Array<Document | ShadowRoot> = [root, ...openShadowRoots(root)];
    for (const currentRoot of roots) {
      if (observers.has(currentRoot)) continue;
      const observer = new MutationObserver((records, source) => {
        discoverRoots();
        callback(records, source);
      });
      observer.observe(currentRoot, mutationOptions);
      observers.set(currentRoot, observer);
      discovered = true;
    }
    return discovered;
  };

  discoverRoots();
  const pollTimer = window.setInterval(() => {
    if (discoverRoots()) callback([], observers.get(root)!);
  }, shadowRootPollMs);

  return () => {
    window.clearInterval(pollTimer);
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
  };
}
