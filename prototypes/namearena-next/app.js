const fighterSeeds = [
  {
    id: "laoe", name: "牢鳄", short: "鳄", role: "欧皇召唤师", phase: "欧皇形态", color: "#ffc84a",
    hp: 712, maxHp: 860, shield: 0, maxShield: 180, atk: 126, speed: 94,
    statuses: [{ label: "欧气 4/5", type: "buff" }], position: [13, 29],
    bio: "围绕牌组、祭品与高级召唤物建立战场优势。",
  },
  {
    id: "m1", name: "M1A2_abrams_sep", short: "M1", role: "重装火力手", phase: "乘员齐整", color: "#77db82",
    hp: 806, maxHp: 940, shield: 120, maxShield: 180, atk: 152, speed: 88,
    statuses: [{ label: "复合装甲", type: "buff" }], position: [42, 18],
    bio: "以装甲、乘员与现代火力构成稳定而高压的作战循环。",
  },
  {
    id: "ting", name: "小汀", short: "汀", role: "脊髓剑使用者", phase: "不甘倒下", color: "#ff6767",
    hp: 536, maxHp: 690, shield: 0, maxShield: 100, atk: 148, speed: 116,
    statuses: [{ label: "汲血 18%", type: "buff" }], position: [76, 28],
    bio: "高风险近战核心，以脊髓剑、汲血和濒死续战换取爆发。",
  },
  {
    id: "claire", name: "克蕾儿丝菲尔", short: "焰", role: "烈焰反击者", phase: "地狱烈焰", color: "#ff8c3a",
    hp: 604, maxHp: 760, shield: 45, maxShield: 120, atk: 139, speed: 102,
    statuses: [{ label: "烈焰反击", type: "buff" }], position: [87, 52],
    bio: "通过烈焰反击建立威慑，再以二阶段的火焰循环持续施压。",
  },
  {
    id: "yuzu", name: "柚子", short: "柚", role: "九式收尾者", phase: "三阶段", color: "#f266ff",
    hp: 648, maxHp: 820, shield: 138, maxShield: 210, atk: 144, speed: 109,
    statuses: [{ label: "锁定：小汀", type: "debuff" }, { label: "九式 8/9", type: "buff" }], position: [71, 75],
    bio: "通过标记目标积累九式，在有限窗口内完成 Furioso 收尾。",
  },
  {
    id: "ciwei", name: "刺猬人", short: "武", role: "三段变身者", phase: "奇迹武刃", color: "#42b9ff",
    hp: 672, maxHp: 850, shield: 70, maxShield: 150, atk: 142, speed: 108,
    statuses: [{ label: "武神王座", type: "buff" }], position: [43, 79],
    bio: "通过武神之刃与奇迹形态逐级抬高战斗上限，靠特色反击翻盘。",
  },
  {
    id: "sigua", name: "丝瓜uli", short: "瓜", role: "瓦学妹", phase: "战术超频", color: "#39d9ff",
    image: "../../public/Model.webp", hp: 530, maxHp: 592, shield: 110, maxShield: 160, atk: 132, speed: 121,
    statuses: [{ label: "拼好饭", type: "buff" }], position: [15, 70],
    bio: "一阶段服务团队，二阶段以瓦罗兰特式枪械与节奏切换接管残局。",
  },
  {
    id: "xuanning", name: "玄凝", short: "玄", role: "全能游戏大师", phase: "高 APM", color: "#b6ed55",
    hp: 626, maxHp: 790, shield: 0, maxShield: 120, atk: 136, speed: 114,
    statuses: [{ label: "APM 72", type: "buff" }], position: [51, 49],
    bio: "用跨游戏技能构成工具箱，在高 APM 阶段获得强化版本。",
  },
];

