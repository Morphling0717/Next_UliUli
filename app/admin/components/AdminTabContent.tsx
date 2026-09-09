"use client";

import React from "react";
import NextImage from "next/image";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpAZ,
  Bell,
  Calendar,
  Copy,
  Film,
  FolderOpen,
  Home,
  Image as ImageIcon,
  Link,
  List,
  Lock as LockIcon,
  Mail,
  Music,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  Type,
  Users,
  Video,
  X,
  UploadCloud,
} from "lucide-react";
import { AdminTabId, AssetFile, HiddenSongItem, SiteConfig, SongItem } from "../types";

interface AdminTabContentProps {
  activeTab: AdminTabId;
  config: SiteConfig;
  songData: SongItem[];
  hiddenSongs: HiddenSongItem[];
  assetsCache: { memes: AssetFile[]; pic: AssetFile[] };
  currentAssetFolder: "memes" | "pic";
  assetSortOrder: "asc" | "desc";
  updateConfig: (section: string, key: string, val: unknown) => void;
  updateNested: (section: string, nestedKey: string, key: string, val: unknown) => void;
  updateArray: (section: string, arrayKey: string, index: number, key: string, val: unknown) => void;
  updateArraySimple: (section: string, arrayKey: string, index: number, val: unknown) => void;
  addArrayItem: (section: string, arrayKey: string, defaultValue: unknown) => void;
  removeArrayItem: (section: string, arrayKey: string, index: number) => void;
  updateCreditPerson: (creditIndex: number, personIndex: number, key: string, val: string) => void;
  addSongRow: () => void;
  removeSong: (i: number) => void;
  updateSong: (i: number, key: string, val: string) => void;
  parseBulkSongs: () => void;
  addCategory: () => void;
  removeCategory: (index: number) => void;
  moveCategory: (index: number, direction: number) => void;
  addHiddenRow: () => void;
  removeHidden: (i: number) => void;
  updateHidden: (i: number, val: string) => void;
  fetchAssets: (folder: "memes" | "pic") => Promise<void>;
  toggleAssetSort: () => void;
  uploadFile: (input: HTMLInputElement) => Promise<void>;
  copyPath: (path: string) => Promise<void>;
  renameFile: (oldName: string) => Promise<void>;
  deleteFile: (filename: string) => Promise<void>;
}

