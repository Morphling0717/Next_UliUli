"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const CONFIG = {
  TOTAL_ITEMS: 136,
  PATH_PREFIX: "/memes/", 
  STORAGE_KEY: "blue_morpho_gacha_collection_v2", 
  AUTH_KEY: "blue_morpho_auth_token",
  COIN_COST: 1,      
  DAILY_REWARD: 3,   
  INITIAL_COINS: 5,
  API_BASE: '/api'  
};

// --- Types ---
export interface HistoryItem {
  code: string;
  itemId: number;
  createdAt: string;
  status: string;
}

export interface User {
  username: string;
  token: string;
}

export interface CloudData {
  collection: number[];
  coins: number;
  history: HistoryItem[];
  lastLogin: string;
}

const GachaIcons = {
  Capsule: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M12 2a10 10 0 0 1 10 10v4a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-4A10 10 0 0 1 12 2z" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 12v10" /></svg>),
  Gallery: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>),
  Lock: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>),
  Close: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
  Coin: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-yellow-400"><circle cx="12" cy="12" r="10" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 18V6" /></svg>),
  Gift: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>),
  History: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M12 20v-6M6 20V10M18 20V4" /></svg>),
  Copy: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>),
  User: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>),
  Trash: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>),
  Refresh: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>)
};

export interface GachaSystemProps {
  /** 隐藏组件内部自带的左下角浮动按钮（供 MailSpeedDial 等外部触发器使用） */
  hideLauncher?: boolean;
  /** 受控打开状态（可选）。未传时组件自管 open 状态，保持向后兼容。 */
  open?: boolean;
  /** 受控打开状态的变更回调（可选） */
  onOpenChange?: (open: boolean) => void;
}

