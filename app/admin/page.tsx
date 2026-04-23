"use client";

import React, { useState, useEffect } from "react";
import Swal from "sweetalert2";
import { AdminHeader } from "./components/AdminHeader";
import { AdminTabContent } from "./components/AdminTabContent";
import { AdminTabsNav } from "./components/AdminTabsNav";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { AdminTabId, AssetFile, HiddenSongItem, SiteConfig, SongItem } from "./types";

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

type MutableConfig = SiteConfig & Record<string, unknown>;
type UnknownRecord = Record<string, unknown>;

function formatAuditTime(value: string | null | undefined): string {
  if (!value) return "未知时间";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function getConfigSection(config: MutableConfig, section: string): UnknownRecord {
  const existing = config[section];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as UnknownRecord;
  }
  const nextSection: UnknownRecord = {};
  config[section] = nextSection;
  return nextSection;
}

// ========== MAIN COMPONENT ==========
export default function AdminDashboard() {
  // ===== STATE MANAGEMENT =====
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTabId>("hero");
  const [config, setConfig] = useState<SiteConfig>({});
  const [songData, setSongData] = useState<SongItem[]>([]);
  const [hiddenSongs, setHiddenSongs] = useState<HiddenSongItem[]>([]);
  const [isDevUnlocked, setIsDevUnlocked] = useState(false);

  // Assets state
  const [currentAssetFolder, setCurrentAssetFolder] = useState<"memes" | "pic">(
    "memes"
  );
  const [assetsCache, setAssetsCache] = useState<{
    memes: AssetFile[];
    pic: AssetFile[];
  }>({ memes: [], pic: [] });
  const [assetSortOrder, setAssetSortOrder] = useState<"asc" | "desc">("asc");
  const [adminPassword, setAdminPassword] = useState<string>("");
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
  }, []);

  async function loadConfigFromDB(isInitial = false) {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const data = (await res.json()) as ConfigLoadResponse;
      
      if (data.success) {
        setConfig(data.site_config || {});
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

  // ===== CONFIG UPDATERS =====
  const updateConfig = (section: string, key: string, val: unknown) => {
    setConfig((prev) => {
      const nextConfig = { ...prev } as MutableConfig;
      const sectionData = getConfigSection(nextConfig, section);
      sectionData[key] = val;
      return nextConfig;
    });
  };

  const updateNested = (
    section: string,
    obj: string,
    prop: string,
    val: unknown
  ) => {
    setConfig((prev) => {
      const newConfig = { ...prev } as MutableConfig;
      const sectionData = getConfigSection(newConfig, section);
      if (obj === "") {
        sectionData[prop] = val;
      } else {
        const existingNested = sectionData[obj];
        if (
          !existingNested ||
          typeof existingNested !== "object" ||
          Array.isArray(existingNested)
        ) {
          sectionData[obj] = {};
        }
        if (prop !== "") {
          (sectionData[obj] as UnknownRecord)[prop] = val;
        }
      }
      return newConfig;
    });
  };

  const updateArray = (
    section: string,
    arrayKey: string,
    index: number,
    key: string,
    val: unknown
  ) => {
    setConfig((prev) => {
      const newConfig = { ...prev } as MutableConfig;
      const sectionData = getConfigSection(newConfig, section);
      const arr = sectionData[arrayKey];
      if (
        Array.isArray(arr) &&
        arr[index] &&
        typeof arr[index] === "object" &&
        !Array.isArray(arr[index])
      ) {
        (arr[index] as UnknownRecord)[key] = val;
      }
      return newConfig;
    });
  };

  const updateArraySimple = (
    section: string,
    arrayKey: string,
    index: number,
    val: unknown
  ) => {
    setConfig((prev) => {
      const newConfig = { ...prev } as MutableConfig;
      const sectionData = getConfigSection(newConfig, section);
      const arr = sectionData[arrayKey];
      if (Array.isArray(arr)) {
        arr[index] = val;
      }
      return newConfig;
    });
  };

  const addArrayItem = (section: string, arrayKey: string, defaultValue: unknown) => {
    setConfig((prev) => {
      const newConfig = { ...prev } as MutableConfig;
      const sectionData = getConfigSection(newConfig, section);
      if (!Array.isArray(sectionData[arrayKey])) {
        sectionData[arrayKey] = [];
      }
      (sectionData[arrayKey] as unknown[]).push(defaultValue);
      return newConfig;
    });
  };

  const removeArrayItem = (section: string, arrayKey: string, index: number) => {
    setConfig((prev) => {
      const newConfig = { ...prev } as MutableConfig;
      const sectionData = getConfigSection(newConfig, section);
      const arr = sectionData[arrayKey];
      if (Array.isArray(arr)) {
        arr.splice(index, 1);
      }
      return newConfig;
    });
  };

  const updateCreditPerson = (
    creditIndex: number,
    personIndex: number,
    key: string,
    val: string
  ) => {
    setConfig((prev) => {
      const newConfig = { ...prev };
      const person =
        newConfig.model?.credits?.[creditIndex]?.val?.[personIndex];
      if (person) {
        newConfig.model?.credits?.[creditIndex]?.val?.splice(personIndex, 1, {
          ...person,
          [key]: val,
        });
      }
      return newConfig;
    });
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
      if (!adminPassword) {
        const { value: pass } = await Swal.fire({
          title: "服务器验证",
          text: "管理文件需要管理员权限",
          input: "password",
          inputPlaceholder: "Admin Password",
          background: "#1e293b",
          color: "white",
          confirmButtonColor: "#22d3ee",
          confirmButtonText: "验证",
          showCancelButton: true,
        });
        if (pass) {
          setAdminPassword(pass);
          await fetchAssets(currentAssetFolder, pass);
        } else {
          return;
        }
      } else {
        await fetchAssets(currentAssetFolder, adminPassword);
      }
    }

    setActiveTab(tab);
  };

  // ===== ASSETS FUNCTIONS =====
  const fetchAssets = async (folder: "memes" | "pic", password?: string) => {
    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          folder: folder,
          password: password || adminPassword,
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
    formData.append("password", adminPassword);
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
        await fetchAssets(currentAssetFolder, adminPassword);
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
            password: adminPassword,
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
          await fetchAssets(currentAssetFolder, adminPassword);
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
    if (!window.confirm(`确定要永久删除 ${filename} 吗？`)) return;

    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          folder: currentAssetFolder,
          filename: filename,
          password: adminPassword,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchAssets(currentAssetFolder, adminPassword);
      } else {
        alert("删除失败: " + data.message);
      }
    } catch {
      alert("网络错误");
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
      config.song_ui?.categories?.find((c) => c.id !== "all")?.id ||
      "gufeng";
    setSongData((prev) => [
      { category: defaultCat, name: "", artist: "" },
      ...prev,
    ]);
  };

  const removeSong = (i: number) => {
    if (window.confirm("删除这首歌？")) {
      setSongData((prev) => {
        const newData = [...prev];
        newData.splice(i, 1);
        return newData;
      });
    }
  };

  const updateSong = (i: number, key: string, val: string) => {
    setSongData((prev) => {
      const newData = [...prev];
      const song = newData[i];
      if (song) {
        newData[i] = { ...song, [key]: val } as SongItem;
      }
      return newData;
    });
  };

  const parseBulkSongs = () => {
    const textarea = document.getElementById("bulk-songs") as HTMLTextAreaElement;
    if (!textarea) return;
    const raw = textarea.value;
    const lines = raw.split("\n");
    const defaultCat =
      config.song_ui?.categories?.find((c) => c.id !== "all")?.id ||
      "gufeng";
    
    const newSongs: SongItem[] = [];
    lines.forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 1) {
        const name = parts[0];
        const artist = parts.slice(1).join(" ") || "未知歌手";
        newSongs.push({ category: defaultCat, name, artist });
      }
    });
    setSongData((prev) => [...prev, ...newSongs]);
    textarea.value = "";
  };

  // ===== CATEGORY FUNCTIONS =====
  const addCategory = () => {
    addArrayItem("song_ui", "categories", {
      id: "new_cat",
      label: "NEW CATEGORY",
    });
  };

  const removeCategory = (index: number) => {
    if (
      window.confirm(
        "删除这个分类？\n注意：这不会删除该分类下的歌曲，但前台将无法通过分类筛选到它们。"
      )
    ) {
      removeArrayItem("song_ui", "categories", index);
    }
  };

  const moveCategory = (index: number, direction: number) => {
    setConfig((prev) => {
      const newConfig = { ...prev };
      const categories = newConfig.song_ui?.categories || [];
      if (direction === -1 && index > 0) {
        const temp = categories[index];
        categories[index] = categories[index - 1];
        categories[index - 1] = temp;
      } else if (direction === 1 && index < categories.length - 1) {
        const temp = categories[index];
        categories[index] = categories[index + 1];
        categories[index + 1] = temp;
      }
      return newConfig;
    });
  };

  // ===== HIDDEN SONG FUNCTIONS =====
  const addHiddenRow = () => {
    setHiddenSongs((prev) => [
      ...prev,
      { name: "新隐藏曲目" },
    ]);
  };

  const removeHidden = (i: number) => {
    setHiddenSongs((prev) => {
      const newData = [...prev];
      newData.splice(i, 1);
      return newData;
    });
  };

  const updateHidden = (i: number, val: string) => {
    setHiddenSongs((prev) => {
      const newData = [...prev];
      newData[i].name = val;
      return newData;
    });
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

    const { value: password } = await Swal.fire({
      title: "身份验证",
      input: "password",
      inputPlaceholder: "请输入管理员密码",
      background: "#1e293b",
      color: "white",
      confirmButtonColor: "#2de2e6",
    });

    if (!password) return;

    const payload = {
      password,
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
          adminPassword={adminPassword}
          updateConfig={updateConfig}
          updateNested={updateNested}
          updateArray={updateArray}
          updateArraySimple={updateArraySimple}
          addArrayItem={addArrayItem}
          removeArrayItem={removeArrayItem}
          updateCreditPerson={updateCreditPerson}
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