export function AdminTabContent(props: AdminTabContentProps) {
  const {
    activeTab,
    config,
    songData,
    hiddenSongs,
    assetsCache,
    currentAssetFolder,
    assetSortOrder,
    updateConfig,
    updateNested,
    updateArray,
    updateArraySimple,
    addArrayItem,
    removeArrayItem,
    updateCreditPerson,
    addSongRow,
    removeSong,
    updateSong,
    parseBulkSongs,
    addCategory,
    removeCategory,
    moveCategory,
    addHiddenRow,
    removeHidden,
    updateHidden,
    fetchAssets,
    toggleAssetSort,
    uploadFile,
    copyPath,
    renameFile,
    deleteFile,
  } = props;
  const gachaConfig = {
    pityThreshold: config.gacha?.pityThreshold ?? 8000,
    softPityStart: config.gacha?.softPityStart ?? 5000,
    baseRate: config.gacha?.baseRate ?? 0.0001,
    maxRate: config.gacha?.maxRate ?? 0.6,
  };
  const toNumber = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return (
    <div>
      {activeTab === "hero" && (
        <div className="card">
          <div className="section-title">
            <Home className="w-4 h-4" /> 首页文字配置
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="text-xs text-gray-400">顶部项目代号</label><input type="text" className="input-dark" value={config.hero?.code || ""} onChange={(e) => updateConfig("hero", "code", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">故障文字 (Glitch Text)</label><input type="text" className="input-dark" value={config.hero?.title || ""} onChange={(e) => updateConfig("hero", "title", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">副标题 (书法字)</label><input type="text" className="input-dark" value={config.hero?.subtitle || ""} onChange={(e) => updateConfig("hero", "subtitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">项目名称说明</label><input type="text" className="input-dark" value={config.hero?.projectName || ""} onChange={(e) => updateConfig("hero", "projectName", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">开始按钮文字</label><input type="text" className="input-dark" value={config.hero?.startBtn || ""} onChange={(e) => updateConfig("hero", "startBtn", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">页面滚动提示文字</label><input type="text" className="input-dark" value={config.hero?.scrollText || "SCROLL"} onChange={(e) => updateConfig("hero", "scrollText", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">项目状态文字</label><input type="text" className="input-dark" value={config.hero?.statusText || ""} onChange={(e) => updateConfig("hero", "statusText", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">粉丝数字前缀</label><input type="text" className="input-dark" value={config.hero?.followersText || ""} onChange={(e) => updateConfig("hero", "followersText", e.target.value)} /></div>
          </div>
        </div>
      )}

      {activeTab === "model" && (
        <>
          <div className="card">
            <div className="section-title"><Type className="w-4 h-4" /> 基础文案 (拆分修改)</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div><label className="text-xs text-gray-400">标题前缀 (白字)</label><input type="text" className="input-dark" value={config.model?.titlePrefix || "PROJECT"} onChange={(e) => updateConfig("model", "titlePrefix", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">标题后缀 (蓝字)</label><input type="text" className="input-dark" value={config.model?.titleSuffix || "_DATA"} onChange={(e) => updateConfig("model", "titleSuffix", e.target.value)} /></div>
              <div className="md:col-span-2"><label className="text-xs text-gray-400">同步率文案</label><input type="text" className="input-dark" value={config.model?.syncRate || "SYNC_RATE: 100%"} onChange={(e) => updateConfig("model", "syncRate", e.target.value)} /></div>
            </div>
          </div>
          <div className="card">
            <div className="section-title"><ImageIcon className="w-4 h-4" /> 详情图 (Details)</div>
            <div className="grid gap-4">
              {(config.model?.details || []).map((d, i) => (
                <div key={i} className="flex gap-2 items-center bg-black/20 p-3 rounded">
                  <span className="text-sm font-mono w-8">#{i + 1}</span>
                  <input type="text" className="input-dark w-32 text-sm" placeholder="ID" value={d.id} onChange={(e) => updateArray("model", "details", i, "id", e.target.value)} />
                  <input type="text" className="input-dark flex-1 text-sm" placeholder="图片路径 (pic/...)" value={d.img} onChange={(e) => updateArray("model", "details", i, "img", e.target.value)} />
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="section-title"><Users className="w-4 h-4" /> 制作人员 (Credits)</div>
            <div className="space-y-4">
              {(config.model?.credits || []).map((c, i) => (
                <div key={i} className="bg-black/20 p-3 rounded border border-white/5">
                  <div className="flex justify-between mb-2">
                    <input type="text" className="input-dark w-1/3 text-xs font-bold text-[#2de2e6]" placeholder="分类标签" value={c.label} onChange={(e) => updateArray("model", "credits", i, "label", e.target.value)} />
                  </div>
                  <div className="text-xs text-gray-500 mb-2 pl-4">人员 / 网址</div>
                  {c.val.map((person, pi) => (
                    <div key={pi} className="flex gap-2 mb-2 pl-4">
                      <input type="text" className="input-dark w-32 text-sm" placeholder="人员名字" value={person.name} onChange={(e) => updateCreditPerson(i, pi, "name", e.target.value)} />
                      <input type="text" className="input-dark flex-1 text-sm" placeholder="https://example.com (可留空)" value={person.link} onChange={(e) => updateCreditPerson(i, pi, "link", e.target.value)} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === "live" && (
        <>
          <div className="card">
            <div className="section-title"><Radio className="w-4 h-4" /> 直播信息标题</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div><label className="text-xs text-gray-400">板块标题</label><input type="text" className="input-dark" value={config.live?.title || ""} onChange={(e) => updateConfig("live", "title", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">直播间号</label><input type="text" className="input-dark" value={config.live?.roomId || ""} onChange={(e) => updateConfig("live", "roomId", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">房间号前缀文字</label><input type="text" className="input-dark" value={config.live?.roomPrefix || ""} onChange={(e) => updateConfig("live", "roomPrefix", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">直播中文案</label><input type="text" className="input-dark" value={config.live?.liveNowText || ""} onChange={(e) => updateConfig("live", "liveNowText", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">离线文案</label><input type="text" className="input-dark" value={config.live?.offlineText || ""} onChange={(e) => updateConfig("live", "offlineText", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">时间表标题</label><input type="text" className="input-dark" value={config.live?.scheduleTitle || ""} onChange={(e) => updateConfig("live", "scheduleTitle", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">点歌规则标题</label><input type="text" className="input-dark" value={config.live?.rulesTitle || ""} onChange={(e) => updateConfig("live", "rulesTitle", e.target.value)} /></div>
              <div className="md:col-span-2"><label className="text-xs text-gray-400">小游戏传送门文案</label><input type="text" className="input-dark" value={config.live?.gamePortalText || ""} onChange={(e) => updateConfig("live", "gamePortalText", e.target.value)} /></div>
            </div>
          </div>
          <div className="card">
            <div className="section-title"><Calendar className="w-4 h-4" /> 时间表文案</div>
            <div className="grid gap-2">
              <div><label className="text-xs text-gray-400">早场文案</label><input type="text" className="input-dark" placeholder="早场: 10:00 - 13:00" value={config.live?.schedule?.morning || ""} onChange={(e) => updateNested("live", "schedule", "morning", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">晚场文案</label><input type="text" className="input-dark" placeholder="晚场: 17:00 - 20:00" value={config.live?.schedule?.evening || ""} onChange={(e) => updateNested("live", "schedule", "evening", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">休息日文案 (例如: 周一休)</label><input type="text" className="input-dark" placeholder="周一休" value={config.live?.schedule?.off || ""} onChange={(e) => updateNested("live", "schedule", "off", e.target.value)} /></div>
            </div>
          </div>
          <div className="card">
            <div className="section-title"><List className="w-4 h-4" /> 点歌规则 (列表)</div>
            <div className="space-y-2 mb-2">
              {(config.live?.rules || []).map((rule, i) => (
                <div key={i} className="flex gap-2 items-center bg-black/20 p-2 rounded">
                  <span className="text-xs font-mono text-gray-500">{i + 1}.</span>
                  <input type="text" className="input-dark flex-1" value={rule} onChange={(e) => updateArraySimple("live", "rules", i, e.target.value)} />
                  <button onClick={() => removeArrayItem("live", "rules", i)} className="delete-btn"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => addArrayItem("live", "rules", "新规则")} className="text-xs bg-[#2de2e6]/10 text-[#2de2e6] px-3 py-1.5 rounded hover:bg-[#2de2e6]/20 transition flex items-center gap-1"><Plus className="w-3 h-3" /> 添加规则</button>
          </div>
          <div className="card">
            <div className="section-title"><Link className="w-4 h-4" /> 外部链接按钮</div>
            <div className="text-xs text-gray-400 mb-3">格式：按钮文案 / 链接地址 / 颜色 / 图标</div>
            <div className="space-y-2">
              {(config.live?.links || []).map((l, i) => (
                <div key={i} className="flex gap-2 bg-black/20 p-3 rounded">
                  <input type="text" className="input-dark w-32 text-sm" placeholder="按钮文案" value={l.title} onChange={(e) => updateArray("live", "links", i, "title", e.target.value)} />
                  <input type="text" className="input-dark flex-1 text-sm" placeholder="https://example.com" value={l.url} onChange={(e) => updateArray("live", "links", i, "url", e.target.value)} />
                  <select className="input-dark w-24" value={l.color} onChange={(e) => updateArray("live", "links", i, "color", e.target.value)}>
                    <option value="pink">粉色</option><option value="cyan">青色</option><option value="purple">紫色</option><option value="white">白色</option>
                  </select>
                  <select className="input-dark w-24" value={l.icon} onChange={(e) => updateArray("live", "links", i, "icon", e.target.value)}>
                    <option value="Music">音乐</option><option value="Video">视频</option><option value="Sparkles">星光</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === "video" && (
        <div className="card">
          <div className="section-title"><Film className="w-4 h-4" /> 视频墙配置 (拆分修改)</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="text-xs text-gray-400">标题前缀 (白字)</label><input type="text" className="input-dark" value={config.gallery?.titlePrefix || "VISUAL"} onChange={(e) => updateConfig("gallery", "titlePrefix", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">标题后缀 (蓝字)</label><input type="text" className="input-dark" value={config.gallery?.titleSuffix || "_ARCHIVE"} onChange={(e) => updateConfig("gallery", "titleSuffix", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">下方滚动文字</label><input type="text" className="input-dark" value={config.gallery?.scrollText || "SCROLL TO EXPLORE >>>"} onChange={(e) => updateConfig("gallery", "scrollText", e.target.value)} /></div>
            <div className="md:col-span-2 mt-4">
              <label htmlFor="bilibili-api-path" className="text-xs text-gray-400">站内 API 路径</label>
              <input id="bilibili-api-path" type="text" className="input-dark" value="/api/bilibili" readOnly aria-describedby="bilibili-api-help" />
              <p id="bilibili-api-help" className="mt-2 text-xs text-gray-400">上游地址由服务器 BILIBILI_API_URL 配置。</p>
            </div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">视频日期前缀 (如: DATE //)</label><input type="text" className="input-dark" value={config.gallery?.datePrefix || ""} onChange={(e) => updateConfig("gallery", "datePrefix", e.target.value)} /></div>
          </div>
        </div>
      )}

      {activeTab === "games" && (
        <div className="card">
          <div className="section-title"><Video className="w-4 h-4" /> 游戏弹窗文案</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="text-xs text-gray-400">大厅标题前缀</label><input type="text" className="input-dark" value={config.games?.lobbyTitlePrefix || ""} onChange={(e) => updateConfig("games", "lobbyTitlePrefix", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">大厅标题后缀</label><input type="text" className="input-dark" value={config.games?.lobbyTitleSuffix || ""} onChange={(e) => updateConfig("games", "lobbyTitleSuffix", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">大厅副标题</label><input type="text" className="input-dark" value={config.games?.lobbySubtitle || ""} onChange={(e) => updateConfig("games", "lobbySubtitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">名字大乱斗标题</label><input type="text" className="input-dark" value={config.games?.arenaTitle || ""} onChange={(e) => updateConfig("games", "arenaTitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">名字大乱斗状态</label><input type="text" className="input-dark" value={config.games?.arenaStatus || ""} onChange={(e) => updateConfig("games", "arenaStatus", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">名字大乱斗描述</label><input type="text" className="input-dark" value={config.games?.arenaDesc || ""} onChange={(e) => updateConfig("games", "arenaDesc", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">DGP 标题</label><input type="text" className="input-dark" value={config.games?.dgpTitle || ""} onChange={(e) => updateConfig("games", "dgpTitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">DGP 状态</label><input type="text" className="input-dark" value={config.games?.dgpStatus || ""} onChange={(e) => updateConfig("games", "dgpStatus", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">DGP 描述</label><input type="text" className="input-dark" value={config.games?.dgpDesc || ""} onChange={(e) => updateConfig("games", "dgpDesc", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">返回按钮文案</label><input type="text" className="input-dark" value={config.games?.returnText || ""} onChange={(e) => updateConfig("games", "returnText", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">迁移标题</label><input type="text" className="input-dark" value={config.games?.migratingTitle || ""} onChange={(e) => updateConfig("games", "migratingTitle", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">迁移说明</label><input type="text" className="input-dark" value={config.games?.migratingDesc || ""} onChange={(e) => updateConfig("games", "migratingDesc", e.target.value)} /></div>
          </div>
        </div>
      )}

      {activeTab === "footer" && (
        <div className="card">
          <div className="section-title"><Type className="w-4 h-4" /> 底部版权</div>
          <input type="text" className="input-dark" value={config.footer?.text || ""} onChange={(e) => updateConfig("footer", "text", e.target.value)} />
        </div>
      )}

      {activeTab === "mail" && (
        <>
          <div className="card">
            <div className="section-title"><Mail className="w-4 h-4" /> 主站访客入口（左下浮动菜单）</div>
            <div className="text-xs text-gray-500 mb-4">这些文字显示在主页左下角的 Speed Dial 发信按钮上，访客打开主站就能看到。</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">按钮标题</label>
                <input type="text" className="input-dark" placeholder="发信箱" value={config.mail?.entryLabel || ""} onChange={(e) => updateConfig("mail", "entryLabel", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400">Tooltip（开启态）</label>
                <input type="text" className="input-dark" placeholder="匿名投信给 Uli" value={config.mail?.entryHint || ""} onChange={(e) => updateConfig("mail", "entryHint", e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">Tooltip（发信箱关闭时）</label>
                <input type="text" className="input-dark" placeholder="发信箱暂时关闭" value={config.mail?.entryHintDisabled || ""} onChange={(e) => updateConfig("mail", "entryHintDisabled", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title"><Type className="w-4 h-4" /> 发信弹窗主体文案</div>
            <div className="text-xs text-gray-500 mb-4">这些文字显示在访客点开发信弹窗后，看到的表单卡片上。</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">卡片标题</label>
                <input type="text" className="input-dark" placeholder="MAIL_BOX" value={config.mail?.senderTitle || ""} onChange={(e) => updateConfig("mail", "senderTitle", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400">副标题 / 招呼语</label>
                <input type="text" className="input-dark" placeholder="把想对 Uli 说的话，匿名地投进这个信箱" value={config.mail?.senderTagline || ""} onChange={(e) => updateConfig("mail", "senderTagline", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400">状态徽章（开启）</label>
                <input type="text" className="input-dark" placeholder="ONLINE" value={config.mail?.statusOpen || ""} onChange={(e) => updateConfig("mail", "statusOpen", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400">状态徽章（关闭）</label>
                <input type="text" className="input-dark" placeholder="OFFLINE" value={config.mail?.statusPaused || ""} onChange={(e) => updateConfig("mail", "statusPaused", e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">发送成功提示</label>
                <input type="text" className="input-dark" placeholder="SIGNAL SENT · 信号已送达，Uli 会在直播时读到 ~" value={config.mail?.successMessage || ""} onChange={(e) => updateConfig("mail", "successMessage", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title"><Pencil className="w-4 h-4" /> 输入框占位符</div>
            <div className="text-xs text-gray-500 mb-4">访客未填写内容时，输入框里的灰色提示文字。</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">正文输入框</label>
                <input type="text" className="input-dark" placeholder="在这里写下你想说的话…" value={config.mail?.placeholderText || ""} onChange={(e) => updateConfig("mail", "placeholderText", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400">称呼输入框</label>
                <input type="text" className="input-dark" placeholder="称呼（可选）" value={config.mail?.placeholderNickname || ""} onChange={(e) => updateConfig("mail", "placeholderNickname", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400">链接输入框</label>
                <input type="text" className="input-dark" placeholder="B站 / X / 外站链接（可选）" value={config.mail?.placeholderLink || ""} onChange={(e) => updateConfig("mail", "placeholderLink", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title"><Radio className="w-4 h-4" /> 关闭态文案</div>
            <div className="text-xs text-gray-500 mb-4">当后台 <code className="text-[#2de2e6]">/mail</code> 页面把发信箱开关关闭时，访客会看到的提示文字。</div>
            <div className="grid gap-4">
              <div>
                <label className="text-xs text-gray-400">弹窗顶部禁用横幅</label>
                <input type="text" className="input-dark" placeholder="发信箱暂时关闭，稍后再来投递吧 ~" value={config.mail?.disabledBanner || ""} onChange={(e) => updateConfig("mail", "disabledBanner", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400">表单内说明文字</label>
                <input type="text" className="input-dark" placeholder="OFFLINE · 发信箱暂时关闭，稍后再来投递吧 ~" value={config.mail?.pausedMessage || ""} onChange={(e) => updateConfig("mail", "pausedMessage", e.target.value)} />
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "songs" && (
        <>
          <div className="card">
            <div className="section-title">界面标题设置</div>
            <div className="grid gap-4 md:grid-cols-2 mb-4">
              <div><label className="text-xs text-gray-400">标题前缀 (白字)</label><input type="text" className="input-dark" value={config.song_ui?.titlePrefix || "SONG"} onChange={(e) => updateNested("song_ui", "titlePrefix", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">标题后缀 (蓝字)</label><input type="text" className="input-dark" value={config.song_ui?.titleSuffix || "_DATABASE"} onChange={(e) => updateNested("song_ui", "titleSuffix", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">服务器状态文字</label><input type="text" className="input-dark" value={config.song_ui?.serverText || "SERVER:"} onChange={(e) => updateNested("song_ui", "serverText", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">在线状态文字</label><input type="text" className="input-dark" value={config.song_ui?.serverOnline || "ONLINE"} onChange={(e) => updateNested("song_ui", "serverOnline", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">离线状态文字</label><input type="text" className="input-dark" value={config.song_ui?.serverOffline || "OFFLINE"} onChange={(e) => updateNested("song_ui", "serverOffline", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">虚拟货币文字</label><input type="text" className="input-dark" value={config.song_ui?.pityText || "PITY:"} onChange={(e) => updateNested("song_ui", "pityText", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">搜索框提示文字</label><input type="text" className="input-dark" value={config.song_ui?.searchPlaceholder || "SEARCH..."} onChange={(e) => updateNested("song_ui", "searchPlaceholder", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">随机按钮文字</label><input type="text" className="input-dark" value={config.song_ui?.randomizeBtn || "RANDOMIZE"} onChange={(e) => updateNested("song_ui", "randomizeBtn", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">同步中按钮文字</label><input type="text" className="input-dark" value={config.song_ui?.syncingBtn || "SYNC..."} onChange={(e) => updateNested("song_ui", "syncingBtn", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">复制提示前缀</label><input type="text" className="input-dark" value={config.song_ui?.copiedPrefix || ""} onChange={(e) => updateNested("song_ui", "copiedPrefix", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">无数据提示</label><input type="text" className="input-dark" value={config.song_ui?.emptyText || ""} onChange={(e) => updateNested("song_ui", "emptyText", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">隐藏曲标签文字</label><input type="text" className="input-dark" value={config.song_ui?.secretTag || ""} onChange={(e) => updateNested("song_ui", "secretTag", "", e.target.value)} /></div>
              <div><label className="text-xs text-gray-400">已复制标识</label><input type="text" className="input-dark" value={config.song_ui?.copiedTag || ""} onChange={(e) => updateNested("song_ui", "copiedTag", "", e.target.value)} /></div>
            </div>
          </div>
          <div className="card bg-[#1e293b]/50 border-dashed">
            <div className="section-title text-[#2de2e6]"><Music className="w-4 h-4" /> 歌单分类设置 (Style Config)</div>
            <div className="space-y-2 mb-4">
              {(config.song_ui?.categories || []).map((cat, i) => (
                <div key={i} className="flex gap-2 items-center bg-black/30 p-2 rounded border border-white/5">
                  <span className="text-xs text-gray-500 w-6 text-center">{i + 1}</span>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => moveCategory(i, -1)} disabled={i === 0} className="action-btn" style={i === 0 ? { opacity: 0.3 } : {}}><ArrowUp className="w-3 h-3" /></button>
                    <button onClick={() => moveCategory(i, 1)} disabled={i === (config.song_ui?.categories?.length || 0) - 1} className="action-btn" style={i === (config.song_ui?.categories?.length || 0) - 1 ? { opacity: 0.3 } : {}}><ArrowDown className="w-3 h-3" /></button>
                  </div>
                  <input type="text" className="input-dark w-24 text-xs font-mono" value={cat.id} onChange={(e) => updateArray("song_ui", "categories", i, "id", e.target.value)} placeholder="ID (key)" />
                  <input type="text" className="input-dark flex-1 text-xs" value={cat.label} onChange={(e) => updateArray("song_ui", "categories", i, "label", e.target.value)} placeholder="Label" />
                  <button onClick={() => removeCategory(i)} className="delete-btn"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={addCategory} className="w-full py-2 bg-[#2de2e6]/10 text-[#2de2e6] text-xs font-bold rounded hover:bg-[#2de2e6]/20 transition flex items-center justify-center gap-2"><Plus className="w-3 h-3" /> 添加新风格 (Add Style)</button>
          </div>
          <div className="card">
            <div className="section-title flex justify-between"><span>歌单管理</span><div className="text-xs text-gray-400 font-normal">共 {songData.length} 首</div></div>
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
              <input type="text" className="input-dark pl-9" placeholder="快速搜寻歌名或歌手..." onInput={(e) => {
                const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
                const rows = document.querySelectorAll("#song-list-container > div");
                rows.forEach((row) => {
                  const inputs = row.querySelectorAll("input");
                  if (inputs.length >= 2) {
                    const name = (inputs[0] as HTMLInputElement).value.toLowerCase();
                    const artist = (inputs[1] as HTMLInputElement).value.toLowerCase();
                    (row as HTMLElement).style.display = name.includes(q) || artist.includes(q) ? "" : "none";
                  }
                });
              }} />
            </div>
            <div className="flex gap-2 mb-4">
              <button onClick={addSongRow} className="bg-green-600 px-3 py-1 rounded text-xs font-bold hover:bg-green-500">+ 添加一行</button>
              <button onClick={() => alert("请直接修改输入框内容，保存即可")} className="bg-blue-600 px-3 py-1 rounded text-xs font-bold hover:bg-blue-500">? 如何使用</button>
            </div>
            <div className="h-[600px] min-h-[300px] resize-y overflow-y-auto custom-scrollbar space-y-2 border border-white/5 rounded p-2" id="song-list-container">
              {songData.map((s, i) => {
                const assignableCategories = config.song_ui?.categories?.filter((c) => c.id !== "all") || [];
                return (
                  <div key={i} className="flex gap-2 items-center bg-black/20 p-2 rounded group">
                    <span className="text-xs text-gray-500 w-8 text-center">{i + 1}</span>
                    <select className="input-dark w-24 text-xs" value={s.category} onChange={(e) => updateSong(i, "category", e.target.value)}>
                      {assignableCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      {!assignableCategories.find((c) => c.id === s.category) && <option value={s.category} style={{ color: "red" }}>未知({s.category})</option>}
                    </select>
                    <input type="text" className="input-dark flex-1 text-sm" value={s.name} onChange={(e) => updateSong(i, "name", e.target.value)} placeholder="歌名" />
                    <input type="text" className="input-dark w-1/3 text-sm" value={s.artist} onChange={(e) => updateSong(i, "artist", e.target.value)} placeholder="歌手" />
                    <button onClick={() => removeSong(i)} className="text-red-500 hover:text-red-400 p-1 opacity-50 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="section-title">批量添加 (Excel模式)</div>
            <textarea id="bulk-songs" className="input-dark h-32 font-mono text-xs" placeholder="歌名 歌手 (每行一首，默认分类为列表第一个非All分类，需手动调整)" />
            <button onClick={parseBulkSongs} className="mt-2 bg-purple-600 px-4 py-2 rounded text-sm font-bold hover:bg-purple-500">批量导入</button>
          </div>
        </>
      )}

      {activeTab === "hidden" && (
        <div className="card">
          <div className="section-title text-purple-400"><LockIcon className="w-4 h-4" /> 隐藏歌单 (盲盒池)</div>
          <div className="h-[500px] overflow-y-auto custom-scrollbar space-y-2">
            {hiddenSongs.map((s, i) => (
              <div key={i} className="flex gap-2 items-center bg-purple-900/20 p-2 rounded border border-purple-500/20">
                <span className="text-xs text-purple-500 w-8 text-center">{i + 1}</span>
                <input type="text" className="input-dark flex-1 text-sm" value={s.name} onChange={(e) => updateHidden(i, e.target.value)} />
                <button onClick={() => removeHidden(i)} className="text-red-400 hover:text-red-300 p-1"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <button onClick={addHiddenRow} className="mt-4 bg-purple-600 w-full py-2 rounded font-bold hover:bg-purple-500">+ 添加隐藏条目</button>
        </div>
      )}

      {activeTab === "gacha" && (
        <div className="card">
          <div className="section-title text-purple-400"><LockIcon className="w-4 h-4" /> 出金概率与保底配置</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-400">硬保底次数 (pityThreshold)</label>
              <input
                type="number"
                min={1}
                step={1}
                className="input-dark"
                value={gachaConfig.pityThreshold}
                onChange={(e) => updateConfig("gacha", "pityThreshold", Math.max(1, Math.round(toNumber(e.target.value, 8000))))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">软保底开始次数 (softPityStart)</label>
              <input
                type="number"
                min={0}
                step={1}
                className="input-dark"
                value={gachaConfig.softPityStart}
                onChange={(e) => updateConfig("gacha", "softPityStart", Math.max(0, Math.round(toNumber(e.target.value, 5000))))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">基础概率 (baseRate, 0~1)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.000001}
                className="input-dark"
                value={gachaConfig.baseRate}
                onChange={(e) => updateConfig("gacha", "baseRate", Math.min(1, Math.max(0, toNumber(e.target.value, 0.0001))))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">软保底上限概率 (maxRate, 0~1)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.000001}
                className="input-dark"
                value={gachaConfig.maxRate}
                onChange={(e) => updateConfig("gacha", "maxRate", Math.min(1, Math.max(0, toNumber(e.target.value, 0.6))))}
              />
            </div>
            <div className="md:col-span-2 text-xs text-gray-500 bg-black/20 rounded p-3">
              说明：这里填写的是 0~1 的小数概率，例如 0.01 = 1%。保存后前台随机点歌会立即按新参数计算出金。
            </div>
          </div>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="card">
          <div className="section-title"><Bell className="w-4 h-4" /> 通知文本配置</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="text-xs text-gray-400">模型被点击通知</label><input type="text" className="input-dark" value={config.notifications?.modelClicked || ""} onChange={(e) => updateConfig("notifications", "modelClicked", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">点击警告文案</label><input type="text" className="input-dark" placeholder="WARNING: {count} CLICKS TO OVERRIDE" value={config.notifications?.clickWarning || ""} onChange={(e) => updateConfig("notifications", "clickWarning", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">解锁通知</label><input type="text" className="input-dark" value={config.notifications?.unlocked || ""} onChange={(e) => updateConfig("notifications", "unlocked", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">已解锁通知</label><input type="text" className="input-dark" value={config.notifications?.alreadyUnlocked || ""} onChange={(e) => updateConfig("notifications", "alreadyUnlocked", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">系统初始化文案</label><input type="text" className="input-dark" value={config.notifications?.systemInitializing || ""} onChange={(e) => updateConfig("notifications", "systemInitializing", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">出金弹窗标题</label><input type="text" className="input-dark" value={config.notifications?.goldenAlertTitle || ""} onChange={(e) => updateConfig("notifications", "goldenAlertTitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">出金弹窗副标题</label><input type="text" className="input-dark" value={config.notifications?.goldenAlertSubtitle || ""} onChange={(e) => updateConfig("notifications", "goldenAlertSubtitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">出金恭喜标题</label><input type="text" className="input-dark" value={config.notifications?.goldenCongratsTitle || ""} onChange={(e) => updateConfig("notifications", "goldenCongratsTitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">时间戳前缀</label><input type="text" className="input-dark" value={config.notifications?.timestampPrefix || ""} onChange={(e) => updateConfig("notifications", "timestampPrefix", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">出金说明正文</label><input type="text" className="input-dark" value={config.notifications?.goldenBody || ""} onChange={(e) => updateConfig("notifications", "goldenBody", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">确认按钮文案</label><input type="text" className="input-dark" value={config.notifications?.acknowledgeText || ""} onChange={(e) => updateConfig("notifications", "acknowledgeText", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">错误页标题</label><input type="text" className="input-dark" value={config.errors?.title || ""} onChange={(e) => updateConfig("errors", "title", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">错误页说明</label><input type="text" className="input-dark" value={config.errors?.message || ""} onChange={(e) => updateConfig("errors", "message", e.target.value)} /></div>
            <div className="md:col-span-2"><label className="text-xs text-gray-400">错误页重试按钮</label><input type="text" className="input-dark" value={config.errors?.retryText || ""} onChange={(e) => updateConfig("errors", "retryText", e.target.value)} /></div>
          </div>
        </div>
      )}

      {activeTab === "videos" && (
        <div className="card">
          <div className="section-title"><Film className="w-4 h-4" /> 视频区域标题配置</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="text-xs text-gray-400">隐藏存档已解锁标题</label><input type="text" className="input-dark" placeholder="🔓 HIDDEN_ARCHIVE_UNLOCKED" value={config.videos?.hiddenTitle || ""} onChange={(e) => updateConfig("videos", "hiddenTitle", e.target.value)} /></div>
            <div><label className="text-xs text-gray-400">系统视频源标题</label><input type="text" className="input-dark" placeholder="📺 SYSTEM_VIDEO_FEED" value={config.videos?.unlockedTitle || ""} onChange={(e) => updateConfig("videos", "unlockedTitle", e.target.value)} /></div>
          </div>
        </div>
      )}

      {activeTab === "assets" && (() => {
        const files = (assetsCache[currentAssetFolder] || []).sort((a, b) => {
          const comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
          return assetSortOrder === "asc" ? comparison : -comparison;
        });
        return (
          <div className="card">
            <div className="section-title flex justify-between items-center">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1"><FolderOpen className="w-4 h-4" /> 资源管理器</span>
                <div className="flex bg-black/30 rounded p-1">
                  <button onClick={() => fetchAssets("memes")} className={`px-3 py-1 text-xs rounded transition ${currentAssetFolder === "memes" ? "bg-cyan-500 text-black font-bold" : "text-gray-400 hover:text-white"}`}>memes (表情包)</button>
                  <button onClick={() => fetchAssets("pic")} className={`px-3 py-1 text-xs rounded transition ${currentAssetFolder === "pic" ? "bg-cyan-500 text-black font-bold" : "text-gray-400 hover:text-white"}`}>pic (图片)</button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={toggleAssetSort} className="bg-white/10 hover:bg-white/20 px-3 py-2 rounded text-gray-300 text-xs font-bold flex items-center gap-2">
                  {assetSortOrder === "asc" ? <ArrowDownAZ className="w-4 h-4" /> : <ArrowUpAZ className="w-4 h-4" />}
                  {assetSortOrder === "asc" ? "A-Z" : "Z-A"}
                </button>
                <label className="cursor-pointer bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded text-xs font-bold transition flex items-center gap-2">
                  <UploadCloud className="w-4 h-4" /> 上传文件
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => uploadFile(e.currentTarget)} />
                </label>
                <button onClick={() => fetchAssets(currentAssetFolder)} className="bg-white/10 hover:bg-white/20 p-2 rounded text-gray-300"><RefreshCw className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="text-xs text-gray-500 mb-4 font-mono">当前路径: /{currentAssetFolder}/ (共 {files.length} 个文件)</div>
            <div className="asset-grid max-h-[600px] overflow-y-auto custom-scrollbar p-1">
              {files.length > 0 ? files.map((f) => (
                <div key={f.name} className="asset-item">
                  <div className="asset-img-box">
                    <NextImage src={`${f.path}?t=${f.time}`} className="asset-img" fill sizes="180px" alt={f.name} unoptimized />
                  </div>
                  <div className="asset-info truncate" title={f.name}>{f.name}</div>
                  <div className="asset-actions">
                    <button onClick={() => copyPath(f.path)} className="text-white hover:text-cyan-400" title="复制路径"><Copy className="w-4 h-4" /></button>
                    <button onClick={() => renameFile(f.name)} className="text-white hover:text-yellow-400" title="重命名"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteFile(f.name)} className="text-white hover:text-red-400" title="删除"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              )) : <div className="col-span-full text-center text-gray-500 py-10">文件夹为空</div>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
