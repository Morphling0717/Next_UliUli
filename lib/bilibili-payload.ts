/** Adapt both proxy generations without accepting failed responses as a new cache. */
export const LATEST_BILIBILI_VIDEO_LIMIT = 15;

type ObjectValue = Record<string, unknown>;
export type BilibiliVideo = ObjectValue & {
  title: string;
  pic: string;
  url: string;
  length: string;
  date: string;
  play: string | number;
  /** Epoch seconds, including any available subsecond precision. */
  created?: number;
};
export type NormalizedBilibiliPayload = ObjectValue & {
  success: true;
  user: ObjectValue;
  videos: BilibiliVideo[];
  video_count: number;
  partial?: boolean;
};

function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ObjectValue : undefined;
}
function fail(reason: string): never {
  // Never include upstream bodies/profile values in cache error logs.
  throw new Error(`Unusable Bilibili payload: ${reason}`);
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function epochMilliseconds(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number === undefined || number <= 0) return undefined;
  const milliseconds = number >= 100_000_000_000 ? number : number * 1000;
  return milliseconds < 253402300800000 ? milliseconds : undefined;
}
function validCalendar(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function dateMilliseconds(value: unknown): number | undefined {
  const input = text(value);
  if (!input) return undefined;
  const local = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?)?$/.exec(input);
  let parsed: number;
  if (local) {
    const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = ''] = local;
    if (!validCalendar(Number(year), Number(month), Number(day)) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined;
    // Old date-only/local-date cache fields describe the Bilibili calendar day.
    parsed = Date.parse(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}${fraction}+08:00`);
  } else {
    const zoned = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(input);
    if (!zoned || !validCalendar(Number(zoned[1]), Number(zoned[2]), Number(zoned[3]))) return undefined;
    parsed = Date.parse(input);
  }
  return Number.isFinite(parsed) ? parsed : undefined;
}
function publicationTime(video: ObjectValue): number | undefined {
  const fields = ['created', 'pubdate', 'pub_date', 'publish_time', 'published_at', 'created_at', 'ctime'];
  for (const field of fields) {
    const result = epochMilliseconds(video[field]);
    if (result !== undefined) return result;
  }
  for (const field of [...fields, 'date']) {
    const result = dateMilliseconds(video[field]);
    if (result !== undefined) return result;
  }
  return undefined;
}
const beijingDate = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
function displayDate(milliseconds: number): string {
  const parts = beijingDate.formatToParts(milliseconds);
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function duration(value: unknown): string | undefined {
  const existing = text(value);
  if (existing) {
    const pieces = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(existing);
    if (pieces && (!pieces[3] || Number(pieces[2]) < 60)) return existing;
  }
  const secondsValue = finiteNumber(value);
  if (secondsValue === undefined || secondsValue < 0 || secondsValue > Number.MAX_SAFE_INTEGER) return undefined;
  const seconds = Math.floor(secondsValue);
  const two = (number: number) => String(number).padStart(2, '0');
  if (seconds < 3600) return `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`;
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`;
}
function link(value: unknown, allowLocalImage = false): string | undefined {
  const input = text(value);
  if (!input) return undefined;
  if (allowLocalImage && input.startsWith('/') && !input.startsWith('//')) return input;
  const normalized = input.startsWith('//') ? `https:${input}` : input;
  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? normalized : undefined;
  } catch { return undefined; }
}
function normalizeVideo(value: unknown): { video: BilibiliVideo; time?: number } | undefined {
  const record = object(value);
  if (!record) return undefined;
  const title = text(record.title);
  const pic = link(record.pic, true) ?? link(record.cover, true);
  const bvid = text(record.bvid);
  const aid = finiteNumber(record.aid);
  const url = link(record.url) ?? (bvid && /^BV[A-Za-z0-9]+$/.test(bvid)
    ? `https://www.bilibili.com/video/${bvid}`
    : aid && Number.isSafeInteger(aid) && aid > 0 ? `https://www.bilibili.com/video/av${aid}` : undefined);
  if (!title || !pic || !url) return undefined;
  const time = publicationTime(record);
  const play = typeof record.play === 'string' || (typeof record.play === 'number' && Number.isFinite(record.play) && record.play >= 0) ? record.play : '';
  return {
    time,
    video: {
      ...record, title, pic, url, play,
      desc: typeof record.desc === 'string' ? record.desc : typeof record.description === 'string' ? record.description : '',
      length: duration(record.length) ?? duration(record.duration) ?? '',
      date: time === undefined ? '' : displayDate(time),
      created: time === undefined ? undefined : time / 1000,
    },
  };
}
function normalizeUser(root: ObjectValue, section: ObjectValue | undefined): ObjectValue {
  const source = object(root.user);
  const data = object(section?.data);
  const profile = object(data?.profile);
  const statistics = object(data?.statistics);
  const live = object(data?.live);
  const user: ObjectValue = { ...source };
  const mapped: ObjectValue = {
    name: profile?.name, face: profile?.avatar,
    fans: statistics?.followers, attention: statistics?.following,
    is_live: live?.is_live, live_title: live?.title, live_url: live?.url,
    live_cover: live?.cover, live_area: live?.area, live_area_parent: live?.parent_area,
  };
  for (const [key, value] of Object.entries(mapped)) {
    if (user[key] == null && value !== undefined) user[key] = value;
  }
  const knownFans = typeof user.fans === 'number' ? Number.isFinite(user.fans) && user.fans >= 0 : Boolean(text(user.fans));
  if (user.fans != null && !knownFans) fail('invalid profile follower count');
  if (!text(user.name) && !text(user.face) && !knownFans) fail('missing profile data');
  if (user.is_live === 1 || user.is_live === '1' || user.is_live === 'true') user.is_live = true;
  else if (user.is_live === 0 || user.is_live === '0' || user.is_live === 'false') user.is_live = false;
  else if (user.is_live !== undefined && user.is_live !== null && typeof user.is_live !== 'boolean') fail('invalid live status');
  return user;
}