export const GachaSystem: React.FC<GachaSystemProps> = ({
  hideLauncher = false,
  open: openProp,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const isOpen = isControlled ? openProp! : internalOpen;
  const setIsOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [mode, setMode] = useState("MACHINE"); 
  const [collection, setCollection] = useState<number[]>([]); 
  const [history, setHistory] = useState<HistoryItem[]>([]); 
  const [coins, setCoins] = useState(0); 
  const [isSpinning, setIsSpinning] = useState(false);
  const [reward, setReward] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<number | null>(null);
  const [showDailyBonus, setShowDailyBonus] = useState(false); 
  
  const [user, setUser] = useState<User | null>(null); 
  const [authMode, setAuthMode] = useState("LOGIN"); 
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [redeemCode, setRedeemCode] = useState("");
  const [giftLoading, setGiftLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [, setCheatBuffer] = useState("");
  const [isInfiniteMode, setIsInfiniteMode] = useState(false);

  useEffect(() => {
      if (isOpen) document.body.style.overflow = 'hidden';
      else document.body.style.overflow = '';
      return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
      const t = setTimeout(() => {
          const loadNext = (index: number) => {
              if (index > CONFIG.TOTAL_ITEMS) return;
              const img = new Image();
              img.src = `${CONFIG.PATH_PREFIX}${index}.webp`;
              img.onload = img.onerror = () => setTimeout(() => loadNext(index + 1), 50);
          };
          loadNext(1);
      }, 2000);
      return () => clearTimeout(t);
  }, []);

  const syncToCloud = async (dataToSync: CloudData, token: string) => {
      if (!token) return;
      try {
          await fetch(`${CONFIG.API_BASE}/user/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, data: dataToSync })
          });
      } catch(e) { console.error("Sync failed", e); }
  };

  const saveAll = (newColl: number[], newCoins: number, newHistory?: HistoryItem[]) => {
    const today = new Date().toDateString();
    const data: CloudData = { 
        collection: newColl, 
        coins: newCoins, 
        history: newHistory || history,
        lastLogin: today 
    };
    
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    setCollection(newColl);
    setCoins(newCoins);
    if (newHistory) setHistory(newHistory);
    
    if (user) syncToCloud(data, user.token);
  };

  const checkHistoryStatus = async () => {
      if (history.length === 0) return;
      setIsCheckingStatus(true);
      try {
          const codesToCheck = history.map(h => h.code);
          const res = await fetch(`${CONFIG.API_BASE}/check_status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ codes: codesToCheck })
          });
          const data = await res.json();
          if (data.results) {
              let hasChanges = false;
              const newHistory = history.map(h => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const remote = data.results.find((r: any) => r.code === h.code);
                  if (remote && remote.status !== h.status) {
                      hasChanges = true;
                      return { ...h, status: remote.status };
                  }
                  return h;
              });
              if (hasChanges) saveAll(collection, coins, newHistory);
          }
      } catch (e) { console.error("Status check failed", e); }
      finally { setIsCheckingStatus(false); }
  };

  useEffect(() => {
    const init = async () => {
        try {
          const token = localStorage.getItem(CONFIG.AUTH_KEY);
          let cloudData: CloudData | null = null;
          let currentUser: User | null = null;

          if (token) {
              try {
                  const res = await fetch(`${CONFIG.API_BASE}/user/me`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token })
                  });
                  const resData = await res.json();
                  if (resData.success) {
                      currentUser = { username: resData.username, token };
                      setUser(currentUser);
                      cloudData = resData.data; 
                  } else { localStorage.removeItem(CONFIG.AUTH_KEY); }
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              } catch(e) {}
          }

          const localRaw = localStorage.getItem(CONFIG.STORAGE_KEY);
          let data: CloudData = { collection: [], history: [], coins: CONFIG.INITIAL_COINS, lastLogin: "" };

          if (cloudData) {
              data = { ...data, ...cloudData };
          } else if (localRaw) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              try { data = { ...data, ...JSON.parse(localRaw) }; } catch (e) {}
          }

          const today = new Date().toDateString(); 
          let bonusAwarded = false;
          
          if (data.lastLogin !== today) {
              data.coins += CONFIG.DAILY_REWARD;
              data.lastLogin = today;
              bonusAwarded = true;
          }

          // 修复：强制防御旧版 localStorage 的脏数据，确保一定是个数组
          const safeCollection = Array.isArray(data.collection) ? data.collection : [];
          const safeHistory = Array.isArray(data.history) ? data.history : [];

          setCollection(safeCollection);
          setHistory(safeHistory);
          setCoins(data.coins || 0);
          
          // 同步回安全的数据格式
          data.collection = safeCollection;
          data.history = safeHistory;
          localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
          if (currentUser) syncToCloud(data, currentUser.token);

          if (bonusAwarded) {
              setTimeout(() => setShowDailyBonus(true), 1500);
          }

        } catch (e) { console.error(e); }
    };
    init();
   
  }, []);

  useEffect(() => {
      if (mode === "HISTORY") checkHistoryStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleAuth = async () => {
      if (!usernameInput || !passwordInput) return alert("请输入用户名和密码");
      setAuthLoading(true);
      try {
          const endpoint = authMode === 'LOGIN' ? '/auth/login' : '/auth/register';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const body: any = { username: usernameInput, password: passwordInput };
          
          if (authMode === 'REGISTER') {
              const today = new Date().toDateString();
              body.initialData = { collection, coins, history, lastLogin: today };
          }

          const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          });
          const data = await res.json();

          if (data.success) {
              localStorage.setItem(CONFIG.AUTH_KEY, data.token);
              setUser({ username: data.username, token: data.token });
              
              if (authMode === 'LOGIN' && data.data) {
                  if (window.confirm(`欢迎回来 ${data.username}！\n检测到云端存档 (硬币:${data.data.coins}, 收集:${data.data.collection?.length || 0})。\n是否加载云端存档覆盖当前本地进度？`)) {
                      const cloud = data.data;
                      const today = new Date().toDateString();
                      
                      let newCoins = cloud.coins || 0;
                      let lastLogin = cloud.lastLogin || "";
                      
                      if (lastLogin !== today) {
                          newCoins += CONFIG.DAILY_REWARD;
                          lastLogin = today;
                          setTimeout(() => setShowDailyBonus(true), 1000);
                      }

                      const mergedData: CloudData = {
                          collection: cloud.collection || [], 
                          coins: newCoins, 
                          history: cloud.history || [],
                          lastLogin: lastLogin
                      };
                      setCollection(mergedData.collection); setCoins(mergedData.coins); setHistory(mergedData.history);
                      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(mergedData));
                      
                      syncToCloud(mergedData, data.token);
                  }
              }
              alert(authMode === 'LOGIN' ? "登录成功！" : "注册成功！");
              setMode("MACHINE");
           
          } else { alert(data.error || "操作失败"); }
      } catch (e) { alert("网络错误"); } finally { setAuthLoading(false); }
  };

  const handleLogout = () => {
      if(window.confirm("确定要退出登录吗？\n本地数据将保留，但后续操作不会同步到云端。")) {
          localStorage.removeItem(CONFIG.AUTH_KEY);
          setUser(null);
          alert("已安全登出。");
      }
  };

  const handleReset = () => {
      let confirmMsg = "⚠️ 警告：确定要重置所有数据吗？\n\n- 表情包、硬币、记录将全部清空\n- 你将回到初始状态 (刷初始)";
      if (user) confirmMsg += "\n\n因为你已登录，云端数据也会被同步清空！此操作不可撤销！";
      else confirmMsg += "\n\n(仅清除本地浏览器缓存)";

      if (window.confirm(confirmMsg)) {
          if (window.confirm("🔴 最后一次确认：真的要删档重来吗？")) {
              const today = new Date().toDateString();
              const resetData: CloudData = { collection: [], coins: CONFIG.INITIAL_COINS, history: [], lastLogin: today };
              
              localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(resetData));
              setCollection([]); setCoins(CONFIG.INITIAL_COINS); setHistory([]);
              
              if (user) syncToCloud(resetData, user.token);
              
              alert("数据已重置！祝你下一次运气爆棚！✨");
              setMode("MACHINE");
          }
      }
  };

  useEffect(() => {
      if (!isOpen) return;
      const handleCheatInput = (e: KeyboardEvent) => {
          const target = e.target as HTMLElement;
          if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
          
          setCheatBuffer(prev => {
              const newBuf = (prev + e.key).slice(-20); 
              if (newBuf.includes("morphling0717")) {
                  setIsInfiniteMode(true);
                  alert("⚡️ DEVELOPER MODE ACTIVATED ⚡️");
                  return ""; 
              }
              return newBuf;
          });
      };
      window.addEventListener("keydown", handleCheatInput);
      return () => window.removeEventListener("keydown", handleCheatInput);
  }, [isOpen]);

  const handleSpin = () => {
    if (isSpinning) return;
    if (!isInfiniteMode && coins < CONFIG.COIN_COST) { alert(`硬币不足！每日登录可领 ${CONFIG.DAILY_REWARD} 枚硬币！`); return; }
    
    const allIds = Array.from({ length: CONFIG.TOTAL_ITEMS }, (_, i) => i + 1);
    setIsSpinning(true);
    setReward(null);
    const nextCoins = isInfiniteMode ? coins : coins - CONFIG.COIN_COST;
    setCoins(nextCoins);

    const randomId = allIds[Math.floor(Math.random() * allIds.length)];
    const img = new Image();
    img.src = `${CONFIG.PATH_PREFIX}${randomId}.webp`;
    
    const minAnimationTime = 1500; 
    const startTime = Date.now();

    const showResult = () => {
        setIsSpinning(false);
        setReward(randomId);
        saveAll([...collection, randomId], nextCoins, history);
    };

    const onReady = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, minAnimationTime - elapsed);
        setTimeout(showResult, remaining);
    };

    if (img.complete) onReady(); else { img.onload = onReady; img.onerror = onReady; }
  };

  const handleGenerateCode = async (itemId: number) => {
      const index = collection.indexOf(itemId);
      if (index === -1) { alert("错误：你好像并没有这张表情包？"); return; }
      if (!window.confirm("确定要将这个表情包打包送人吗？送出后你将失去一张库存！")) return;
      setGiftLoading(true);
      try {
          const res = await fetch(`${CONFIG.API_BASE}/generate`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ itemId })
          });
          const data = await res.json();
          if (data.success) {
              const newColl = [...collection];
              newColl.splice(index, 1); 
              const newHistoryItem: HistoryItem = { code: data.code, itemId: itemId, createdAt: new Date().toLocaleString(), status: 'active' };
              saveAll(newColl, coins, [newHistoryItem, ...history]);
              setPreviewImage(null);
              setMode("HISTORY");
           
          } else { alert("打包失败: " + (data.error || "服务器未响应")); }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) { alert("网络错误"); } finally { setGiftLoading(false); }
  };

  const handleRedeem = async () => {
      if (!redeemCode) return;
      setGiftLoading(true);
      try {
          const res = await fetch(`${CONFIG.API_BASE}/redeem`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: redeemCode.trim() })
          });
          const data = await res.json();
          if (data.success) {
              alert("兑换成功！新表情包已入库！");
              saveAll([...collection, data.itemId], coins, history);
              setRedeemCode("");
           
          } else { alert("兑换失败: " + (data.error || "无效的兑换码")); }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) { alert("网络错误"); } finally { setGiftLoading(false); }
  };

  const handleCopy = (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
          setCopyFeedback(text);
          setTimeout(() => setCopyFeedback(null), 1500);
      });
  };

  // 修复：二次防御，防止渲染时 collection 为非法对象导致崩溃