const actionScript = [
  {
    actor: "laoe", targets: [], label: "十连召唤", subtitle: "高级召唤物响应", kind: "SUMMON", color: "#ffc84a",
    fx: "summon", threat: 62,
    logs: [
      "<strong>牢鳄</strong> 消耗 5 点欧气，发动 <em>十连召唤</em>。",
      "祭品满足，高级召唤物 <em>青眼白龙</em> 响应召唤。",
      "青眼白龙登场，为牢鳄提供 <strong>90 点护盾</strong>。",
    ],
  },
  {
    actor: "m1", targets: ["ciwei"], label: "脱壳穿甲弹", subtitle: "APFSDS // 炮手锁定", kind: "SKILL", color: "#77db82",
    fx: "railgun", damage: 122, damageKind: "真实伤害", threat: 78,
    logs: [
      "<strong>M1A2_abrams_sep</strong> 完成测距，装填尾翼稳定脱壳穿甲弹。",
      "炮弹贯穿 <em>刺猬人</em>，造成 <strong>122 点真实伤害</strong>。",
      "刺猬人的护盾无法阻挡穿甲弹，生命降至 <strong>550</strong>。",
    ],
  },
  {
    actor: "ting", targets: ["claire"], label: "脊髓剑", subtitle: "近身斩击 // 汲血", kind: "SKILL", color: "#ff6767",
    fx: "slash", damage: 148, damageKind: "物理伤害", heal: 27, threat: 84,
    logs: [
      "<strong>小汀</strong> 抽出脊髓剑，突进斩向 <em>克蕾儿丝菲尔</em>。",
      "克蕾儿的火焰护盾吸收 <strong>45 点伤害</strong>，其本体承受余下 <strong>103 点</strong>。",
      "小汀通过常驻汲血恢复 <strong>27 点生命</strong>。",
    ],
  },
  {
    actor: "claire", targets: ["ting"], label: "烈焰反击", subtitle: "因小汀的近身攻击触发", kind: "COUNTER", color: "#ff8c3a",
    fx: "fire", damage: 74, damageKind: "魔法反击", threat: 69,
    logs: [
      "<strong>克蕾儿丝菲尔</strong> 的 <em>烈焰反击</em> 被近身斩击激活。",
      "地狱烈焰锁定攻击者 <em>小汀</em>，造成 <strong>74 点魔法伤害</strong>。",
      "小汀获得 <em>灼烧 2 回合</em>。",
    ],
  },
  {
    actor: "sigua", targets: ["sigua"], label: "战术超频", subtitle: "瓦学妹进入残局接管", kind: "PHASE", color: "#39d9ff",
    fx: "cinematic", heal: 62, threat: 73,
    cinematic: { kicker: "PHASE SHIFT // TACTICAL OVERDRIVE", title: "丝瓜uli", subtitle: "战术超频 · 火力接管", art: "model" },
    logs: [
      "<strong>丝瓜uli</strong> 拾取拼好饭，恢复 <strong>62 点生命</strong>。",
      "二阶段启动：<em>战术超频</em>，攻击与技能节奏获得强化。",
      "护盾重新充能至 <strong>160 点</strong>。",
    ],
  },
  {
    actor: "ciwei", targets: ["yuzu"], label: "GREAT MONSTER VICTORY", subtitle: "奇迹怪兽武刃 // 一次性必杀", kind: "FINISHER", color: "#42b9ff",
    fx: "transformation", damage: 186, damageKind: "必杀伤害", threat: 94,
    cinematic: { kicker: "MIRACLE MONSTER // FINISHER", title: "刺猬人", subtitle: "GREAT MONSTER VICTORY", art: "emblem", emblem: "武" },
    logs: [
      "<strong>刺猬人</strong> 完成三阶段变身，奇迹怪兽武刃装甲展开。",
      "<em>GREAT MONSTER VICTORY</em> 命中柚子，护盾吸收 <strong>138 点</strong>。",
      "余波造成 <strong>48 点必杀伤害</strong>；该一次性必杀已消耗。",
    ],
  },
  {
    actor: "yuzu", targets: ["ting"], label: "Furioso", subtitle: "九式完成 // 标记目标确认", kind: "ULTIMATE", color: "#f266ff",
    fx: "furioso", damage: 171, damageKind: "大招伤害", threat: 97,
    logs: [
      "<strong>柚子</strong> 第九次技能命中标记目标，<em>Furioso</em> 解锁。",
      "九式连续斩击全部落在 <em>小汀</em> 身上，造成 <strong>171 点伤害</strong>。",
      "计数重置为 <strong>0/9</strong>，下一大回合可重新积累一次。",
    ],
  },
  {
    actor: "xuanning", targets: ["m1"], label: "盲视野肉钩", subtitle: "高 APM 强化技能", kind: "SKILL", color: "#b6ed55",
    fx: "hook", damage: 88, damageKind: "物理伤害", threat: 76,
    logs: [
      "<strong>玄凝</strong> 预判走位，在盲视野中甩出强化肉钩。",
      "肉钩命中 <em>M1A2_abrams_sep</em>，护盾吸收 <strong>88 点伤害</strong>。",
      "M1A2_abrams_sep 被拉近并获得 <em>眩晕 1 回合</em>。",
    ],
  },
  {
    actor: "prts", targets: ["laoe", "m1", "ting", "claire", "yuzu", "ciwei", "sigua", "xuanning"],
    label: "普瑞赛斯事件", subtitle: "矿石病层数正在重写战场", kind: "WORLD EVENT", color: "#d8ff65", fx: "glitch", threat: 100,
    logs: [
      "<strong>全局事件</strong>：普瑞赛斯进入二阶段，暂时成为共同威胁。",
      "源石结晶完成一次增殖，随机三名角色获得 <em>矿石病 +1</em>。",
      "战场仇恨重新计算，所有角色对普瑞赛斯的攻击倾向上升。",
    ],
  },
];