export function normalizeBilibiliPayload(payload: unknown): NormalizedBilibiliPayload {
  const root = object(payload);
  if (!root || root.success === false) fail('request failed or payload is not an object');
  const sections = object(root.sections);
  const statuses = Object.values(sections ?? {}).map(object);
  if (statuses.length && !statuses.some((section) => section?.ok === true)) fail('all sections failed');
  const profileSection = object(sections?.profile);
  const videoSection = object(sections?.videos);
  if (sections && 'profile' in sections && profileSection?.ok !== true) fail('profile section failed');
  if (sections && 'videos' in sections && videoSection?.ok !== true) fail('videos section failed');
  const structuredVideos = object(videoSection?.data)?.items;
  // The legacy root list is derived from this section by the new proxy.
  // Prefer its authoritative items when both representations are available.
  const incoming = Array.isArray(structuredVideos) ? structuredVideos : root.videos;
  if (!Array.isArray(incoming)) fail('missing videos list');
  const user = normalizeUser(root, profileSection);
  const valid = incoming.flatMap((item, index) => {
    const normalized = normalizeVideo(item);
    return normalized ? [{ ...normalized, index }] : [];
  });
  if (incoming.length && !valid.length) fail('videos list contains no usable videos');
  const videos = valid
    .sort((left, right) => (right.time ?? -Infinity) - (left.time ?? -Infinity) || left.index - right.index)
    .slice(0, LATEST_BILIBILI_VIDEO_LIMIT)
    .map((entry) => entry.video);
  const partial = root.partial === true || statuses.some((section) => section?.ok !== true) || valid.length < incoming.length;
  return {
    ...root,
    success: true,
    user,
    videos,
    video_count: videos.length,
    ...(partial || typeof root.partial === 'boolean' ? { partial } : {}),
  };
}
