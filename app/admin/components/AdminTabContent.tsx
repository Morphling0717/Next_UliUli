"use client";

import React, { useMemo, useState } from "react";
import NextImage from "next/image";
import Swal from "sweetalert2";
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
  Settings,
  Trash2,
  Type,
  Users,
  Video,
  X,
  UploadCloud,
} from "lucide-react";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-config";
import {
  AdminTabId,
  AssetFile,
  EditableSiteConfig,
  HiddenSongItem,
  SongItem,
} from "../types";

interface AdminTabContentProps {
  activeTab: AdminTabId;
  config: EditableSiteConfig;
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
  updateCreditPerson: (creditIndex: number, personIndex: number, key: "name" | "link", val: string) => void;
  addCreditGroup: () => void;
  removeCreditGroup: (creditIndex: number) => void;
  addCreditPerson: (creditIndex: number) => void;
  removeCreditPerson: (creditIndex: number, personIndex: number) => void;
  addSongRow: () => void;
  removeSong: (i: number) => void | Promise<void>;
  updateSong: (i: number, key: "category" | "name" | "artist", val: string) => void;
  parseBulkSongs: () => void;
  addCategory: () => void;
  removeCategory: (index: number) => void | Promise<void>;
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

const d = DEFAULT_SITE_CONFIG;

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
    addCreditGroup,
    removeCreditGroup,
    addCreditPerson,
    removeCreditPerson,
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

  const [songSearchQuery, setSongSearchQuery] = useState("");

  const filteredSongs = useMemo(() => {
    const q = songSearchQuery.toLowerCase().trim();
    return songData
      .map((song, index) => ({ song, index }))
      .filter(({ song }) => {
        if (!q) return true;
        return (
          song.name.toLowerCase().includes(q) ||
          song.artist.toLowerCase().includes(q)
        );
      });
  }, [songData, songSearchQuery]);

  const sortedAssets = useMemo(() => {
    const list = [...(assetsCache[currentAssetFolder] || [])];
    list.sort((a, b) => {
      const comparison = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return assetSortOrder === "asc" ? comparison : -comparison;
    });
    return list;
  }, [assetsCache, currentAssetFolder, assetSortOrder]);

  const gachaConfig = {
    pityThreshold: config.gacha.pityThreshold ?? d.gacha.pityThreshold,
    softPityStart: config.gacha.softPityStart ?? d.gacha.softPityStart,
    baseRate: config.gacha.baseRate ?? d.gacha.baseRate,
    maxRate: config.gacha.maxRate ?? d.gacha.maxRate,
  };

  const toNumber = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const showSongHelp = () => {
    void Swal.fire({
      icon: "info",
      title: "歌单编辑说明",
      text: "直接修改每行分类、歌名和歌手，编辑完成后点击右上角 SAVE CHANGES 保存即可。清空某个文字项保存会自动恢复默认文案。",
      background: "#1e293b",
      color: "#fff",
      confirmButtonColor: "#2de2e6",
    });
  };

