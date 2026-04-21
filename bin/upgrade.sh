#!/usr/bin/env bash
# =============================================================================
# UliUli 发信箱版升级脚本（Docker + 1Panel 友好）
#
# 用法（在**解压后**的新项目目录里执行）：
#   bash bin/upgrade.sh /path/to/old-project
#
# 脚本会做：
#   1. 自动备份旧项目的 codes.db（带时间戳）
#   2. 把旧的 data/ 和 public/{memes,pic} 拷过来
#   3. 若 docker-compose.yml 里 WINDCHIME_HASH_SALT 还是默认值，
#      用 openssl 生成一段随机 salt 并写入
#   4. 打印下一步要跑的 docker 命令
#
# 脚本不会 **自动执行** docker compose up/down/build —— 保留给你最后确认。
# =============================================================================

set -euo pipefail

C_RESET="\033[0m"
C_BOLD="\033[1m"
C_RED="\033[31m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_CYAN="\033[36m"

info()  { printf "${C_CYAN}→${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$*"; }
err()   { printf "${C_RED}✗${C_RESET} %s\n" "$*" >&2; }
title() { printf "\n${C_BOLD}==== %s ====${C_RESET}\n" "$*"; }

# -----------------------------------------------------------------------------
# 0. 前置检查
# -----------------------------------------------------------------------------

NEW_DIR="$(pwd)"
OLD_DIR="${1:-}"

if [[ -z "$OLD_DIR" ]]; then
  err "请把旧项目目录作为第一个参数传入"
  echo
  echo "示例："
  echo "  bash bin/upgrade.sh /opt/1panel/apps/uliuli-website.old"
  echo
  echo "（旧项目目录就是之前 docker-compose.yml 所在的那个文件夹）"
  exit 1
fi

# 规整路径（去掉尾部斜杠 & 转绝对路径）
OLD_DIR="$(cd "$OLD_DIR" 2>/dev/null && pwd || echo "$OLD_DIR")"

title "UliUli 发信箱版升级"
echo "新项目：$NEW_DIR"
echo "旧项目：$OLD_DIR"
echo "时间戳：$(date +%Y-%m-%d\ %H:%M:%S)"

# 必须在新项目根目录执行
if [[ ! -f "$NEW_DIR/docker-compose.yml" ]] || [[ ! -f "$NEW_DIR/package.json" ]]; then
  err "当前目录不是新版 UliUli 项目根目录（缺 docker-compose.yml 或 package.json）"
  err "请先 cd 到解压后的新项目目录再执行"
  exit 1
fi

if [[ ! -d "$OLD_DIR" ]]; then
  err "旧项目目录不存在：$OLD_DIR"
  exit 1
fi

# 防止把新项目当成旧项目传进来
if [[ "$NEW_DIR" == "$OLD_DIR" ]]; then
  err "新旧项目不能是同一个目录"
  exit 1
fi

# -----------------------------------------------------------------------------
# 1. 备份旧 DB
# -----------------------------------------------------------------------------

title "1/4 备份旧 DB"

TS=$(date +%Y%m%d-%H%M%S)
OLD_DB="$OLD_DIR/data/codes.db"

if [[ -f "$OLD_DB" ]]; then
  BACKUP="$OLD_DB.backup-$TS"
  cp "$OLD_DB" "$BACKUP"
  ok "已备份到 $BACKUP（$(du -h "$BACKUP" | cut -f1)）"
else
  warn "旧项目没有 data/codes.db，跳过 DB 备份"
fi

# -----------------------------------------------------------------------------
# 2. 复制 data / public 用户上传目录
# -----------------------------------------------------------------------------

title "2/4 迁移 data / public 用户数据"

mkdir -p "$NEW_DIR/data" "$NEW_DIR/public/memes" "$NEW_DIR/public/pic"

if [[ -f "$OLD_DB" ]]; then
  cp "$OLD_DB" "$NEW_DIR/data/codes.db"
  ok "data/codes.db 已迁移（$(du -h "$NEW_DIR/data/codes.db" | cut -f1)）"
else
  warn "旧 DB 不存在，新项目将在首次启动时创建全新 DB"
fi

# memes / pic 使用 cp -a 保留权限与软链
for sub in memes pic; do
  src="$OLD_DIR/public/$sub"
  dst="$NEW_DIR/public/$sub"
  if [[ -d "$src" ]]; then
    # 复制子内容（含隐藏文件），不覆盖已存在的同名文件（新 zip 的资源优先）
    # -n: 不覆盖；/. 表示复制目录内容
    cp -rn "$src/." "$dst/" 2>/dev/null || true
    count=$(find "$src" -type f 2>/dev/null | wc -l | tr -d ' ')
    ok "public/$sub 合并完成（旧目录共 $count 个文件，同名以新包优先）"
  else
    warn "旧项目没有 public/$sub/，跳过"
  fi
done

# -----------------------------------------------------------------------------
# 3. 生成 WINDCHIME_HASH_SALT
# -----------------------------------------------------------------------------

title "3/4 生成 WINDCHIME_HASH_SALT"

COMPOSE_FILE="$NEW_DIR/docker-compose.yml"

if ! command -v openssl >/dev/null 2>&1; then
  warn "未找到 openssl，跳过自动生成 salt"
  warn "请手动编辑 docker-compose.yml，把 WINDCHIME_HASH_SALT 改成一段 32+ 位随机字符串"
elif grep -q "change_me_to_a_long_random_string" "$COMPOSE_FILE"; then
  SALT=$(openssl rand -hex 32)
  # 用 | 作为分隔符避免 / 撞冲突；兼容 GNU / BSD sed
  if sed --version >/dev/null 2>&1; then
    sed -i "s|change_me_to_a_long_random_string|$SALT|" "$COMPOSE_FILE"
  else
    sed -i '' "s|change_me_to_a_long_random_string|$SALT|" "$COMPOSE_FILE"
  fi
  ok "已写入新 salt：${SALT:0:16}…（共 64 字符，已隐藏剩余部分）"
else
  ok "WINDCHIME_HASH_SALT 已是自定义值，跳过"
fi

# -----------------------------------------------------------------------------
# 4. 同步 ADMIN_PASSWORD（如果旧 compose 里改过的话）
# -----------------------------------------------------------------------------

title "4/4 检查 ADMIN_PASSWORD 一致性"

OLD_COMPOSE="$OLD_DIR/docker-compose.yml"

if [[ -f "$OLD_COMPOSE" ]]; then
  OLD_PWD_LINE=$(grep -E "^\s*-?\s*ADMIN_PASSWORD=" "$OLD_COMPOSE" | head -n1 || true)
  NEW_PWD_LINE=$(grep -E "^\s*-?\s*ADMIN_PASSWORD=" "$COMPOSE_FILE" | head -n1 || true)

  if [[ -n "$OLD_PWD_LINE" && -n "$NEW_PWD_LINE" && "$OLD_PWD_LINE" != "$NEW_PWD_LINE" ]]; then
    warn "旧 compose 的 ADMIN_PASSWORD 与新 compose 不一致"
    echo "   旧：$OLD_PWD_LINE"
    echo "   新：$NEW_PWD_LINE"
    warn "如需沿用旧密码，请手动把新 compose 里的 ADMIN_PASSWORD 改回去"
  else
    ok "ADMIN_PASSWORD 无冲突"
  fi

  OLD_DEV_LINE=$(grep -E "^\s*-?\s*DEV_UNLOCK_PASSWORD=" "$OLD_COMPOSE" | head -n1 || true)
  NEW_DEV_LINE=$(grep -E "^\s*-?\s*DEV_UNLOCK_PASSWORD=" "$COMPOSE_FILE" | head -n1 || true)
  if [[ -n "$OLD_DEV_LINE" && -n "$NEW_DEV_LINE" && "$OLD_DEV_LINE" != "$NEW_DEV_LINE" ]]; then
    warn "DEV_UNLOCK_PASSWORD 也不一致，同上自行选择是否改回"
  fi
else
  warn "旧项目没有 docker-compose.yml，跳过密码对比"
fi

# -----------------------------------------------------------------------------
# 完成
# -----------------------------------------------------------------------------

title "升级准备完成"
echo "接下来请按顺序执行："
echo
printf "  ${C_BOLD}1. 停掉旧容器（如果还在跑）${C_RESET}\n"
echo "     cd '$OLD_DIR'"
echo "     docker compose down"
echo
printf "  ${C_BOLD}2. 回到新项目并重建镜像${C_RESET}\n"
echo "     cd '$NEW_DIR'"
echo "     docker compose build --no-cache"
echo
printf "  ${C_BOLD}3. 启动新容器${C_RESET}\n"
echo "     docker compose up -d"
echo
printf "  ${C_BOLD}4. 查看日志确认 OK${C_RESET}\n"
echo "     docker compose logs -f --tail=100"
echo
echo "一切无误后，旧项目目录 '$OLD_DIR' 可保留一周做回滚，然后再删。"
echo