const safeCollection = Array.isArray(collection) ? collection : [];
  const safeHistory = Array.isArray(history) ? history : []; 
  const uniqueCollection = new Set(safeCollection);
  const progress = Math.round((uniqueCollection.size / CONFIG.TOTAL_ITEMS) * 100);
  const getCount = (id: number) => safeCollection.filter(x => x === id).length;

  return (
    <>
      {!hideLauncher && (
        <motion.button
          whileHover={{ scale: 1.1, rotate: 10 }} whileTap={{ scale: 0.9 }} onClick={() => setIsOpen(true)}
          className="fixed bottom-6 left-6 z-50 w-16 h-16 rounded-full bg-black/60 border-2 border-(--neon-blue) text-(--neon-blue) flex items-center justify-center backdrop-blur-md shadow-[0_0_20px_rgba(45,226,230,0.3)] hover:bg-(--neon-blue) hover:text-black transition-colors group"
        >
          <GachaIcons.Capsule />
          {showDailyBonus && <span className="absolute top-0 right-0 w-4 h-4 bg-yellow-400 rounded-full animate-bounce border border-black"></span>}
        </motion.button>
      )}

      <AnimatePresence>
        {showDailyBonus && (
          <motion.div initial={{ opacity: 0, y: 50, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="fixed bottom-24 left-6 z-[10001] bg-black/90 border border-yellow-400 p-4 rounded-xl shadow-[0_0_20px_rgba(250,204,21,0.3)] flex items-center gap-4">
            <div className="text-3xl">🎁</div>
            <div><div className="text-yellow-400 font-bold font-tech">DAILY BONUS!</div><div className="text-white text-xs">登录奖励: +{CONFIG.DAILY_REWARD} COINS</div></div>
            <button onClick={() => setShowDailyBonus(false)} className="text-gray-400 hover:text-white"><GachaIcons.Close /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-4xl bg-[#0a0a0c] border border-(--neon-blue)/30 rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[85vh] md:h-auto md:max-h-[90vh]"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <div className="w-full md:w-64 bg-black/40 border-b md:border-b-0 md:border-r border-white/10 p-4 gap-4 md:p-6 md:gap-6 flex flex-col shrink-0">
                <div className="flex justify-between items-start md:block">
                  <div><h2 className="text-xl md:text-2xl font-cyber font-bold text-white mb-1">GACHA<span className="text-(--neon-blue)">_SYS</span></h2><div className="text-[10px] md:text-xs font-mono text-gray-500">V4.3 SYNC FIX</div></div>
                </div>
                
                <div className="bg-gray-900 rounded-lg p-3 md:p-4 border border-white/5 space-y-2">
                  {user ? (
                      <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-(--neon-blue) truncate max-w-[100px]">{user.username}</span>
                          <button onClick={handleLogout} className="text-xs text-red-400 hover:underline border border-red-900/30 px-2 py-0.5 rounded bg-red-900/10">退出</button>
                      </div>
                  ) : (
                      <div onClick={() => setMode("ACCOUNT")} className="text-xs text-center text-gray-400 hover:text-white cursor-pointer border border-dashed border-gray-700 p-2 rounded hover:border-gray-500">
                          未登录 (点击登录/注册)
                      </div>
                  )}
                  <div className="w-full h-px bg-white/10 my-2"></div>
                  <div className="flex justify-between text-xs font-mono text-gray-400"><span>COLLECTION</span><span className="text-(--neon-blue)">{progress}%</span></div>
                  <div className="bg-black/40 p-2 rounded border border-yellow-500/20 flex items-center justify-between"><span className="text-xs text-gray-400 font-mono">BALANCE</span><span className="text-yellow-400 font-bold font-mono text-lg flex items-center gap-2"><GachaIcons.Coin /> {isInfiniteMode ? "∞" : coins}</span></div>
                </div>

                <div className="flex flex-row md:flex-col gap-2 mt-auto">
                  <button onClick={() => setMode("MACHINE")} className={`flex-1 p-2 md:p-3 rounded-lg border font-bold text-xs md:text-sm transition-all flex items-center justify-center gap-2 ${mode === 'MACHINE' ? 'bg-(--neon-blue) text-black border-(--neon-blue)' : 'bg-transparent text-gray-400 border-white/10 hover:text-white'}`}><GachaIcons.Capsule /> 扭蛋</button>
                  <button onClick={() => setMode("GALLERY")} className={`flex-1 p-2 md:p-3 rounded-lg border font-bold text-xs md:text-sm transition-all flex items-center justify-center gap-2 ${mode === 'GALLERY' ? 'bg-(--neon-blue) text-black border-(--neon-blue)' : 'bg-transparent text-gray-400 border-white/10 hover:text-white'}`}><GachaIcons.Gallery /> 收藏</button>
                  <button onClick={() => setMode("HISTORY")} className={`flex-1 p-2 md:p-3 rounded-lg border font-bold text-xs md:text-sm transition-all flex items-center justify-center gap-2 ${mode === 'HISTORY' ? 'bg-(--neon-blue) text-black border-(--neon-blue)' : 'bg-transparent text-gray-400 border-white/10 hover:text-white'}`}><GachaIcons.History /> 记录</button>
                  <button onClick={() => setMode("ACCOUNT")} className={`flex-1 p-2 md:p-3 rounded-lg border font-bold text-xs md:text-sm transition-all flex items-center justify-center gap-2 ${mode === 'ACCOUNT' ? 'bg-(--neon-blue) text-black border-(--neon-blue)' : 'bg-transparent text-gray-400 border-white/10 hover:text-white'}`}><GachaIcons.User /> 账号</button>
                </div>
              </div>

              <div className="flex-1 relative overflow-hidden">
                <div className="absolute inset-0 bg-cover bg-center z-0" style={{backgroundImage: "url('/Background.webp')", filter: "brightness(0.4) blur(3px)", transform: "scale(1.05)"}} />
                <div className="absolute inset-0 bg-black/90 backdrop-blur-sm -z-10" />
                
                <div className="relative z-10 w-full h-full overflow-y-auto overflow-x-hidden custom-scrollbar overscroll-contain" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'auto' }}>
                    <button onClick={() => setIsOpen(false)} className="absolute top-4 right-4 z-50 text-gray-500 hover:text-white transition-colors"><GachaIcons.Close /></button>

                    {mode === "MACHINE" && (
                      <div className="relative z-10 w-full min-h-full flex flex-col items-center justify-center p-4 md:p-8 text-center">
                        <div className="relative w-full h-[220px] md:h-[380px] mb-4 flex items-center justify-center shrink-0">
                          <AnimatePresence mode="wait">
                            {reward ? (
                              <motion.div key="reward" initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} className="flex flex-col items-center justify-center w-full h-full">
                                <div className="relative flex items-center justify-center">
                                  <div className="absolute inset-0 bg-(--neon-blue) blur-[40px] opacity-30"></div>
                                  <img src={`${CONFIG.PATH_PREFIX}${reward}.webp`} alt="Reward" className="relative z-10 max-w-[180px] max-h-[180px] md:max-w-[240px] md:max-h-[240px] object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.4)] rounded-lg" />
                                </div>
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.2 }}} className="mt-4 md:mt-6 text-(--neon-blue) font-bold font-tech tracking-widest text-lg md:text-xl text-center">MEME_GET!</motion.div>
                                <div className="text-xs text-gray-400 mt-2">当前拥有: {getCount(reward)} 张</div>
                              </motion.div>
                            ) : (
                              <motion.div key="machine" animate={isSpinning ? { x: [-5, 5, -5, 5, 0], scale: [1, 1.05, 1] } : {}} transition={{ duration: 0.5, repeat: isSpinning ? Infinity : 0 }} className="w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-(--neon-blue) flex items-center justify-center bg-black/50 shadow-[0_0_30px_rgba(45,226,230,0.2)] relative">
                                <div className="text-4xl md:text-6xl select-none">🎁</div><div className="absolute inset-0 border-t-4 border-transparent border-t-pink-500 rounded-full animate-spin duration-3000"></div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <button onClick={handleSpin} className={`relative px-10 py-3 md:px-12 md:py-4 text-lg md:text-xl font-bold font-tech tracking-widest clip-path-polygon flex flex-col items-center shrink-0 transition-all duration-200 ${isSpinning ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-(--neon-blue) text-black hover:bg-white hover:shadow-[0_0_30px_var(--neon-blue)] active:scale-95'}`} disabled={isSpinning} style={{ clipPath: "polygon(10% 0, 100% 0, 100% 70%, 90% 100%, 0 100%, 0 30%)" }}>
                          {isSpinning ? "PROCESSING..." : "START SPIN"}
                          {!isSpinning && (<div className="text-[10px] font-mono mt-1 flex items-center gap-1 opacity-80">{isInfiniteMode ? "FREE (DEV)" : `COST: ${CONFIG.COIN_COST}`} <GachaIcons.Coin /></div>)}
                        </button>
                        <div className="mt-4 text-xs text-gray-500 font-mono pb-4 md:pb-0">{isInfiniteMode ? "⚡️ DEVELOPER MODE ⚡️" : `持有: ${coins} COINS`}</div>
                      </div>
                    )}

                    {mode === "GALLERY" && (
                      <div className="relative z-10 w-full min-h-full p-4 md:p-8 pb-32">
                        <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
                          {Array.from({ length: CONFIG.TOTAL_ITEMS }, (_, i) => i + 1).map((id) => {
                            const count = getCount(id); 
                            const isOwned = count > 0;
                            return (
                              <div key={id} onClick={() => isOwned && setPreviewImage(id)} className={`aspect-square rounded-lg border flex items-center justify-center relative overflow-hidden transition-all duration-300 ${isOwned ? 'border-(--neon-blue)/30 bg-black/40 cursor-pointer hover:border-(--neon-blue) hover:shadow-[0_0_15px_rgba(45,226,230,0.2)]' : 'border-white/5 bg-white/5 opacity-50'}`}>
                                {isOwned ? (<img src={`${CONFIG.PATH_PREFIX}${id}.webp`} loading="lazy" className="w-full h-full object-cover" alt={`Meme ${id}`} />) : (<div className="text-gray-600"><GachaIcons.Lock /></div>)}
                                {isOwned && (<div className="absolute top-1 right-1 bg-(--neon-blue) text-black text-[9px] font-bold px-1.5 rounded-full min-w-[16px] text-center border border-white/20">{count}</div>)}
                                <div className="absolute bottom-1 right-2 text-[10px] font-mono text-white/50">#{String(id).padStart(3, '0')}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {mode === "HISTORY" && (
                      <div className="relative z-10 w-full h-full flex flex-col p-4 md:p-8">
                          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pb-32">
                              <div className="bg-black/50 border border-white/10 p-4 rounded-xl flex gap-2">
                                  <input type="text" placeholder="输入 GIFT-XXXX 兑换..." value={redeemCode} onChange={(e) => setRedeemCode(e.target.value)} className="flex-1 bg-black/50 border border-white/20 rounded p-2 text-white focus:border-(--neon-blue) outline-none font-mono text-sm" />
                                  <button onClick={handleRedeem} disabled={!redeemCode || giftLoading} className="bg-(--neon-blue) text-black font-bold px-4 rounded hover:bg-white transition-colors disabled:opacity-50 text-xs md:text-sm whitespace-nowrap">{giftLoading ? "..." : "兑换"}</button>
                              </div>
                              
                              <div className="flex justify-between items-center mt-4 mb-2">
                                  <div className="text-xs text-gray-500 font-mono">MY GENERATED CODES</div>
                                  <button 
                                      onClick={checkHistoryStatus}
                                      disabled={isCheckingStatus}
                                      className={`text-gray-500 hover:text-(--neon-blue) transition-colors ${isCheckingStatus ? 'animate-spin' : ''}`}
                                  >
                                      <GachaIcons.Refresh />
                                  </button>
                              </div>

                              {safeHistory.length === 0 ? (<div className="text-center text-gray-500 mt-10 text-sm">暂无打包记录</div>) : (
                                  safeHistory.map((item, idx) => (
                                      <div key={idx} className="bg-black/40 border border-white/10 rounded-lg p-3 flex gap-4 items-center group hover:border-(--neon-blue)/50 transition-colors">
                                          <div className="w-12 h-12 bg-black rounded overflow-hidden shrink-0 border border-white/10"><img src={`${CONFIG.PATH_PREFIX}${item.itemId}.webp`} alt="item" className="w-full h-full object-cover" /></div>
                                          <div className="flex-1 min-w-0">
                                              <div className="font-mono text-(--neon-blue) text-sm md:text-base font-bold truncate flex items-center gap-2 cursor-pointer" onClick={() => handleCopy(item.code)}>{item.code} <GachaIcons.Copy /></div>
                                              <div className="text-[10px] text-gray-500">{item.createdAt}</div>
                                          </div>
                                          <div className={`text-xs font-bold px-2 py-1 rounded ${item.status === 'used' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{item.status === 'used' ? '已领取' : '可领取'}</div>
                                      </div>
                                  ))
                              )}
                          </div>
                          <AnimatePresence>{copyFeedback && (<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-(--neon-blue) text-black text-xs font-bold px-4 py-2 rounded-full shadow-lg pointer-events-none">已复制: {copyFeedback}</motion.div>)}</AnimatePresence>
                      </div>
                    )}

                    {mode === "ACCOUNT" && (
                      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center p-8">
                          {user ? (
                              <div className="text-center space-y-4">
                                  <div className="text-2xl font-bold text-white">已登录: <span className="text-(--neon-blue)">{user.username}</span></div>
                                  <div className="text-gray-400 text-sm">云端同步已开启，您的进度会自动保存。</div>
                                  <button onClick={handleLogout} className="px-6 py-2 border border-red-500/50 text-red-400 rounded hover:bg-red-500/20 transition-colors">退出登录</button>
                                  
                                  <div className="mt-8 pt-8 border-t border-white/10 w-full max-w-sm">
                                      <button onClick={handleReset} className="text-xs text-red-500/70 hover:text-red-500 underline decoration-red-500/30 flex items-center justify-center gap-2 w-full">
                                          <GachaIcons.Trash /> 重置所有数据 (慎用)
                                      </button>
                                  </div>
                              </div>
                          ) : (
                              <div className="bg-black/50 border border-white/10 p-6 rounded-xl w-full max-w-sm space-y-4">
                                  <h3 className="text-xl font-bold text-white text-center mb-6">{authMode === 'LOGIN' ? '账号登录' : '注册账号'}</h3>
                                  <div className="space-y-3">
                                      <input type="text" placeholder="用户名" value={usernameInput} onChange={e => setUsernameInput(e.target.value)} className="w-full bg-black/50 border border-white/20 rounded p-3 text-white focus:border-(--neon-blue) outline-none" />
                                      <input type="password" placeholder="密码" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} className="w-full bg-black/50 border border-white/20 rounded p-3 text-white focus:border-(--neon-blue) outline-none" />
                                  </div>
                                  <button onClick={handleAuth} disabled={authLoading} className="w-full bg-(--neon-blue) text-black font-bold py-3 rounded hover:bg-white transition-colors disabled:opacity-50 mt-4">{authLoading ? "处理中..." : (authMode === 'LOGIN' ? '登 录' : '注 册')}</button>
                                  <div className="text-center text-xs text-gray-500 mt-4 cursor-pointer hover:text-white" onClick={() => setAuthMode(authMode === 'LOGIN' ? 'REGISTER' : 'LOGIN')}>{authMode === 'LOGIN' ? '没有账号？点击注册 (并同步当前进度)' : '已有账号？点击登录'}</div>
                                  
                                  <div className="mt-6 pt-4 border-t border-white/10 text-center">
                                      <button onClick={handleReset} className="text-xs text-red-500/50 hover:text-red-500">重置本地数据 (刷初始)</button>
                                  </div>
                              </div>
                          )}
                      </div>
                    )}
                </div>
              </div>
            </motion.div>

            <AnimatePresence>
              {previewImage && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/95 p-4" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPreviewImage(null); }}>
                  <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="relative max-w-full max-h-[90vh] flex flex-col items-center" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <img src={`${CONFIG.PATH_PREFIX}${previewImage}.webp`} alt="preview" className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl border border-(--neon-blue)/20" />
                      <div className="mt-6 flex flex-col items-center gap-3">
                           <div className="text-sm text-gray-300 font-bold mb-1">库存: {getCount(previewImage)} 张</div>
                           <div className="flex gap-4">
                              <button onClick={() => setPreviewImage(null)} className="flex items-center gap-2 px-6 py-2 bg-white/10 hover:bg-(--neon-blue) hover:text-black border border-white/20 rounded-full transition-colors text-sm font-bold tracking-wider"><GachaIcons.Close /> 关闭</button>
                              <button onClick={() => handleGenerateCode(previewImage)} className="flex items-center gap-2 px-6 py-2 bg-pink-500/20 hover:bg-pink-500 hover:text-white border border-pink-500/50 rounded-full transition-colors text-sm font-bold tracking-wider text-pink-300"><GachaIcons.Gift /> 打包送人</button>
                           </div>
                           <span className="text-xs text-gray-500">送出后，你的库存将 -1</span>
                      </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};