const state = {
  fighters: [], selected: "sigua", speed: 1, paused: false, sound: false,
  runToken: 0, turn: 36, majorRound: 3, actionIndex: 0, audioContext: null,
};

const dom = {
  shell: document.querySelector("#game-shell"), arena: document.querySelector("#arena"), fighters: document.querySelector("#fighters"),
  feed: document.querySelector("#feed-list"), initiative: document.querySelector("#initiative-strip"), damageLayer: document.querySelector("#damage-layer"),
  dossier: document.querySelector("#selected-dossier"), eventBanner: document.querySelector("#event-banner"), eventKicker: document.querySelector("#event-kicker"),
  eventTitle: document.querySelector("#event-title"), eventSubtitle: document.querySelector("#event-subtitle"), summon: document.querySelector("#summon-slot"),
  cinematic: document.querySelector("#cinematic"), cinematicArt: document.querySelector("#cinematic-art"), cinematicKicker: document.querySelector("#cinematic-kicker"),
  cinematicTitle: document.querySelector("#cinematic-title"), cinematicSubtitle: document.querySelector("#cinematic-subtitle"), impact: document.querySelector("#impact-flash"),
  pauseButton: document.querySelector("#pause-button"), soundButton: document.querySelector("#sound-button"), threatFill: document.querySelector("#threat-fill"),
  threatLabel: document.querySelector("#threat-label"), nextActor: document.querySelector("#next-actor"), nextCountdown: document.querySelector("#next-countdown"),
  globalTurn: document.querySelector("#global-turn"), majorRound: document.querySelector("#major-round"), orbitRound: document.querySelector("#orbit-round"),
  canvas: document.querySelector("#fx-canvas"),
};

const fx = { context: dom.canvas.getContext("2d"), particles: [], beams: [], dpr: 1 };

function cloneFighters() {
  return fighterSeeds.map((fighter) => ({ ...fighter, statuses: fighter.statuses.map((status) => ({ ...status })) }));
}

function fighterById(id) {
  return state.fighters.find((fighter) => fighter.id === id);
}

function fighterElement(id) {
  return document.querySelector(`[data-fighter-id="${id}"]`);
}