  return (
    <div>
      {activeTab === "hero" && (
        <div className="card">
          <div className="section-title">
            <Home className="w-4 h-4" /> 首页文字配置
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-400">顶部项目代号</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.code}
                value={config.hero.code}
                onChange={(e) => updateConfig("hero", "code", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">故障文字 (Glitch Text)</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.title}
                value={config.hero.title}
                onChange={(e) => updateConfig("hero", "title", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">副标题 (书法字)</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.subtitle}
                value={config.hero.subtitle}
                onChange={(e) => updateConfig("hero", "subtitle", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">项目名称说明</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.projectName}
                value={config.hero.projectName}
                onChange={(e) => updateConfig("hero", "projectName", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">开始按钮文字</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.startBtn}
                value={config.hero.startBtn}
                onChange={(e) => updateConfig("hero", "startBtn", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">页面滚动提示文字</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.scrollText}
                value={config.hero.scrollText}
                onChange={(e) => updateConfig("hero", "scrollText", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">项目状态文字</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.statusText}
                value={config.hero.statusText}
                onChange={(e) => updateConfig("hero", "statusText", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">粉丝数字前缀</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.followersText}
                value={config.hero.followersText}
                onChange={(e) => updateConfig("hero", "followersText", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">统计加载中</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.statsLoadingText}
                value={config.hero.statsLoadingText}
                onChange={(e) => updateConfig("hero", "statsLoadingText", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">请求错误状态</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.statsErrorText}
                value={config.hero.statsErrorText}
                onChange={(e) => updateConfig("hero", "statsErrorText", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">离线状态</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.hero.statsOfflineText}
                value={config.hero.statsOfflineText}
                onChange={(e) => updateConfig("hero", "statsOfflineText", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "model" && (
        <>
          <div className="card">
            <div className="section-title">
              <Type className="w-4 h-4" /> 基础文案 (拆分修改)
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">标题前缀 (白字)</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.model.titlePrefix}
                  value={config.model.titlePrefix}
                  onChange={(e) => updateConfig("model", "titlePrefix", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">标题后缀 (蓝字)</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.model.titleSuffix}
                  value={config.model.titleSuffix}
                  onChange={(e) => updateConfig("model", "titleSuffix", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">同步率文案</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.model.syncRate}
                  value={config.model.syncRate}
                  onChange={(e) => updateConfig("model", "syncRate", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <ImageIcon className="w-4 h-4" /> 详情图 (Details)
            </div>
            <div className="grid gap-3 mb-3">
              {config.model.details.map((item, i) => (
                <div key={i} className="flex gap-2 items-center bg-black/20 p-3 rounded">
                  <span className="text-sm font-mono w-8 text-gray-400">#{i + 1}</span>
                  <input
                    type="text"
                    className="input-dark w-32 text-sm"
                    placeholder="ID（如 MIC）"
                    value={item.id}
                    onChange={(e) => updateArray("model", "details", i, "id", e.target.value)}
                  />
                  <input
                    type="text"
                    className="input-dark flex-1 text-sm"
                    placeholder="图片路径 (pic/...)"
                    value={item.img}
                    onChange={(e) => updateArray("model", "details", i, "img", e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeArrayItem("model", "details", i)}
                    className="delete-btn"
                    title="删除该详情图"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => addArrayItem("model", "details", { id: "", img: "" })}
              className="text-xs bg-[#2de2e6]/10 text-[#2de2e6] px-3 py-1.5 rounded hover:bg-[#2de2e6]/20 transition flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> 添加详情图
            </button>
          </div>

          <div className="card">
            <div className="section-title">
              <Users className="w-4 h-4" /> 制作人员 (Credits)
            </div>
            <div className="space-y-4 mb-4">
              {config.model.credits.map((c, i) => (
                <div key={i} className="bg-black/20 p-3 rounded border border-white/5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <input
                      type="text"
                      className="input-dark w-1/3 text-xs font-bold text-[#2de2e6]"
                      placeholder="分类标签（如 ILLUSTRATOR）"
                      value={c.label}
                      onChange={(e) => updateArray("model", "credits", i, "label", e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeCreditGroup(i)}
                      className="delete-btn"
                      title="删除整个分类"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 mb-2 pl-4">人员 / 网址</div>
                  {c.val.map((person, pi) => (
                    <div key={pi} className="flex gap-2 items-center mb-2 pl-4">
                      <input
                        type="text"
                        className="input-dark w-36 text-sm"
                        placeholder="人员名字"
                        value={person.name}
                        onChange={(e) => updateCreditPerson(i, pi, "name", e.target.value)}
                      />
                      <input
                        type="text"
                        className="input-dark flex-1 text-sm"
                        placeholder="https://example.com (可留空)"
                        value={person.link}
                        onChange={(e) => updateCreditPerson(i, pi, "link", e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removeCreditPerson(i, pi)}
                        className="delete-btn"
                        title="删除该人员"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="pl-4 mt-2">
                    <button
                      type="button"
                      onClick={() => addCreditPerson(i)}
                      className="text-xs bg-white/5 text-gray-300 px-2.5 py-1 rounded hover:bg-white/10 transition inline-flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> 添加人员
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCreditGroup}
              className="text-xs bg-[#2de2e6]/10 text-[#2de2e6] px-3 py-1.5 rounded hover:bg-[#2de2e6]/20 transition flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> 添加分类
            </button>
          </div>
        </>
      )}

      {activeTab === "live" && (
        <>
          <div className="card">
            <div className="section-title">
              <Radio className="w-4 h-4" /> 直播信息标题
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">板块标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.title}
                  value={config.live.title}
                  onChange={(e) => updateConfig("live", "title", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">直播间号</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.roomId}
                  value={config.live.roomId}
                  onChange={(e) => updateConfig("live", "roomId", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">房间号前缀文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.roomPrefix}
                  value={config.live.roomPrefix}
                  onChange={(e) => updateConfig("live", "roomPrefix", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">直播中文案</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.liveNowText}
                  value={config.live.liveNowText}
                  onChange={(e) => updateConfig("live", "liveNowText", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">离线文案</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.offlineText}
                  value={config.live.offlineText}
                  onChange={(e) => updateConfig("live", "offlineText", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">时间表标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.scheduleTitle}
                  value={config.live.scheduleTitle}
                  onChange={(e) => updateConfig("live", "scheduleTitle", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">点歌规则标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.rulesTitle}
                  value={config.live.rulesTitle}
                  onChange={(e) => updateConfig("live", "rulesTitle", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">小游戏传送门文案</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.gamePortalText}
                  value={config.live.gamePortalText}
                  onChange={(e) => updateConfig("live", "gamePortalText", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <Calendar className="w-4 h-4" /> 时间表文案
            </div>
            <div className="grid gap-2">
              <div>
                <label className="text-xs text-gray-400">早场文案</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.schedule.morning}
                  value={config.live.schedule.morning}
                  onChange={(e) => updateNested("live", "schedule", "morning", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">晚场文案</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.schedule.evening}
                  value={config.live.schedule.evening}
                  onChange={(e) => updateNested("live", "schedule", "evening", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">休息日文案 (例如: 周一休)</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.live.schedule.off}
                  value={config.live.schedule.off}
                  onChange={(e) => updateNested("live", "schedule", "off", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <List className="w-4 h-4" /> 点歌规则 (列表)
            </div>
            <div className="space-y-2 mb-2">
              {config.live.rules.map((rule, i) => (
                <div key={i} className="flex gap-2 items-center bg-black/20 p-2 rounded">
                  <span className="text-xs font-mono text-gray-500">{i + 1}.</span>
                  <input
                    type="text"
                    className="input-dark flex-1"
                    placeholder="请输入规则文案"
                    value={rule}
                    onChange={(e) => updateArraySimple("live", "rules", i, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeArrayItem("live", "rules", i)}
                    className="delete-btn"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => addArrayItem("live", "rules", "")}
              className="text-xs bg-[#2de2e6]/10 text-[#2de2e6] px-3 py-1.5 rounded hover:bg-[#2de2e6]/20 transition flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> 添加规则
            </button>
          </div>

          <div className="card">
            <div className="section-title">
              <Link className="w-4 h-4" /> 外部链接按钮
            </div>
            <div className="text-xs text-gray-400 mb-3">
              格式：按钮文案 / 链接地址 / 颜色 / 图标
            </div>
            <div className="space-y-2 mb-3">
              {config.live.links.map((l, i) => (
                <div key={i} className="flex flex-wrap sm:flex-nowrap gap-2 items-center bg-black/20 p-3 rounded">
                  <input
                    type="text"
                    className="input-dark w-32 text-sm"
                    placeholder="按钮文案"
                    value={l.title}
                    onChange={(e) => updateArray("live", "links", i, "title", e.target.value)}
                  />
                  <input
                    type="text"
                    className="input-dark flex-1 text-sm"
                    placeholder="https://example.com"
                    value={l.url}
                    onChange={(e) => updateArray("live", "links", i, "url", e.target.value)}
                  />
                  <select
                    className="input-dark w-24"
                    value={l.color}
                    onChange={(e) => updateArray("live", "links", i, "color", e.target.value)}
                  >
                    <option value="pink">粉色</option>
                    <option value="cyan">青色</option>
                    <option value="purple">紫色</option>
                    <option value="white">白色</option>
                  </select>
                  <select
                    className="input-dark w-24"
                    value={l.icon}
                    onChange={(e) => updateArray("live", "links", i, "icon", e.target.value)}
                  >
                    <option value="Music">音乐</option>
                    <option value="Video">视频</option>
                    <option value="Sparkles">星光</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeArrayItem("live", "links", i)}
                    className="delete-btn"
                    title="删除链接"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                addArrayItem("live", "links", {
                  title: "",
                  url: "",
                  icon: "Music",
                  color: "cyan",
                })
              }
              className="text-xs bg-[#2de2e6]/10 text-[#2de2e6] px-3 py-1.5 rounded hover:bg-[#2de2e6]/20 transition flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> 添加外部链接
            </button>
          </div>
        </>
      )}

      {activeTab === "video" && (
        <div className="card">
          <div className="section-title">
            <Film className="w-4 h-4" /> 视频墙配置 (拆分修改)
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-400">标题前缀 (白字)</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.gallery.titlePrefix}
                value={config.gallery.titlePrefix}
                onChange={(e) => updateConfig("gallery", "titlePrefix", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">标题后缀 (蓝字)</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.gallery.titleSuffix}
                value={config.gallery.titleSuffix}
                onChange={(e) => updateConfig("gallery", "titleSuffix", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">下方滚动文字</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.gallery.scrollText}
                value={config.gallery.scrollText}
                onChange={(e) => updateConfig("gallery", "scrollText", e.target.value)}
              />
            </div>
            <div className="md:col-span-2 mt-2">
              <label htmlFor="bilibili-api-path" className="text-xs text-gray-400">
                站内 API 路径（只读）
              </label>
              <input
                id="bilibili-api-path"
                type="text"
                className="input-dark opacity-70 cursor-not-allowed"
                value="/api/bilibili"
                readOnly
                aria-describedby="bilibili-api-help"
              />
              <p id="bilibili-api-help" className="mt-2 text-xs text-gray-400">
                上游地址由服务器 BILIBILI_API_URL 配置。
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">视频日期前缀</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.gallery.datePrefix}
                value={config.gallery.datePrefix}
                onChange={(e) => updateConfig("gallery", "datePrefix", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "games" && (
        <div className="card">
          <div className="section-title">
            <Video className="w-4 h-4" /> 游戏弹窗文案
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-400">大厅标题前缀</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.lobbyTitlePrefix}
                value={config.games.lobbyTitlePrefix}
                onChange={(e) => updateConfig("games", "lobbyTitlePrefix", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">大厅标题后缀</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.lobbyTitleSuffix}
                value={config.games.lobbyTitleSuffix}
                onChange={(e) => updateConfig("games", "lobbyTitleSuffix", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">大厅副标题</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.lobbySubtitle}
                value={config.games.lobbySubtitle}
                onChange={(e) => updateConfig("games", "lobbySubtitle", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">名字大乱斗标题</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.arenaTitle}
                value={config.games.arenaTitle}
                onChange={(e) => updateConfig("games", "arenaTitle", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">名字大乱斗状态</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.arenaStatus}
                value={config.games.arenaStatus}
                onChange={(e) => updateConfig("games", "arenaStatus", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">名字大乱斗描述</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.arenaDesc}
                value={config.games.arenaDesc}
                onChange={(e) => updateConfig("games", "arenaDesc", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">DGP 标题</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.dgpTitle}
                value={config.games.dgpTitle}
                onChange={(e) => updateConfig("games", "dgpTitle", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">DGP 状态</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.dgpStatus}
                value={config.games.dgpStatus}
                onChange={(e) => updateConfig("games", "dgpStatus", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">DGP 描述</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.dgpDesc}
                value={config.games.dgpDesc}
                onChange={(e) => updateConfig("games", "dgpDesc", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">返回按钮文案</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.games.returnText}
                value={config.games.returnText}
                onChange={(e) => updateConfig("games", "returnText", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "footer" && (
        <div className="card">
          <div className="section-title">
            <Type className="w-4 h-4" /> 底部版权
          </div>
          <input
            type="text"
            className="input-dark"
            placeholder={d.footer.text}
            value={config.footer.text}
            onChange={(e) => updateConfig("footer", "text", e.target.value)}
          />
        </div>
      )}

      {activeTab === "mail" && (
        <>
          <div className="card">
            <div className="section-title">
              <Mail className="w-4 h-4" /> 主站访客入口（左下浮动菜单）
            </div>
            <div className="text-xs text-gray-500 mb-4">
              这些文字显示在主页左下角的 Speed Dial 发信按钮上，访客打开主站就能看到。
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">按钮标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.entryLabel}
                  value={config.mail.entryLabel}
                  onChange={(e) => updateConfig("mail", "entryLabel", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Tooltip（开启态）</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.entryHint}
                  value={config.mail.entryHint}
                  onChange={(e) => updateConfig("mail", "entryHint", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">Tooltip（发信箱关闭时）</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.entryHintDisabled}
                  value={config.mail.entryHintDisabled}
                  onChange={(e) => updateConfig("mail", "entryHintDisabled", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <Type className="w-4 h-4" /> 发信弹窗主体文案
            </div>
            <div className="text-xs text-gray-500 mb-4">
              这些文字显示在访客点开发信弹窗后，看到的表单卡片上。
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">卡片标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.senderTitle}
                  value={config.mail.senderTitle}
                  onChange={(e) => updateConfig("mail", "senderTitle", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">副标题 / 招呼语</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.senderTagline}
                  value={config.mail.senderTagline}
                  onChange={(e) => updateConfig("mail", "senderTagline", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">状态徽章（开启）</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.statusOpen}
                  value={config.mail.statusOpen}
                  onChange={(e) => updateConfig("mail", "statusOpen", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">状态徽章（关闭）</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.statusPaused}
                  value={config.mail.statusPaused}
                  onChange={(e) => updateConfig("mail", "statusPaused", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">发送成功提示</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.successMessage}
                  value={config.mail.successMessage}
                  onChange={(e) => updateConfig("mail", "successMessage", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <Pencil className="w-4 h-4" /> 输入框占位符
            </div>
            <div className="text-xs text-gray-500 mb-4">
              访客未填写内容时，输入框里的灰色提示文字。
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">正文输入框</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.placeholderText}
                  value={config.mail.placeholderText}
                  onChange={(e) => updateConfig("mail", "placeholderText", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">称呼输入框</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.placeholderNickname}
                  value={config.mail.placeholderNickname}
                  onChange={(e) => updateConfig("mail", "placeholderNickname", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">链接输入框</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.placeholderLink}
                  value={config.mail.placeholderLink}
                  onChange={(e) => updateConfig("mail", "placeholderLink", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <Radio className="w-4 h-4" /> 关闭态文案
            </div>
            <div className="text-xs text-gray-500 mb-4">
              当后台 <code className="text-[#2de2e6]">/mail</code> 页面把发信箱开关关闭时，访客会看到的提示文字。
            </div>
            <div className="grid gap-4">
              <div>
                <label className="text-xs text-gray-400">弹窗顶部禁用横幅</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.disabledBanner}
                  value={config.mail.disabledBanner}
                  onChange={(e) => updateConfig("mail", "disabledBanner", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">表单内说明文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.mail.pausedMessage}
                  value={config.mail.pausedMessage}
                  onChange={(e) => updateConfig("mail", "pausedMessage", e.target.value)}
                />
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
              <div>
                <label className="text-xs text-gray-400">标题前缀 (白字)</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.titlePrefix}
                  value={config.song_ui.titlePrefix}
                  onChange={(e) => updateConfig("song_ui", "titlePrefix", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">标题后缀 (蓝字)</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.titleSuffix}
                  value={config.song_ui.titleSuffix}
                  onChange={(e) => updateConfig("song_ui", "titleSuffix", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">服务器状态文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.serverText}
                  value={config.song_ui.serverText}
                  onChange={(e) => updateConfig("song_ui", "serverText", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">在线状态文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.serverOnline}
                  value={config.song_ui.serverOnline}
                  onChange={(e) => updateConfig("song_ui", "serverOnline", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">离线状态文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.serverOffline}
                  value={config.song_ui.serverOffline}
                  onChange={(e) => updateConfig("song_ui", "serverOffline", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">保底计数文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.pityText}
                  value={config.song_ui.pityText}
                  onChange={(e) => updateConfig("song_ui", "pityText", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">搜索框提示文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.searchPlaceholder}
                  value={config.song_ui.searchPlaceholder}
                  onChange={(e) => updateConfig("song_ui", "searchPlaceholder", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">随机按钮文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.randomizeBtn}
                  value={config.song_ui.randomizeBtn}
                  onChange={(e) => updateConfig("song_ui", "randomizeBtn", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">同步中按钮文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.syncingBtn}
                  value={config.song_ui.syncingBtn}
                  onChange={(e) => updateConfig("song_ui", "syncingBtn", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">复制提示前缀</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.copiedPrefix}
                  value={config.song_ui.copiedPrefix}
                  onChange={(e) => updateConfig("song_ui", "copiedPrefix", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">复制点歌命令前缀</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.copyCommandPrefix}
                  value={config.song_ui.copyCommandPrefix}
                  onChange={(e) => updateConfig("song_ui", "copyCommandPrefix", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">无数据提示</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.emptyText}
                  value={config.song_ui.emptyText}
                  onChange={(e) => updateConfig("song_ui", "emptyText", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">隐藏曲标签文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.secretTag}
                  value={config.song_ui.secretTag}
                  onChange={(e) => updateConfig("song_ui", "secretTag", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">已复制标识</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.song_ui.copiedTag}
                  value={config.song_ui.copiedTag}
                  onChange={(e) => updateConfig("song_ui", "copiedTag", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card bg-[#1e293b]/50 border-dashed">
            <div className="section-title text-[#2de2e6]">
              <Music className="w-4 h-4" /> 歌单分类设置 (Style Config)
            </div>
            <div className="space-y-2 mb-4">
              {config.song_ui.categories.map((cat, i) => (
                <div key={i} className="flex gap-2 items-center bg-black/30 p-2 rounded border border-white/5">
                  <span className="text-xs text-gray-500 w-6 text-center">{i + 1}</span>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moveCategory(i, -1)}
                      disabled={i === 0}
                      className="action-btn"
                      style={i === 0 ? { opacity: 0.3 } : {}}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCategory(i, 1)}
                      disabled={i === config.song_ui.categories.length - 1}
                      className="action-btn"
                      style={i === config.song_ui.categories.length - 1 ? { opacity: 0.3 } : {}}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    type="text"
                    className="input-dark w-24 text-xs font-mono"
                    value={cat.id}
                    onChange={(e) => updateArray("song_ui", "categories", i, "id", e.target.value)}
                    placeholder="ID (key)"
                  />
                  <input
                    type="text"
                    className="input-dark flex-1 text-xs"
                    value={cat.label}
                    onChange={(e) => updateArray("song_ui", "categories", i, "label", e.target.value)}
                    placeholder="Label"
                  />
                  <button
                    type="button"
                    onClick={() => void removeCategory(i)}
                    className="delete-btn"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCategory}
              className="w-full py-2 bg-[#2de2e6]/10 text-[#2de2e6] text-xs font-bold rounded hover:bg-[#2de2e6]/20 transition flex items-center justify-center gap-2"
            >
              <Plus className="w-3 h-3" /> 添加新风格 (Add Style)
            </button>
          </div>

          <div className="card">
            <div className="section-title flex justify-between">
              <span>歌单管理</span>
              <div className="text-xs text-gray-400 font-normal">
                {songSearchQuery.trim()
                  ? `匹配 ${filteredSongs.length} / 共 ${songData.length} 首`
                  : `共 ${songData.length} 首`}
              </div>
            </div>
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
              <input
                type="text"
                className="input-dark pl-9"
                placeholder="快速搜寻歌名或歌手..."
                value={songSearchQuery}
                onChange={(e) => setSongSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={addSongRow}
                className="bg-green-600 px-3 py-1 rounded text-xs font-bold hover:bg-green-500"
              >
                + 添加一行
              </button>
              <button
                type="button"
                onClick={showSongHelp}
                className="bg-blue-600 px-3 py-1 rounded text-xs font-bold hover:bg-blue-500"
              >
                ? 如何使用
              </button>
            </div>
            <div
              className="h-[600px] min-h-[300px] resize-y overflow-y-auto custom-scrollbar space-y-2 border border-white/5 rounded p-2"
              id="song-list-container"
            >
              {filteredSongs.map(({ song: s, index: i }) => {
                const assignableCategories = config.song_ui.categories.filter(
                  (c) => c.id !== "all",
                );
                return (
                  <div key={i} className="flex gap-2 items-center bg-black/20 p-2 rounded group">
                    <span className="text-xs text-gray-500 w-8 text-center">{i + 1}</span>
                    <select
                      className="input-dark w-24 text-xs"
                      value={s.category}
                      onChange={(e) => updateSong(i, "category", e.target.value)}
                    >
                      {assignableCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                      {!assignableCategories.find((c) => c.id === s.category) && (
                        <option value={s.category} style={{ color: "red" }}>
                          未知({s.category})
                        </option>
                      )}
                    </select>
                    <input
                      type="text"
                      className="input-dark flex-1 text-sm"
                      value={s.name}
                      onChange={(e) => updateSong(i, "name", e.target.value)}
                      placeholder="歌名"
                    />
                    <input
                      type="text"
                      className="input-dark w-1/3 text-sm"
                      value={s.artist}
                      onChange={(e) => updateSong(i, "artist", e.target.value)}
                      placeholder="歌手"
                    />
                    <button
                      type="button"
                      onClick={() => void removeSong(i)}
                      className="text-red-500 hover:text-red-400 p-1 opacity-50 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="section-title">批量添加 (Excel模式)</div>
            <textarea
              id="bulk-songs"
              className="input-dark h-32 font-mono text-xs"
              placeholder="歌名 歌手 (每行一首，默认分类为列表第一个非All分类，空行会自动忽略)"
            />
            <button
              type="button"
              onClick={parseBulkSongs}
              className="mt-2 bg-purple-600 px-4 py-2 rounded text-sm font-bold hover:bg-purple-500"
            >
              批量导入
            </button>
          </div>
        </>
      )}

      {activeTab === "hidden" && (
        <div className="card">
          <div className="section-title text-purple-400">
            <LockIcon className="w-4 h-4" /> 隐藏歌单 (盲盒池)
          </div>
          <div className="h-[500px] overflow-y-auto custom-scrollbar space-y-2">
            {hiddenSongs.map((s, i) => (
              <div
                key={i}
                className="flex gap-2 items-center bg-purple-900/20 p-2 rounded border border-purple-500/20"
              >
                <span className="text-xs text-purple-500 w-8 text-center">{i + 1}</span>
                <input
                  type="text"
                  className="input-dark flex-1 text-sm"
                  placeholder="隐藏曲目名称"
                  value={s.name}
                  onChange={(e) => updateHidden(i, e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeHidden(i)}
                  className="text-red-400 hover:text-red-300 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addHiddenRow}
            className="mt-4 bg-purple-600 w-full py-2 rounded font-bold hover:bg-purple-500"
          >
            + 添加隐藏条目
          </button>
        </div>
      )}

      {activeTab === "gacha" && (
        <div className="card">
          <div className="section-title text-purple-400">
            <LockIcon className="w-4 h-4" /> 出金概率与保底配置
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-400">硬保底次数 (pityThreshold)</label>
              <input
                type="number"
                min={1}
                step={1}
                className="input-dark"
                placeholder={String(d.gacha.pityThreshold)}
                value={gachaConfig.pityThreshold}
                onChange={(e) =>
                  updateConfig(
                    "gacha",
                    "pityThreshold",
                    Math.max(1, Math.round(toNumber(e.target.value, d.gacha.pityThreshold))),
                  )
                }
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">软保底开始次数 (softPityStart)</label>
              <input
                type="number"
                min={0}
                step={1}
                className="input-dark"
                placeholder={String(d.gacha.softPityStart)}
                value={gachaConfig.softPityStart}
                onChange={(e) =>
                  updateConfig(
                    "gacha",
                    "softPityStart",
                    Math.max(0, Math.round(toNumber(e.target.value, d.gacha.softPityStart))),
                  )
                }
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
                placeholder={String(d.gacha.baseRate)}
                value={gachaConfig.baseRate}
                onChange={(e) =>
                  updateConfig(
                    "gacha",
                    "baseRate",
                    Math.min(1, Math.max(0, toNumber(e.target.value, d.gacha.baseRate))),
                  )
                }
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
                placeholder={String(d.gacha.maxRate)}
                value={gachaConfig.maxRate}
                onChange={(e) =>
                  updateConfig(
                    "gacha",
                    "maxRate",
                    Math.min(1, Math.max(0, toNumber(e.target.value, d.gacha.maxRate))),
                  )
                }
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
          <div className="section-title">
            <Bell className="w-4 h-4" /> 通知与彩蛋弹窗文案
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-400">模型被点击通知</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.modelClicked}
                value={config.notifications.modelClicked}
                onChange={(e) => updateConfig("notifications", "modelClicked", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">点击警告文案（支持 {"{count}"} 占位）</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.clickWarning}
                value={config.notifications.clickWarning}
                onChange={(e) => updateConfig("notifications", "clickWarning", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">解锁通知</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.unlocked}
                value={config.notifications.unlocked}
                onChange={(e) => updateConfig("notifications", "unlocked", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">已解锁通知</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.alreadyUnlocked}
                value={config.notifications.alreadyUnlocked}
                onChange={(e) => updateConfig("notifications", "alreadyUnlocked", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">出金弹窗标题</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.goldenAlertTitle}
                value={config.notifications.goldenAlertTitle}
                onChange={(e) => updateConfig("notifications", "goldenAlertTitle", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">出金弹窗副标题</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.goldenAlertSubtitle}
                value={config.notifications.goldenAlertSubtitle}
                onChange={(e) =>
                  updateConfig("notifications", "goldenAlertSubtitle", e.target.value)
                }
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">出金恭喜标题</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.goldenCongratsTitle}
                value={config.notifications.goldenCongratsTitle}
                onChange={(e) =>
                  updateConfig("notifications", "goldenCongratsTitle", e.target.value)
                }
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">时间戳前缀</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.timestampPrefix}
                value={config.notifications.timestampPrefix}
                onChange={(e) => updateConfig("notifications", "timestampPrefix", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">出金说明正文</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.goldenBody}
                value={config.notifications.goldenBody}
                onChange={(e) => updateConfig("notifications", "goldenBody", e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">确认按钮文案</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.notifications.acknowledgeText}
                value={config.notifications.acknowledgeText}
                onChange={(e) => updateConfig("notifications", "acknowledgeText", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "system" && (
        <>
          <div className="card">
            <div className="section-title">
              <Settings className="w-4 h-4" /> 系统提示
            </div>
            <div className="grid gap-4">
              <div>
                <label className="text-xs text-gray-400">配置更新 Toast</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.system.configUpdatedToast}
                  value={config.system.configUpdatedToast}
                  onChange={(e) => updateConfig("system", "configUpdatedToast", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <Type className="w-4 h-4" /> SEO / 分享文案
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">页面标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.seo.title}
                  value={config.seo.title}
                  onChange={(e) => updateConfig("seo", "title", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">站点名</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.seo.siteName}
                  value={config.seo.siteName}
                  onChange={(e) => updateConfig("seo", "siteName", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">页面描述</label>
                <textarea
                  className="input-dark h-24"
                  placeholder={d.seo.description}
                  value={config.seo.description}
                  onChange={(e) => updateConfig("seo", "description", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">关键词（逗号或换行分隔）</label>
                <textarea
                  className="input-dark h-24"
                  placeholder={d.seo.keywords.join("\n")}
                  value={config.seo.keywords.join("\n")}
                  onChange={(e) =>
                    updateConfig(
                      "seo",
                      "keywords",
                      e.target.value.split(/[,\r\n]/),
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">歌单结构化数据标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.seo.playlistName}
                  value={config.seo.playlistName}
                  onChange={(e) => updateConfig("seo", "playlistName", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">歌单结构化数据描述</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.seo.playlistDescription}
                  value={config.seo.playlistDescription}
                  onChange={(e) => updateConfig("seo", "playlistDescription", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <Type className="w-4 h-4" /> PWA 安装 / 更新提示
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">Manifest 名称</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.manifestName}
                  value={config.pwa.manifestName}
                  onChange={(e) => updateConfig("pwa", "manifestName", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Manifest 短名称</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.manifestShortName}
                  value={config.pwa.manifestShortName}
                  onChange={(e) => updateConfig("pwa", "manifestShortName", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">Manifest 描述</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.manifestDescription}
                  value={config.pwa.manifestDescription}
                  onChange={(e) => updateConfig("pwa", "manifestDescription", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">安装卡片标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.installTitle}
                  value={config.pwa.installTitle}
                  onChange={(e) => updateConfig("pwa", "installTitle", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">安装按钮</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.installButton}
                  value={config.pwa.installButton}
                  onChange={(e) => updateConfig("pwa", "installButton", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">安装说明（安卓/桌面）</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.installDescription}
                  value={config.pwa.installDescription}
                  onChange={(e) => updateConfig("pwa", "installDescription", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">安装说明（iOS）</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.installIosDescription}
                  value={config.pwa.installIosDescription}
                  onChange={(e) => updateConfig("pwa", "installIosDescription", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">iOS 步骤一</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.iosStepOne}
                  value={config.pwa.iosStepOne}
                  onChange={(e) => updateConfig("pwa", "iosStepOne", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">iOS 步骤二</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.iosStepTwo}
                  value={config.pwa.iosStepTwo}
                  onChange={(e) => updateConfig("pwa", "iosStepTwo", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">更新标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.updateTitle}
                  value={config.pwa.updateTitle}
                  onChange={(e) => updateConfig("pwa", "updateTitle", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">更新按钮</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.updateButton}
                  value={config.pwa.updateButton}
                  onChange={(e) => updateConfig("pwa", "updateButton", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">更新说明</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.pwa.updateDescription}
                  value={config.pwa.updateDescription}
                  onChange={(e) => updateConfig("pwa", "updateDescription", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <Type className="w-4 h-4" /> 离线页 / 错误页
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-gray-400">离线页 Metadata 标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.offline.metadataTitle}
                  value={config.offline.metadataTitle}
                  onChange={(e) => updateConfig("offline", "metadataTitle", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">离线页 Metadata 描述</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.offline.metadataDescription}
                  value={config.offline.metadataDescription}
                  onChange={(e) => updateConfig("offline", "metadataDescription", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">离线页标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.offline.title}
                  value={config.offline.title}
                  onChange={(e) => updateConfig("offline", "title", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">离线页状态文字</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.offline.statusText}
                  value={config.offline.statusText}
                  onChange={(e) => updateConfig("offline", "statusText", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">离线页说明</label>
                <textarea
                  className="input-dark h-24"
                  placeholder={d.offline.body}
                  value={config.offline.body}
                  onChange={(e) => updateConfig("offline", "body", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">离线页重试按钮</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.offline.retryButton}
                  value={config.offline.retryButton}
                  onChange={(e) => updateConfig("offline", "retryButton", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">错误页标题</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.errors.title}
                  value={config.errors.title}
                  onChange={(e) => updateConfig("errors", "title", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">错误页重试按钮</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.errors.retryText}
                  value={config.errors.retryText}
                  onChange={(e) => updateConfig("errors", "retryText", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">错误页说明</label>
                <input
                  type="text"
                  className="input-dark"
                  placeholder={d.errors.message}
                  value={config.errors.message}
                  onChange={(e) => updateConfig("errors", "message", e.target.value)}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "videos" && (
        <div className="card">
          <div className="section-title">
            <Film className="w-4 h-4" /> 视频区域标题配置
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-gray-400">常规视频标题（未解锁态）</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.videos.unlockedTitle}
                value={config.videos.unlockedTitle}
                onChange={(e) => updateConfig("videos", "unlockedTitle", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">隐藏存档标题（已解锁态）</label>
              <input
                type="text"
                className="input-dark"
                placeholder={d.videos.hiddenTitle}
                value={config.videos.hiddenTitle}
                onChange={(e) => updateConfig("videos", "hiddenTitle", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "assets" && (
        <div className="card">
          <div className="section-title flex justify-between items-center">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <FolderOpen className="w-4 h-4" /> 资源管理器
              </span>
              <div className="flex bg-black/30 rounded p-1">
                <button
                  type="button"
                  onClick={() => void fetchAssets("memes")}
                  className={`px-3 py-1 text-xs rounded transition ${
                    currentAssetFolder === "memes"
                      ? "bg-cyan-500 text-black font-bold"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  memes (表情包)
                </button>
                <button
                  type="button"
                  onClick={() => void fetchAssets("pic")}
                  className={`px-3 py-1 text-xs rounded transition ${
                    currentAssetFolder === "pic"
                      ? "bg-cyan-500 text-black font-bold"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  pic (图片)
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleAssetSort}
                className="bg-white/10 hover:bg-white/20 px-3 py-2 rounded text-gray-300 text-xs font-bold flex items-center gap-2"
              >
                {assetSortOrder === "asc" ? (
                  <ArrowDownAZ className="w-4 h-4" />
                ) : (
                  <ArrowUpAZ className="w-4 h-4" />
                )}
                {assetSortOrder === "asc" ? "A-Z" : "Z-A"}
              </button>
              <label className="cursor-pointer bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded text-xs font-bold transition flex items-center gap-2">
                <UploadCloud className="w-4 h-4" /> 上传文件
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => void uploadFile(e.currentTarget)}
                />
              </label>
              <button
                type="button"
                onClick={() => void fetchAssets(currentAssetFolder)}
                className="bg-white/10 hover:bg-white/20 p-2 rounded text-gray-300"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-500 mb-4 font-mono">
            当前路径: /{currentAssetFolder}/ (共 {sortedAssets.length} 个文件)
          </div>
          <div className="asset-grid max-h-[600px] overflow-y-auto custom-scrollbar p-1">
            {sortedAssets.length > 0 ? (
              sortedAssets.map((f) => (
                <div key={f.name} className="asset-item">
                  <div className="asset-img-box">
                    <NextImage
                      src={`${f.path}?t=${f.time}`}
                      className="asset-img"
                      fill
                      sizes="180px"
                      alt={f.name}
                      unoptimized
                    />
                  </div>
                  <div className="asset-info truncate" title={f.name}>
                    {f.name}
                  </div>
                  <div className="asset-actions">
                    <button
                      type="button"
                      onClick={() => void copyPath(f.path)}
                      className="text-white hover:text-cyan-400"
                      title="复制路径"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void renameFile(f.name)}
                      className="text-white hover:text-yellow-400"
                      title="重命名"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteFile(f.name)}
                      className="text-white hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center text-gray-500 py-10">文件夹为空</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
