const CUBISM_CORE_SCRIPT_ID = "uliuli-live2d-cubism-core";
const CUBISM_CORE_LOAD_TIMEOUT_MS = 15000;

export const CUBISM_CORE_SCRIPT_SRC = "/live2d/live2dcubismcore.min.js";

export type CubismCoreGlobal = Record<string, unknown>;

function getCubismCoreGlobal(): CubismCoreGlobal | null {
  if (typeof window === "undefined") return null;
  return window.Live2DCubismCore ?? null;
}

function findExistingScript(src: string): HTMLScriptElement | null {
  const byId = document.getElementById(CUBISM_CORE_SCRIPT_ID);
  if (byId instanceof HTMLScriptElement) return byId;

  const absoluteSrc = new URL(src, window.location.href).toString();
  for (const script of Array.from(document.scripts)) {
    if (
      script instanceof HTMLScriptElement &&
      (script.getAttribute("src") === src || script.src === absoluteSrc)
    ) {
      return script;
    }
  }

  return null;
}

function waitForCubismCore(
  script: HTMLScriptElement,
  src: string,
): Promise<CubismCoreGlobal> {
  return new Promise((resolve, reject) => {
    const loaded = getCubismCoreGlobal();
    if (loaded) {
      script.dataset.uliuliCubismCore = "loaded";
      resolve(loaded);
      return;
    }

    const onLoad = () => {
      cleanup();
      const runtime = getCubismCoreGlobal();
      if (runtime) {
        script.dataset.uliuliCubismCore = "loaded";
        resolve(runtime);
        return;
      }
      script.dataset.uliuliCubismCore = "error";
      reject(
        new Error(
          `Cubism Core loaded from ${src}, but window.Live2DCubismCore is unavailable`,
        ),
      );
    };

    const onError = () => {
      cleanup();
      script.dataset.uliuliCubismCore = "error";
      reject(new Error(`Failed to load Cubism Core script: ${src}`));
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      script.dataset.uliuliCubismCore = "error";
      reject(new Error(`Timed out while loading Cubism Core script: ${src}`));
    }, CUBISM_CORE_LOAD_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };

    if (script.dataset.uliuliCubismCore === "error") {
      cleanup();
      reject(new Error(`Failed to load Cubism Core script: ${src}`));
      return;
    }

    if (script.dataset.uliuliCubismCore === "loaded") {
      onLoad();
      return;
    }

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
  });
}

export function isCubismCoreLoaded(): boolean {
  return getCubismCoreGlobal() !== null;
}

export async function ensureCubismCoreLoaded(
  src: string = CUBISM_CORE_SCRIPT_SRC,
): Promise<CubismCoreGlobal> {
  if (typeof window === "undefined") {
    throw new Error("Cubism Core can only be loaded in the browser");
  }

  const existingRuntime = getCubismCoreGlobal();
  if (existingRuntime) return existingRuntime;

  if (window.__uliuliCubismCoreLoadingPromise) {
    return window.__uliuliCubismCoreLoadingPromise;
  }

  const existingScript = findExistingScript(src);
  const shouldRecreateScript =
    existingScript?.dataset.uliuliCubismCore === "error" ||
    existingScript?.dataset.uliuliCubismCore === "loaded";

  if (shouldRecreateScript && !getCubismCoreGlobal()) {
    existingScript.remove();
  }

  const reusableScript =
    shouldRecreateScript && !getCubismCoreGlobal() ? null : existingScript;
  const script = reusableScript ?? document.createElement("script");

  if (!reusableScript) {
    script.id = CUBISM_CORE_SCRIPT_ID;
    script.src = src;
    script.async = true;
    script.dataset.uliuliCubismCore = "loading";
    (document.head ?? document.body ?? document.documentElement).appendChild(script);
  }

  const promise = waitForCubismCore(script, src);
  window.__uliuliCubismCoreLoadingPromise = promise.finally(() => {
    if (!window.Live2DCubismCore) {
      delete window.__uliuliCubismCoreLoadingPromise;
    }
  });

  return window.__uliuliCubismCoreLoadingPromise;
}
