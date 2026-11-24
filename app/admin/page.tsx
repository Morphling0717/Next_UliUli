"use client";

import React, { useState, useEffect } from "react";
import Swal from "sweetalert2";
import { AdminHeader } from "./components/AdminHeader";
import { AdminTabContent } from "./components/AdminTabContent";
import { AdminTabsNav } from "./components/AdminTabsNav";
import { LoadingOverlay } from "./components/LoadingOverlay";
import {
  AdminTabId,
  AssetFile,
  EditableSiteConfig,
  HiddenSongItem,
  SiteConfig,
  SongItem,
} from "./types";
import { sanitizeEditableSiteConfig } from "@/lib/site-config";

const EDITOR_NAME_STORAGE_KEY = "uliuli:admin:editor-name";

type ConfigLoadResponse = {
  success: boolean;
  message?: string;
  code?: string;
  current_version?: number;
  config_version?: number;
  config_updated_at?: string | null;
  config_updated_by?: string | null;
  config_history_count?: number;
  site_config?: SiteConfig;
  songs?: SongItem[];
  hidden_songs?: HiddenSongItem[];
};

type UnknownRecord = Record<string, unknown>;

function formatAuditTime(value: string | null | undefined): string {
  if (!value) return "未知时间";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function getSectionCopy(config: EditableSiteConfig, section: string): UnknownRecord {
  const existing = (config as unknown as UnknownRecord)[section];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return { ...(existing as UnknownRecord) };
  }
  return {};
}

