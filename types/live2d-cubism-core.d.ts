type CubismCoreGlobal = Record<string, unknown>;

declare global {
  interface Window {
    Live2DCubismCore?: CubismCoreGlobal;
    __uliuliCubismCoreLoadingPromise?: Promise<CubismCoreGlobal>;
  }
}

export {};
