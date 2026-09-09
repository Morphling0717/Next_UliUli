# B 站数据接入

网站（首页、概念页、风铃分享头像）统一请求本站 `/api/bilibili`。服务端上游由 `BILIBILI_API_URL` 配置，后台显示的站内路径只读；`site_config.api.bilibili` 的历史值不再参与请求，也不会出现在新的首页/API 配置输出中。

当前公开入口：

```text
https://api.uliuli.cn/api?mid=3546779356235807&section=profile,videos&page_size=15&order=pubdate
```

`api.uliuli.cn` 使用现有服务器的独立 HTTPS 反向代理，后端为 [bili-proxy](https://github.com/Morphling0717/bili-proxy) 的 Vercel 正式地址 `https://bili-proxy.vercel.app/api`。旧 `uliuli.cc` 和 `api.uliuli.cc` 已失效。历史数据库迁移与 `legacy-unused` 中的旧地址仅保留作历史记录，不再用于运行时请求。

服务端只请求 profile/videos 两个分区和第一页。视频按精确发布时间降序，最多返回 15 条；首页和概念页都使用这份列表。新代理的秒数时长转换为 `MM:SS`/`HH:MM:SS`，日期按北京时间显示为 `YYYY-MM-DD`。列表不足 15 条时按实际数量显示，不补假视频。直播、粉丝与头像来自同一份公开资料。

## 配置和升级

```dotenv
BILIBILI_API_URL=https://api.uliuli.cn/api?mid=3546779356235807&section=profile,videos&page_size=15&order=pubdate
BILIBILI_CACHE_TTL_SECONDS=180
BILIBILI_FETCH_TIMEOUT_MS=8000
BILIBILI_REFRESH_ERROR_BACKOFF_SECONDS=60
```

修改 `.env` 后重新创建网站容器，使环境变量生效。保持现有 `.env` 的其他字段、数据库目录及图片绑定目录；不要运行 `init-full-config.js` 来更新生产配置，它是初始化示例。

缓存将数据、时间和上游地址摘要放在 `global_config` 的一个原子记录 `bilibili.last_success.v2` 中。更换上游不会读取另一个上游的成功数据。旧的 `bilibili.last_success` / `bilibili.last_success_at` 保留原样；第一次启动新版需要成功获取一次新数据。相同上游的后续暂时故障仍可显示标记为 stale 的上次成功数据。HTTP 200 的错误对象、资料/投稿分区失败和全部畸形视频不会覆盖正常缓存。

这次更新不修改数据库结构、风铃迁移记录、信件、话题、用户、歌曲或其他站点配置；只会正常更新 B 站缓存键。公开配置输出使用派生的 `/api/bilibili`，不为替换失效显示值而重写整份 `site_config`。

## 检查

```sh
npm run test:bilibili
npm run build
```

测试覆盖新旧 payload、乱序及超出 15 条、同日精确排序、有效空投稿、错误响应、旧缓存隔离、同源故障兜底、并发刷新和恢复。上线后还需检查真实 HTTPS、资料和列表，确认首页 `.gallery-item` 数量不超过 15，概念页视频链接同样不超过 15。