// ========== MAIN COMPONENT ==========
export default function AdminDashboard() {
  // ===== STATE MANAGEMENT =====
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTabId>("hero");
  const [config, setConfig] = useState<EditableSiteConfig>(() =>
    sanitizeEditableSiteConfig({}),
  );
  const [songData, setSongData] = useState<SongItem[]>([]);
  const [hiddenSongs, setHiddenSongs] = useState<HiddenSongItem[]>([]);
  const [isDevUnlocked, setIsDevUnlocked] = useState(false);

  // Assets state
  const [currentAssetFolder, setCurrentAssetFolder] = useState<"memes" | "pic">(
    "memes",
  );
  const [assetsCache, setAssetsCache] = useState<{
    memes: AssetFile[];
    pic: AssetFile[];
  }>({ memes: [], pic: [] });
  const [assetSortOrder, setAssetSortOrder] = useState<"asc" | "desc">("asc");
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);
  const [configUpdatedAt, setConfigUpdatedAt] = useState<string | null>(null);
  const [configUpdatedBy, setConfigUpdatedBy] = useState<string | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [editorName, setEditorName] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem(EDITOR_NAME_STORAGE_KEY) ?? "",
  );

  // ===== INITIALIZE DATA =====
  useEffect(() => {
    void loadConfigFromDB(true);
    void refreshAdminSession();
    void refreshDevSession();
  }, []);

  async function refreshAdminSession() {
    try {
      const res = await fetch("/api/admin/session", { cache: "no-store" });
      const data = (await res.json()) as { authenticated?: boolean };
      setAdminAuthenticated(!!data.authenticated);
    } catch {
      setAdminAuthenticated(false);
    }
  }

  async function refreshDevSession() {
    try {
      const res = await fetch("/api/admin/unlock", { cache: "no-store" });
      const data = (await res.json()) as { unlocked?: boolean };
      setIsDevUnlocked(!!data.unlocked);
    } catch {
      setIsDevUnlocked(false);
    }
  }

  async function ensureAdminSession(message = "请输入管理员密码"): Promise<boolean> {
    if (adminAuthenticated) return true;

    const { value: pass } = await Swal.fire({
      title: "服务器验证",
      text: message,
      input: "password",
      inputPlaceholder: "Admin Password",
      background: "#1e293b",
      color: "white",
      confirmButtonColor: "#22d3ee",
      confirmButtonText: "验证",
      showCancelButton: true,
    });
    if (!pass) return false;

    const res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    });
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; message?: string }
      | null;
    if (!res.ok || !data?.success) {
      setAdminAuthenticated(false);
      await Swal.fire({
        icon: "error",
        title: "ACCESS DENIED",
        text: data?.message || "管理员验证失败",
        background: "#1e293b",
        color: "#ff4444",
      });
      return false;
    }

    setAdminAuthenticated(true);
    return true;
  }

  async function loadConfigFromDB(isInitial = false) {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const data = (await res.json()) as ConfigLoadResponse;

      if (data.success) {
        setConfig(sanitizeEditableSiteConfig(data.site_config || {}));
        setSongData(data.songs || []);
        setHiddenSongs(data.hidden_songs || []);
        setConfigVersion(Number(data.config_version || 0));
        setConfigUpdatedAt(data.config_updated_at ?? null);
        setConfigUpdatedBy(data.config_updated_by ?? null);
        setHistoryCount(Number(data.config_history_count || 0));
      } else {
        console.error("Failed to load config:", data.message);
        await Swal.fire({
          icon: "error",
          title: "加载失败",
          text: data.message,
          background: "#1e293b",
          color: "#ff4444",
        });
      }

      if (isInitial) {
        setTimeout(() => {
          setIsLoading(false);
        }, 500);
      }
    } catch (error) {
      console.error("Config load error:", error);
      await Swal.fire({
        icon: "error",
        title: "加载失败",
        text: "无法连接到服务器",
        background: "#1e293b",
        color: "#ff4444",
      });
      if (isInitial) {
        setTimeout(() => {
          setIsLoading(false);
        }, 500);
      }
    }
  }

  const handleEditorNameChange = (value: string) => {
    setEditorName(value);
    window.localStorage.setItem(EDITOR_NAME_STORAGE_KEY, value);
  };

  // ===== IMMUTABLE CONFIG UPDATERS =====
  const updateConfig = (section: string, key: string, val: unknown) => {
    setConfig((prev) => {
      const nextSection = getSectionCopy(prev, section);
      nextSection[key] = val;
      return {
        ...prev,
        [section]: nextSection,
      } as EditableSiteConfig;
    });
  };

  const updateNested = (
    section: string,
    obj: string,
    prop: string,
    val: unknown,
  ) => {
    setConfig((prev) => {
      const nextSection = getSectionCopy(prev, section);
      if (obj === "") {
        nextSection[prop] = val;
      } else if (prop === "") {
        nextSection[obj] = val;
      } else {
        const existingNested = nextSection[obj];
        const nextNested: UnknownRecord =
          existingNested && typeof existingNested === "object" && !Array.isArray(existingNested)
            ? { ...(existingNested as UnknownRecord) }
            : {};
        nextNested[prop] = val;
        nextSection[obj] = nextNested;
      }
      return {
        ...prev,
        [section]: nextSection,
      } as EditableSiteConfig;
    });
  };

  const updateArray = (
    section: string,
    arrayKey: string,
    index: number,
    key: string,
    val: unknown,
  ) => {
    setConfig((prev) => {
      const nextSection = getSectionCopy(prev, section);
      const rawArr = nextSection[arrayKey];
      if (!Array.isArray(rawArr)) return prev;
      nextSection[arrayKey] = rawArr.map((item, i) => {
        if (i !== index || !item || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }
        return { ...(item as UnknownRecord), [key]: val };
      });
      return {
        ...prev,
        [section]: nextSection,
      } as EditableSiteConfig;
    });
  };

  const updateArraySimple = (
    section: string,
    arrayKey: string,
    index: number,
    val: unknown,
  ) => {
    setConfig((prev) => {
      const nextSection = getSectionCopy(prev, section);
      const rawArr = nextSection[arrayKey];
      if (!Array.isArray(rawArr)) return prev;
      nextSection[arrayKey] = rawArr.map((item, i) => (i === index ? val : item));
      return {
        ...prev,
        [section]: nextSection,
      } as EditableSiteConfig;
    });
  };

  const addArrayItem = (section: string, arrayKey: string, defaultValue: unknown) => {
    setConfig((prev) => {
      const nextSection = getSectionCopy(prev, section);
      const rawArr = Array.isArray(nextSection[arrayKey])
        ? [...(nextSection[arrayKey] as unknown[])]
        : [];
      rawArr.push(defaultValue);
      nextSection[arrayKey] = rawArr;
      return {
        ...prev,
        [section]: nextSection,
      } as EditableSiteConfig;
    });
  };

  const removeArrayItem = (section: string, arrayKey: string, index: number) => {
    setConfig((prev) => {
      const nextSection = getSectionCopy(prev, section);
      const rawArr = nextSection[arrayKey];
      if (!Array.isArray(rawArr)) return prev;
      nextSection[arrayKey] = rawArr.filter((_, i) => i !== index);
      return {
        ...prev,
        [section]: nextSection,
      } as EditableSiteConfig;
    });
  };

  const updateCreditPerson = (
    creditIndex: number,
    personIndex: number,
    key: "name" | "link",
    val: string,
  ) => {
    setConfig((prev) => ({
      ...prev,
      model: {
        ...prev.model,
        credits: prev.model.credits.map((group, gi) =>
          gi !== creditIndex
            ? group
            : {
                ...group,
                val: group.val.map((person, pi) =>
                  pi !== personIndex ? person : { ...person, [key]: val },
                ),
              },
        ),
      },
    }));
  };

  const addCreditGroup = () => {
    setConfig((prev) => ({
      ...prev,
      model: {
        ...prev.model,
        credits: [
          ...prev.model.credits,
          { label: "", val: [{ name: "", link: "" }] },
        ],
      },
    }));
  };

  const removeCreditGroup = (creditIndex: number) => {
    setConfig((prev) => ({
      ...prev,
      model: {
        ...prev.model,
        credits: prev.model.credits.filter((_, gi) => gi !== creditIndex),
      },
    }));
  };

  const addCreditPerson = (creditIndex: number) => {
    setConfig((prev) => ({
      ...prev,
      model: {
        ...prev.model,
        credits: prev.model.credits.map((group, gi) =>
          gi !== creditIndex
            ? group
            : { ...group, val: [...group.val, { name: "", link: "" }] },
        ),
      },
    }));
  };

  const removeCreditPerson = (creditIndex: number, personIndex: number) => {
    setConfig((prev) => ({
      ...prev,
      model: {
        ...prev.model,
        credits: prev.model.credits.map((group, gi) =>
          gi !== creditIndex
            ? group
            : { ...group, val: group.val.filter((_, pi) => pi !== personIndex) },
        ),
      },
    }));
  };

  // ===== TAB SWITCHING =====
  const switchTab = async (tab: AdminTabId) => {
    const isDevLockedTab = tab === "hidden" || tab === "gacha";
    if (isDevLockedTab && !isDevUnlocked) {
      const { value: pass } = await Swal.fire({
        title: "开发者验证",
        text: "此区域仅开发者可修改，请输入开发者密码",
        input: "password",
        inputPlaceholder: "Developer Password",
        background: "#1e293b",
        color: "white",
        confirmButtonColor: "#9333ea",
        confirmButtonText: "解锁",
        showCancelButton: true,
        cancelButtonText: "取消",
      });

      if (pass === undefined) return;
      if (!pass) {
        await Swal.fire({
          icon: "error",
          title: "ACCESS DENIED",
          text: "密码不能为空",
          background: "#1e293b",
          color: "#ff4444",
        });
        return;
      }

      try {
        const verifyRes = await fetch("/api/admin/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pass }),
        });
        const verifyData = await verifyRes.json();

        if (verifyData.success) {
          setIsDevUnlocked(true);
          await Swal.fire({
            icon: "success",
            title: "ACCESS GRANTED",
            toast: true,
            position: "top",
            timer: 1500,
            showConfirmButton: false,
            background: "#1e293b",
            color: "#fff",
          });
        } else {
          await Swal.fire({
            icon: "error",
            title: "ACCESS DENIED",
            text: verifyData.message || "密码错误",
            background: "#1e293b",
            color: "#ff4444",
          });
          return;
        }
      } catch {
        await Swal.fire({
          icon: "error",
          title: "NETWORK ERROR",
          text: "无法验证开发者密码",
          background: "#1e293b",
          color: "#ff4444",
        });
        return;
      }
    }

    if (tab === "assets") {
      const ok = await ensureAdminSession("管理文件需要管理员权限");
      if (!ok) return;
      await fetchAssets(currentAssetFolder);
    }

    setActiveTab(tab);
  };

  // ===== ASSETS FUNCTIONS =====
  const fetchAssets = async (folder: "memes" | "pic") => {
    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          folder: folder,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAssetsCache((prev) => ({
          ...prev,
          [folder]: data.files,
        }));
        setCurrentAssetFolder(folder);
      } else {
        if (res.status === 401) setAdminAuthenticated(false);
        await Swal.fire({
          icon: "error",
          title: "加载失败",
          text: data.message,
          background: "#1e293b",
          color: "#ff4444",
        });
      }
    } catch {
      console.error("Fetch assets failed");
    }
  };

  const toggleAssetSort = () => {
    setAssetSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  const uploadFile = async (input: HTMLInputElement) => {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    const formData = new FormData();
    formData.append("action", "upload");
    formData.append("folder", currentAssetFolder);
    formData.append("file", file);

    Swal.fire({
      title: "UPLOADING...",
      background: "#1e293b",
      color: "#2de2e6",
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        Swal.close();
        await Swal.fire({
          icon: "success",
          title: "上传成功",
          text: data.file,
          background: "#1e293b",
          color: "#fff",
          timer: 1500,
          showConfirmButton: false,
        });
        await fetchAssets(currentAssetFolder);
      } else {
        Swal.close();
        await Swal.fire({
          icon: "error",
          title: "上传失败",
          text: data.message,
          background: "#1e293b",
          color: "#ff4444",
        });
      }
    } catch {
      Swal.close();
      await Swal.fire({
        icon: "error",
        title: "网络错误",
        background: "#1e293b",
        color: "#ff4444",
      });
    } finally {
      input.value = "";
    }
  };

  const renameFile = async (oldName: string) => {
    const { value: newName } = await Swal.fire({
      title: "重命名文件",
      input: "text",
      inputValue: oldName,
      inputLabel: "请输入新文件名 (包含后缀)",
      background: "#1e293b",
      color: "white",
      confirmButtonColor: "#22d3ee",
      showCancelButton: true,
      inputValidator: (value: string) => {
        if (!value) return "文件名不能为空";
        if (!/^[a-zA-Z0-9\._-]+$/.test(value))
          return "文件名包含非法字符 (只能包含字母、数字、点、下划线、横杠)";
        return null;
      },
    });

    if (newName && newName !== oldName) {
      try {
        const res = await fetch("/api/admin/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rename",
            folder: currentAssetFolder,
            filename: oldName,
            newname: newName,
          }),
        });
        const data = await res.json();
        if (data.success) {
          await Swal.fire({
            icon: "success",
            title: "重命名成功",
            toast: true,
            position: "top",
            timer: 1500,
            showConfirmButton: false,
            background: "#1e293b",
            color: "#fff",
          });
          await fetchAssets(currentAssetFolder);
        } else {
          await Swal.fire({
            icon: "error",
            title: "失败",
            text: data.message,
            background: "#1e293b",
            color: "#ff4444",
          });
        }
      } catch {
        await Swal.fire({
          icon: "error",
          title: "网络错误",
          background: "#1e293b",
          color: "#ff4444",
        });
      }
    }
  };

  const deleteFile = async (filename: string) => {
    const confirm = await Swal.fire({
      icon: "warning",
      title: "确认删除文件",
      text: `确定要永久删除 ${filename} 吗？`,
      background: "#1e293b",
      color: "#fff",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#475569",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
    if (!confirm.isConfirmed) return;

    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          folder: currentAssetFolder,
          filename: filename,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchAssets(currentAssetFolder);
      } else {
        await Swal.fire({
          icon: "error",
          title: "删除失败",
          text: data.message,
          background: "#1e293b",
          color: "#ff4444",
        });
      }
    } catch {
      await Swal.fire({
        icon: "error",
        title: "网络错误",
        background: "#1e293b",
        color: "#ff4444",
      });
    }
  };

  const copyPath = async (path: string) => {
    await navigator.clipboard.writeText(path);
    await Swal.fire({
      icon: "success",
      title: "路径已复制",
      text: path,
      toast: true,
      position: "bottom",
      timer: 1500,
      showConfirmButton: false,
      background: "#1e293b",
      color: "#fff",
    });
  };

  // ===== SONG FUNCTIONS =====
  const addSongRow = () => {
    const defaultCat =
      config.song_ui.categories.find((c) => c.id !== "all")?.id || "gufeng";
    setSongData((prev) => [{ category: defaultCat, name: "", artist: "" }, ...prev]);
  };

  const removeSong = async (i: number) => {
    const target = songData[i];
    const confirm = await Swal.fire({
      icon: "warning",
      title: "删除歌曲",
      text: target?.name ? `确定删除《${target.name}》吗？` : "确定删除这首歌吗？",
      background: "#1e293b",
      color: "#fff",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#475569",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
    if (!confirm.isConfirmed) return;
    setSongData((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateSong = (i: number, key: "category" | "name" | "artist", val: string) => {
    setSongData((prev) =>
      prev.map((song, idx) => (idx === i ? { ...song, [key]: val } : song)),
    );
  };

  const parseBulkSongs = () => {
    const textarea = document.getElementById("bulk-songs") as HTMLTextAreaElement | null;
    if (!textarea) return;
    const raw = textarea.value;
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      void Swal.fire({
        icon: "info",
        title: "没有可导入的内容",
        text: "请先按“歌名 歌手”格式输入至少一行。",
        toast: true,
        position: "top",
        timer: 2000,
        showConfirmButton: false,
        background: "#1e293b",
        color: "#fff",
      });
      return;
    }

    const defaultCat =
      config.song_ui.categories.find((c) => c.id !== "all")?.id || "gufeng";

    const newSongs: SongItem[] = lines.map((line) => {
      const parts = line.split(/\s+/);
      const name = parts[0];
      const artist = parts.slice(1).join(" ") || "未知歌手";
      return { category: defaultCat, name, artist };
    });

    setSongData((prev) => [...prev, ...newSongs]);
    textarea.value = "";
    void Swal.fire({
      icon: "success",
      title: `已导入 ${newSongs.length} 首歌曲`,
      toast: true,
      position: "top",
      timer: 1800,
      showConfirmButton: false,
      background: "#1e293b",
      color: "#2de2e6",
    });
  };

  // ===== CATEGORY FUNCTIONS =====
  const addCategory = () => {
    addArrayItem("song_ui", "categories", {
      id: "new_cat",
      label: "NEW CATEGORY",
    });
  };

  const removeCategory = async (index: number) => {
    const confirm = await Swal.fire({
      icon: "warning",
      title: "删除分类",
      text: "注意：这不会删除该分类下的歌曲，但前台将无法通过分类筛选到它们。",
      background: "#1e293b",
      color: "#fff",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#475569",
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
    });
    if (confirm.isConfirmed) {
      removeArrayItem("song_ui", "categories", index);
    }
  };

  const moveCategory = (index: number, direction: number) => {
    setConfig((prev) => {
      const categories = [...prev.song_ui.categories];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= categories.length) return prev;
      [categories[index], categories[targetIndex]] = [
        categories[targetIndex],
        categories[index],
      ];
      return {
        ...prev,
        song_ui: {
          ...prev.song_ui,
          categories,
        },
      };
    });
  };

  // ===== HIDDEN SONG FUNCTIONS =====
  const addHiddenRow = () => {
    setHiddenSongs((prev) => [...prev, { name: "" }]);
  };

  const removeHidden = (i: number) => {
    setHiddenSongs((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateHidden = (i: number, val: string) => {
    setHiddenSongs((prev) =>
      prev.map((item, idx) => (idx === i ? { ...item, name: val } : item)),
    );
  };

  // ===== SAVE FUNCTION =====
  const saveData = async () => {
    const normalizedEditorName = editorName.trim();
    if (!normalizedEditorName) {
      await Swal.fire({
        icon: "warning",
        title: "请先填写修改人",
        text: "建议填写你们群里会互相通知时使用的名字，例如：ASUS / 丝瓜 / 运营",
        background: "#1e293b",
        color: "#ffd166",
      });
      return;
    }

    setEditorName(normalizedEditorName);
    window.localStorage.setItem(EDITOR_NAME_STORAGE_KEY, normalizedEditorName);

    const authed = await ensureAdminSession("保存站点配置需要管理员权限");
    if (!authed) return;

    const payload = {
      editor_name: normalizedEditorName,
      base_config_version: configVersion,
      site_info: config,
      song_data: songData,
      hidden_songs: hiddenSongs,
    };

    Swal.fire({
      title: "UPLOADING DATA...",
      background: "#1e293b",
      color: "#2de2e6",
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const res = await fetch("/api/admin/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ConfigLoadResponse;
      Swal.close();

      if (res.status === 409 || data.code === "CONFIG_VERSION_CONFLICT") {
        const result = await Swal.fire({
          icon: "warning",
          title: "检测到新版本",
          html: `当前线上版本：<b>#${data.current_version ?? "?"}</b><br/>最近修改人：<b>${data.config_updated_by || "未知"}</b><br/>最近修改时间：<b>${formatAuditTime(data.config_updated_at)}</b><br/><br/>你当前页面里的改动还在，但已不能直接覆盖保存。建议先重新加载最新内容，再把你的修改合进去。`,
          background: "#1e293b",
          color: "#ffd166",
          showCancelButton: true,
          confirmButtonColor: "#2de2e6",
          cancelButtonColor: "#475569",
          confirmButtonText: "重新加载最新版本",
          cancelButtonText: "先不刷新",
        });

        if (result.isConfirmed) {
          await loadConfigFromDB(false);
        }
        return;
      }

      if (data.success) {
        setConfigVersion(Number(data.config_version || configVersion));
        setConfigUpdatedAt(data.config_updated_at ?? null);
        setConfigUpdatedBy(data.config_updated_by ?? normalizedEditorName);
        await loadConfigFromDB(false);
        await Swal.fire({
          icon: "success",
          title: "SYSTEM UPDATED",
          text: `已保存为版本 #${Number(data.config_version || configVersion)}`,
          background: "#1e293b",
          color: "#2de2e6",
        });
      } else {
        await Swal.fire({
          icon: "error",
          title: "ACCESS DENIED",
          text: data.message,
          background: "#1e293b",
          color: "#ff4444",
        });
      }
    } catch {
      Swal.close();
      await Swal.fire({
        icon: "error",
        title: "NETWORK ERROR",
        background: "#1e293b",
        color: "#ff4444",
      });
    }
  };

  // ===== RENDER =====
  if (isLoading) {
    return <LoadingOverlay />;
  }

  return (
    <div className="p-4 md:p-8 min-h-screen bg-[#0f172a]">
      <div className="max-w-6xl mx-auto">
        <AdminHeader
          onSave={saveData}
          onReload={() => {
            void loadConfigFromDB(false);
          }}
          currentVersion={configVersion}
          lastUpdatedAt={configUpdatedAt}
          lastUpdatedBy={configUpdatedBy}
          historyCount={historyCount}
          editorName={editorName}
          onEditorNameChange={handleEditorNameChange}
        />
        <AdminTabsNav activeTab={activeTab} onSwitchTab={switchTab} />
        <AdminTabContent
          activeTab={activeTab}
          config={config}
          songData={songData}
          hiddenSongs={hiddenSongs}
          assetsCache={assetsCache}
          currentAssetFolder={currentAssetFolder}
          assetSortOrder={assetSortOrder}
          updateConfig={updateConfig}
          updateNested={updateNested}
          updateArray={updateArray}
          updateArraySimple={updateArraySimple}
          addArrayItem={addArrayItem}
          removeArrayItem={removeArrayItem}
          updateCreditPerson={updateCreditPerson}
          addCreditGroup={addCreditGroup}
          removeCreditGroup={removeCreditGroup}
          addCreditPerson={addCreditPerson}
          removeCreditPerson={removeCreditPerson}
          addSongRow={addSongRow}
          removeSong={removeSong}
          updateSong={updateSong}
          parseBulkSongs={parseBulkSongs}
          addCategory={addCategory}
          removeCategory={removeCategory}
          moveCategory={moveCategory}
          addHiddenRow={addHiddenRow}
          removeHidden={removeHidden}
          updateHidden={updateHidden}
          fetchAssets={fetchAssets}
          toggleAssetSort={toggleAssetSort}
          uploadFile={uploadFile}
          copyPath={copyPath}
          renameFile={renameFile}
          deleteFile={deleteFile}
        />
      </div>
    </div>
  );
}
