/**
 * 可种子化的伪随机数生成器（PRNG）。
 *
 * 用于让 DGP 战斗具备可复现性：相同种子 + 相同输入必定产生相同战斗录像。
 * 这对以下场景非常有用：
 *   - 单元测试中验证确定性输出
 *   - 玩家分享"精彩对局"的 replay 链接
 *   - 调试 Heisenbug 时锁定 seed 复现
 *
 * 算法采用 **mulberry32**：
 *   - 32-bit 整数 state，周期 2^32
 *   - 性能极高（每次调用只有一次乘法 + 两次位运算）
 *   - 统计质量足够一款 100 回合内的战旗游戏使用
 *   - 来源：Tommy Ettinger, BSD-0
 */

/** 把任意字符串/数字种子稳定地映射成一个 32-bit 整数。xmur3 算法。 */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * SeededRNG —— 带内部 state 的 mulberry32 PRNG。
 *
 * 实例本身可以直接当作 `() => number` 回调使用（实现了 callable 接口），
 * 因此可以无缝替代 `Math.random`：
 *
 * ```ts
 * const rng = new SeededRNG('my-seed');
 * rng();            // 0.xxxxx
 * rng.range(1, 6);  // 骰子
 * rng.pick([a,b,c]);
 * ```
 */
export class SeededRNG {
  /** 当前 32-bit 整数 state。 */
  private state: number;

  /** 创建 RNG。seed 可以是数字、字符串，或不传（此时用时间 + Math.random 种子，非确定性）。 */
  constructor(seed?: number | string) {
    if (seed === undefined || seed === null) {
      // 非确定性种子：时间戳 ^ Math.random。与 Math.random 行为兼容但仍可通过 getSeed() 复现。
      this.state = (Date.now() ^ Math.floor(Math.random() * 2 ** 32)) >>> 0;
    } else if (typeof seed === 'number') {
      this.state = seed >>> 0;
    } else {
      // 字符串 -> xmur3 -> 首个整数作为 state
      this.state = xmur3(seed)();
    }
  }

  /** 核心 mulberry32 step。返回 [0, 1) 浮点数。 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 整数（含 min，不含 max）。 */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** [min, max] 闭区间整数。 */
  range(min: number, max: number): number {
    return this.int(min, max + 1);
  }

  /** 数组均匀抽取。数组为空时返回 undefined。 */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[this.int(0, arr.length)];
  }

  /** 骰子：k 面，返回 [1, k] 整数。 */
  dice(sides: number): number {
    return this.range(1, sides);
  }

  /** 概率判定：p ∈ [0, 1]。 */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 获取当前 state（用于快照 / replay）。 */
  getState(): number {
    return this.state;
  }

  /** 从已知 state 恢复。 */
  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/**
 * 创建一个 RNG 并返回绑定好的 `next` 方法（call signature 与 Math.random 相同）。
 * 方便传递给那些只接受 `() => number` 签名的工具函数。
 */
export function makeRng(seed?: number | string): () => number {
  const rng = new SeededRNG(seed);
  return rng.next.bind(rng);
}

/** 全局默认 RNG，行为与 Math.random 完全一致（未种子化）。 */
export const defaultRng: () => number = Math.random;