function safePercent(value, max) {
  return max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

function renderFighters() {
  dom.fighters.innerHTML = state.fighters.map((fighter) => {
    const portrait = fighter.image ? `<img src="${fighter.image}" alt="" />` : `<span class="fighter-emblem">${fighter.short}</span>`;
    const statuses = fighter.statuses.slice(0, 2).map((status) => `<span class="status-chip ${status.type}">${status.label}</span>`).join("");
    const level = fighter.phase.includes("三") ? "3" : fighter.phase === "欧皇形态" ? "1" : "2";
    return `
      <button type="button" class="fighter-unit${fighter.id === state.selected ? " is-selected" : ""}"
        data-fighter-id="${fighter.id}" style="--x:${fighter.position[0]}%;--y:${fighter.position[1]}%;--unit-accent:${fighter.color}"
        aria-label="查看 ${fighter.name} 状态">
        <span class="fighter-portrait">${portrait}<span class="fighter-level">P${level}</span></span>
        <span class="fighter-hud">
          <span class="fighter-name"><span>${fighter.name}</span><small>${fighter.hp}/${fighter.maxHp}</small></span>
          <span class="bar hp" style="--value:${safePercent(fighter.hp, fighter.maxHp)}%"><i></i></span>
          <span class="bar shield${fighter.shield <= 0 ? " is-empty" : ""}" style="--value:${safePercent(fighter.shield, fighter.maxShield)}%"><i></i></span>
          <span class="fighter-statuses">${statuses}</span>
        </span>
      </button>`;
  }).join("");
  document.querySelectorAll(".fighter-unit").forEach((button) => button.addEventListener("click", () => selectFighter(button.dataset.fighterId)));
}

function renderDossier() {
  const fighter = fighterById(state.selected) || state.fighters[0];
  if (!fighter) return;
  dom.dossier.style.setProperty("--dossier-accent", fighter.color);
  dom.dossier.innerHTML = `
    <span class="dossier-accent"></span>
    <div class="dossier-body">
      <h2>${fighter.name} <small>· ${fighter.phase}</small></h2>
      <div class="dossier-stats"><span>攻 <b>${fighter.atk}</b></span><span>速 <b>${fighter.speed}</b></span><span>盾 <b>${fighter.shield}</b></span></div>
      <p>${fighter.role}：${fighter.bio}</p>
    </div>`;
}

function selectFighter(id) {
  state.selected = id;
  document.querySelectorAll(".fighter-unit").forEach((element) => element.classList.toggle("is-selected", element.dataset.fighterId === id));
  renderDossier();
}

function renderInitiative(startIndex = 0) {
  const order = ["ting", "sigua", "xuanning", "ciwei", "claire", "laoe", "yuzu", "m1"];
  const rotated = order.map((_, index) => order[(startIndex + index) % order.length]);
  dom.initiative.innerHTML = rotated.map((id) => {
    const fighter = fighterById(id);
    return `<span class="initiative-token" title="${fighter.name}" style="--token-color:${fighter.color}">${fighter.short}</span>`;
  }).join("");
}

function addFeedEntry(action) {
  const entry = document.createElement("article");
  entry.className = "feed-entry";
  entry.style.setProperty("--entry-color", action.color);
  entry.innerHTML = `<header><div><span>${action.kind}</span><b>${action.label}</b></div><time>TURN ${String(state.turn).padStart(3, "0")}</time></header>${action.logs.map((line) => `<p>${line}</p>`).join("")}`;
  dom.feed.prepend(entry);
  while (dom.feed.children.length > 7) dom.feed.lastElementChild.remove();
  dom.feed.scrollTop = 0;
}

function seedFeed() {
  dom.feed.innerHTML = "";
  addFeedEntry({
    label: "战场同步完成", kind: "SYSTEM", color: "#39d9ff",
    logs: ["<strong>全局行动制</strong>已启用，角色状态、伤害结算与战报使用同一事件时间轴。", "当前为无水 FFA 演示场，<em>8 名特殊角色</em>存活。"],
  });
}

function setActionFocus(actorId, targetIds = []) {
  document.querySelectorAll(".fighter-unit").forEach((element) => {
    const id = element.dataset.fighterId;
    const isActor = id === actorId;
    const isTarget = targetIds.includes(id);
    element.classList.toggle("is-active", isActor);
    element.classList.toggle("is-targeted", isTarget);
    element.classList.toggle("is-dimmed", !isActor && !isTarget && actorId !== "prts");
  });
}

function clearActionFocus() {
  document.querySelectorAll(".fighter-unit").forEach((element) => element.classList.remove("is-active", "is-targeted", "is-dimmed", "is-hit"));
}

function updateEventBanner(action) {
  dom.eventKicker.textContent = `${action.kind} // ACTION ${String(state.turn).padStart(3, "0")}`;
  dom.eventTitle.textContent = action.label;
  dom.eventSubtitle.textContent = action.subtitle;
  dom.eventBanner.style.borderColor = action.color;
}

function updateRoundDisplay() {
  dom.globalTurn.textContent = state.turn;
  dom.majorRound.textContent = state.majorRound;
  dom.orbitRound.textContent = String(state.majorRound).padStart(2, "0");
}

function updateThreat(value) {
  dom.threatFill.style.width = `${value}%`;
  dom.threatLabel.textContent = value >= 92 ? "极危" : value >= 76 ? "激战" : value >= 58 ? "交战" : "试探";
}

function setNextAction(index) {
  const action = actionScript[index % actionScript.length];
  const actor = fighterById(action.actor);
  dom.nextActor.textContent = actor ? actor.name : "普瑞赛斯";
  dom.nextActor.style.color = action.color;
}

function refreshFighter(id) {
  const fighter = fighterById(id);
  const element = fighterElement(id);
  if (!fighter || !element) return;
  const hp = element.querySelector(".bar.hp");
  const shield = element.querySelector(".bar.shield");
  hp.style.setProperty("--value", `${safePercent(fighter.hp, fighter.maxHp)}%`);
  shield.style.setProperty("--value", `${safePercent(fighter.shield, fighter.maxShield)}%`);
  shield.classList.toggle("is-empty", fighter.shield <= 0);
  element.querySelector(".fighter-name small").textContent = `${fighter.hp}/${fighter.maxHp}`;
  if (state.selected === id) renderDossier();
}

function getElementCenter(id) {
  const element = fighterElement(id);
  if (!element) {
    const rect = dom.arena.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function createDamageNumber(id, amount, kind, color) {
  const center = getElementCenter(id);
  const number = document.createElement("span");
  number.className = "damage-number";
  number.dataset.kind = kind;
  number.textContent = `-${amount}`;
  number.style.left = `${center.x}px`;
  number.style.top = `${center.y - 12}px`;
  number.style.setProperty("--damage-color", color);
  dom.damageLayer.append(number);
  setTimeout(() => number.remove(), 1100);
}

function applyDamage(id, amount, action) {
  const fighter = fighterById(id);
  const element = fighterElement(id);
  if (!fighter || !element) return;
  let remaining = amount;
  if (action.fx !== "railgun" && fighter.shield > 0) {
    const absorbed = Math.min(fighter.shield, remaining);
    fighter.shield -= absorbed;
    remaining -= absorbed;
  }
  fighter.hp = Math.max(1, fighter.hp - remaining);
  element.classList.remove("is-hit");
  void element.offsetWidth;
  element.classList.add("is-hit");
  createDamageNumber(id, amount, action.damageKind || "伤害", action.color);
  refreshFighter(id);
}

function applyHeal(id, amount) {
  const fighter = fighterById(id);
  if (!fighter) return;
  fighter.hp = Math.min(fighter.maxHp, fighter.hp + amount);
  const center = getElementCenter(id);
  const number = document.createElement("span");
  number.className = "damage-number";
  number.dataset.kind = "恢复";
  number.textContent = `+${amount}`;
  number.style.left = `${center.x}px`;
  number.style.top = `${center.y - 12}px`;
  number.style.setProperty("--damage-color", "#7be36a");
  dom.damageLayer.append(number);
  setTimeout(() => number.remove(), 1100);
  refreshFighter(id);
}

function resizeCanvas() {
  fx.dpr = Math.min(window.devicePixelRatio || 1, 2);
  dom.canvas.width = Math.floor(window.innerWidth * fx.dpr);
  dom.canvas.height = Math.floor(window.innerHeight * fx.dpr);
  dom.canvas.style.width = `${window.innerWidth}px`;
  dom.canvas.style.height = `${window.innerHeight}px`;
  fx.context.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
}

function addBeam(fromId, toId, color, width = 5, life = 520) {
  const from = getElementCenter(fromId);
  const to = getElementCenter(toId);
  fx.beams.push({ ...from, x2: to.x, y2: to.y, color, width, life, maxLife: life });
  for (let index = 0; index < 30; index += 1) {
    const ratio = index / 30;
    addParticle(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio, color, 1.5 + Math.random() * 3, 420, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4);
  }
}

function addParticle(x, y, color, size = 3, life = 560, vx = 0, vy = 0) {
  fx.particles.push({ x, y, color, size, life, maxLife: life, vx, vy });
}

function burstAt(id, color, amount = 34, force = 5) {
  const center = getElementCenter(id);
  for (let index = 0; index < amount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * force + 1;
    addParticle(center.x, center.y, color, 2 + Math.random() * 4, 520 + Math.random() * 460, Math.cos(angle) * speed, Math.sin(angle) * speed);
  }
}

function colorWithAlpha(color, alpha) {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function renderFxFrame() {
  const context = fx.context;
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  context.globalCompositeOperation = "lighter";
  fx.beams = fx.beams.filter((beam) => {
    beam.life -= 16.67;
    if (beam.life <= 0) return false;
    const alpha = Math.max(0, beam.life / beam.maxLife);
    context.beginPath();
    context.moveTo(beam.x, beam.y);
    context.lineTo(beam.x2, beam.y2);
    context.lineWidth = beam.width * alpha;
    context.strokeStyle = colorWithAlpha(beam.color, alpha * 0.88);
    context.shadowColor = beam.color;
    context.shadowBlur = 18;
    context.stroke();
    context.shadowBlur = 0;
    return true;
  });
  fx.particles = fx.particles.filter((particle) => {
    particle.life -= 16.67;
    if (particle.life <= 0) return false;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vx *= 0.985;
    particle.vy *= 0.985;
    const alpha = Math.max(0, particle.life / particle.maxLife);
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha(particle.color, alpha);
    context.fill();
    return true;
  });
  context.globalCompositeOperation = "source-over";
  requestAnimationFrame(renderFxFrame);
}

function flashImpact(shake = true) {
  dom.impact.classList.remove("is-active");
  void dom.impact.offsetWidth;
  dom.impact.classList.add("is-active");
  if (shake) {
    dom.shell.classList.remove("is-shaking");
    void dom.shell.offsetWidth;
    dom.shell.classList.add("is-shaking");
  }
}

function playTone(frequency, duration = 0.09, type = "square", volume = 0.035) {
  if (!state.sound) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  if (!state.audioContext) state.audioContext = new AudioContext();
  const oscillator = state.audioContext.createOscillator();
  const gain = state.audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, state.audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, state.audioContext.currentTime + duration);
  oscillator.connect(gain).connect(state.audioContext.destination);
  oscillator.start();
  oscillator.stop(state.audioContext.currentTime + duration);
}

function wait(ms, token) {
  return new Promise((resolve) => {
    let remaining = ms;
    let previous = performance.now();
    function tick(now) {
      if (token !== state.runToken) return resolve(false);
      if (!state.paused) remaining -= (now - previous) * state.speed;
      previous = now;
      if (remaining <= 0) return resolve(true);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

async function countdown(ms, token) {
  let remaining = ms;
  while (remaining > 0) {
    dom.nextCountdown.textContent = `${(remaining / 1000).toFixed(1)}s`;
    const valid = await wait(100, token);
    if (!valid) return false;
    remaining -= 100;
  }
  dom.nextCountdown.textContent = "NOW";
  return true;
}

async function showCinematic(config, token) {
  dom.cinematicKicker.textContent = config.kicker;
  dom.cinematicTitle.textContent = config.title;
  dom.cinematicSubtitle.textContent = config.subtitle;
  dom.cinematicArt.innerHTML = config.art === "emblem" ? `<span class="cutin-emblem">${config.emblem}</span>` : "";
  dom.cinematicArt.classList.toggle("is-emblem", config.art === "emblem");
  dom.cinematic.setAttribute("aria-hidden", "false");
  dom.cinematic.classList.remove("is-visible");
  void dom.cinematic.offsetWidth;
  dom.cinematic.classList.add("is-visible");
  playTone(164, 0.18, "sawtooth", 0.04);
  await wait(2350, token);
  dom.cinematic.classList.remove("is-visible");
  dom.cinematic.setAttribute("aria-hidden", "true");
}

async function playActionFx(action, token) {
  const target = action.targets[0];
  switch (action.fx) {
    case "summon": {
      dom.summon.innerHTML = `<div class="summon-card"><span>青</span><strong>青眼白龙</strong><small>ADVANCED SUMMON</small></div>`;
      const center = getElementCenter("laoe");
      for (let index = 0; index < 80; index += 1) {
        const angle = (Math.PI * 2 * index) / 80;
        addParticle(center.x, center.y, action.color, 2 + Math.random() * 3, 900, Math.cos(angle) * (1 + Math.random() * 4), Math.sin(angle) * (1 + Math.random() * 4));
      }
      playTone(220, 0.2, "triangle");
      await wait(1100, token);
      const laoe = fighterById("laoe");
      laoe.shield = Math.min(laoe.maxShield, laoe.shield + 90);
      refreshFighter("laoe");
      await wait(650, token);
      dom.summon.innerHTML = "";
      break;
    }
    case "railgun":
      addBeam("m1", target, action.color, 10, 560);
      playTone(82, 0.16, "sawtooth", 0.055);
      await wait(240, token);
      applyDamage(target, action.damage, action);
      burstAt(target, "#e9ffdf", 55, 7);
      flashImpact(true);
      break;
    case "slash":
      addBeam("ting", target, action.color, 7, 380);
      playTone(380, 0.1, "sawtooth");
      await wait(210, token);
      applyDamage(target, action.damage, action);
      burstAt(target, action.color, 42, 6);
      flashImpact(false);
      await wait(260, token);
      applyHeal("ting", action.heal);
      break;
    case "fire":
      addBeam("claire", target, action.color, 8, 620);
      burstAt(target, action.color, 58, 5);
      playTone(130, 0.22, "sawtooth");
      await wait(360, token);
      applyDamage(target, action.damage, action);
      flashImpact(false);
      break;
    case "cinematic": {
      await showCinematic(action.cinematic, token);
      const sigua = fighterById("sigua");
      sigua.shield = sigua.maxShield;
      applyHeal("sigua", action.heal);
      burstAt("sigua", action.color, 72, 7);
      break;
    }
    case "transformation":
      await showCinematic(action.cinematic, token);
      addBeam("ciwei", target, action.color, 13, 700);
      playTone(104, 0.2, "square", 0.05);
      await wait(280, token);
      applyDamage(target, action.damage, action);
      burstAt(target, action.color, 90, 9);
      flashImpact(true);
      break;
    case "furioso":
      for (let strike = 0; strike < 9; strike += 1) {
        addBeam("yuzu", target, strike % 2 === 0 ? action.color : "#ffffff", 2 + (strike % 3), 220);
        playTone(310 + strike * 35, 0.05, "square", 0.022);
        burstAt(target, action.color, 8, 4);
        await wait(90, token);
      }
      applyDamage(target, action.damage, action);
      flashImpact(true);
      break;
    case "hook":
      addBeam("xuanning", target, action.color, 4, 820);
      playTone(190, 0.14, "triangle");
      await wait(420, token);
      applyDamage(target, action.damage, action);
      burstAt(target, action.color, 34, 5);
      flashImpact(false);
      break;
    case "glitch":
      dom.shell.classList.add("is-glitching");
      playTone(55, 0.5, "sawtooth", 0.028);
      state.fighters.forEach((fighter, index) => {
        if ([1, 4, 6].includes(index)) {
          fighter.statuses.unshift({ label: "矿石病 +1", type: "debuff" });
          fighter.statuses = fighter.statuses.slice(0, 2);
        }
        burstAt(fighter.id, index % 2 ? "#d8ff65" : "#f266ff", 18, 4);
      });
      renderFighters();
      renderDossier();
      await wait(1300, token);
      dom.shell.classList.remove("is-glitching");
      break;
  }
}

async function runDemo() {
  const token = ++state.runToken;
  resetDemo(false);
  await wait(850, token);
  while (token === state.runToken) {
    const action = actionScript[state.actionIndex];
    state.turn += 1;
    if (state.actionIndex === 4) state.majorRound += 1;
    updateRoundDisplay();
    updateEventBanner(action);
    updateThreat(action.threat);
    renderInitiative(state.actionIndex % state.fighters.length);
    setActionFocus(action.actor, action.targets);
    selectFighter(action.actor === "prts" ? "laoe" : action.actor);
    addFeedEntry(action);
    playTone(520, 0.06, "square", 0.018);
    const valid = await wait(420, token);
    if (!valid) return;
    await playActionFx(action, token);
    if (token !== state.runToken) return;
    await wait(720, token);
    clearActionFocus();
    state.actionIndex += 1;
    if (state.actionIndex >= actionScript.length) {
      dom.eventKicker.textContent = "DEMO COMPLETE";
      dom.eventTitle.textContent = "演出序列完成";
      dom.eventSubtitle.textContent = "2.8 秒后自动重播";
      setNextAction(0);
      const loop = await countdown(2800, token);
      if (!loop) return;
      resetDemo(false);
      await wait(500, token);
    } else {
      setNextAction(state.actionIndex);
      const next = await countdown(1150, token);
      if (!next) return;
    }
  }
}

function resetDemo(incrementToken = true) {
  if (incrementToken) state.runToken += 1;
  state.fighters = cloneFighters();
  state.selected = "sigua";
  state.turn = 36;
  state.majorRound = 3;
  state.actionIndex = 0;
  state.paused = false;
  dom.pauseButton.textContent = "Ⅱ";
  dom.pauseButton.title = "暂停演示";
  dom.summon.innerHTML = "";
  dom.shell.classList.remove("is-shaking", "is-glitching");
  renderFighters();
  renderDossier();
  renderInitiative(0);
  seedFeed();
  updateRoundDisplay();
  updateThreat(58);
  setNextAction(0);
  dom.eventKicker.textContent = "ARENA READY";
  dom.eventTitle.textContent = "全局行动制已连接";
  dom.eventSubtitle.textContent = "演示即将开始";
  dom.eventBanner.style.borderColor = "#39d9ff";
}

document.querySelectorAll("[data-speed]").forEach((button) => button.addEventListener("click", () => {
  state.speed = Number(button.dataset.speed);
  document.querySelectorAll("[data-speed]").forEach((item) => item.classList.toggle("is-active", item === button));
}));

dom.pauseButton.addEventListener("click", () => {
  state.paused = !state.paused;
  dom.pauseButton.textContent = state.paused ? "▶" : "Ⅱ";
  dom.pauseButton.title = state.paused ? "继续演示" : "暂停演示";
});

document.querySelector("#restart-button").addEventListener("click", () => runDemo());

dom.soundButton.addEventListener("click", () => {
  state.sound = !state.sound;
  dom.soundButton.classList.toggle("is-active", state.sound);
  dom.soundButton.title = state.sound ? "关闭音效" : "开启音效";
  if (state.sound) playTone(660, 0.1, "triangle", 0.03);
});

document.querySelector("#fullscreen-button").addEventListener("click", async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  else await document.exitFullscreen?.();
});

document.querySelector("#feed-toggle").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 760px) and (orientation: portrait)").matches) {
    dom.shell.dataset.mobileView = "arena";
    document.querySelectorAll("[data-mobile-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.mobileView === "arena"));
  } else {
    document.querySelector(".combat-feed").classList.toggle("is-condensed");
  }
});

document.querySelectorAll("[data-mobile-view]").forEach((button) => button.addEventListener("click", () => {
  dom.shell.dataset.mobileView = button.dataset.mobileView;
  document.querySelectorAll("[data-mobile-view]").forEach((item) => item.classList.toggle("is-active", item === button));
}));

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
renderFxFrame();
resetDemo();
runDemo();
