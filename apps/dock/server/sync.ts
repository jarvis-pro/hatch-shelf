import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildChapterPackage, sameNotes } from '@shelf/library';
import { audioPackageName, LIBRARY_AUDIO_DIR, MAX_PACKAGE_BYTES, sameChapterAudio, type AudioManifest, type DeviceBook, type SessionItem } from '@shelf/spec';
import type { Job, JobItem, PhoneState } from '../shared/types';
import { readNotes, type LibEntry } from './library';
import { findPhone, Phone, PhoneError } from './phone';
import { coverThumb } from './thumb';

/** 本地原声里手机上还没有（或不一样）的章节 */
function missingChapters(local: AudioManifest, device: AudioManifest | null): string[] {
  return Object.keys(local.chapters).filter((ch) => !sameChapterAudio(device, local, ch));
}

/** 连上手机，拿到和书库比对需要的全部信息 */
export async function phoneState(entries: LibEntry[], key: string, hint: string | null): Promise<{ state: PhoneState; phone: Phone | null }> {
  const found = await findPhone(key, hint);
  if (found.status !== 'online') return { state: found, phone: null };
  const phone = new Phone(found.addr, key);
  const books = await phone.books();
  const onPhone = new Set(books.map((b) => b.id));

  const audioMissing: Record<string, number> = {};
  const audioMissingBytes: Record<string, number> = {};
  await Promise.all(
    entries
      .filter((e) => e.audio && e.manifest)
      .map(async (e) => {
        const id = e.manifest!.id;
        const device = onPhone.has(id) ? await phone.audio(id) : null;
        const chapters = missingChapters(e.audio!, device);
        if (!chapters.length) return;
        audioMissing[id] = chapters.length;
        audioMissingBytes[id] = audioBytes(path.join(e.dir, LIBRARY_AUDIO_DIR), e.audio!, chapters);
      }),
  );

  const notes: Record<string, number> = {};
  for (const n of await phone.notes()) {
    const entry = entries.find((e) => e.manifest?.id === n.id);
    const local = entry ? readNotes(entry.dir) : null;
    if (entry && (local === null || !sameNotes(local, n.markdown))) notes[n.id] = n.count;
  }
  return { state: { status: 'online', addr: found.addr, device: found.device, books, audioMissing, audioMissingBytes, notes }, phone };
}

interface Step {
  item: JobItem;
  /** 先推书（新书 / 有更新），再按章推原声 */
  zip: Uint8Array | null;
  audio: { dir: string; manifest: AudioManifest; chapters: string[] } | null;
  /** 新书的封面缩略图，只放进推送请求，不放进网页轮询的进度 */
  cover?: string;
}

const audioBytes = (dir: string, m: AudioManifest, chapters: string[]) =>
  [...new Set(chapters.flatMap((ch) => m.chapters[ch].flatMap((e) => e.files)))].reduce((n, fp) => {
    try {
      return n + statSync(path.join(dir, `${fp}.mp3`)).size;
    } catch {
      return n;
    }
  }, 0);

/** 按手机上现在的状态，算出选中的每本书要传什么 */
async function plan(phone: Phone, entries: LibEntry[], ids: string[]): Promise<Step[]> {
  const device = new Map<string, DeviceBook>((await phone.books()).map((b) => [b.id, b]));
  const steps: Step[] = [];
  for (const id of ids) {
    const e = entries.find((x) => x.manifest?.id === id);
    if (!e?.manifest || !e.zip) continue;
    const d = device.get(id);
    const kind: SessionItem['kind'] = !d ? 'new' : d.hash !== e.info.hash ? 'update' : 'audio';
    const audioDir = path.join(e.dir, LIBRARY_AUDIO_DIR);
    const chapters = e.audio ? missingChapters(e.audio, d ? await phone.audio(id) : null) : [];
    if (kind === 'audio' && chapters.length === 0) continue;
    const zip = kind === 'audio' ? null : e.zip;
    const aBytes = e.audio && chapters.length ? audioBytes(audioDir, e.audio, chapters) : 0;
    const detail = [kind === 'new' ? `${e.manifest.chapters.length} 章` : kind === 'update' ? '内容有更新' : '', chapters.length ? `补 ${chapters.length} 章原声` : '']
      .filter(Boolean)
      .join(' · ');
    // 手机上还没有的书带上分类和封面缩略图，确认框里才画得出封面
    const look = kind === 'new' ? { subtitle: e.manifest.subtitle, category: e.manifest.category } : {};
    steps.push({
      item: { id, title: e.manifest.title, kind, detail, audioChapters: chapters.length, ...look, state: 'queued', bytes: (zip?.length ?? 0) + aBytes, sent: 0 },
      zip,
      audio: e.audio && chapters.length ? { dir: audioDir, manifest: e.audio, chapters } : null,
      cover: kind === 'new' ? await coverThumb(e.dir) : undefined,
    });
  }
  return steps;
}

/** 当前这次推送；同一时间只有一次 */
let job: Job | null = null;
let abort: AbortController | null = null;

export const currentJob = () => job;

export function stopJob() {
  abort?.abort();
}

export async function startPush(entries: LibEntry[], key: string, addr: string, ids: string[]): Promise<Job> {
  if (job && (job.state === 'confirm' || job.state === 'pushing')) throw new Error('上一次推送还没结束');
  const phone = new Phone(addr, key);
  const steps = await plan(phone, entries, ids);
  if (steps.length === 0) throw new Error('选中的书在手机上都已是最新');
  job = { state: 'confirm', items: steps.map((s) => s.item) };
  abort = new AbortController();
  void run(phone, steps, job, abort.signal);
  return job;
}

async function run(phone: Phone, steps: Step[], j: Job, signal: AbortSignal) {
  const items = steps.map(({ item: { id, title, kind, detail, audioChapters, subtitle, category }, cover }) => ({ id, title, kind, detail, audioChapters, subtitle, category, cover }));
  try {
    const accepted = await phone.request({ items, bytes: steps.reduce((n, s) => n + s.item.bytes, 0) }, signal);
    if (!accepted) {
      j.state = 'rejected';
      return;
    }
    j.state = 'pushing';
    for (const { item, zip, audio } of steps) {
      if (signal.aborted) break;
      item.state = 'uploading';
      let base = 0;
      const send = async (name: string, data: Uint8Array) => {
        if (data.length > MAX_PACKAGE_BYTES) throw new Error(`${name} 超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB，App 收不下`);
        const res = await phone.upload(name, data, (r) => (item.sent = Math.min(item.bytes, base + Math.round(r * data.length))), signal);
        if (!res.ok) throw new Error(res.error ?? '上传失败');
        base += data.length;
        item.sent = Math.min(item.bytes, base);
      };
      try {
        if (zip) await send(`${item.id}.zip`, zip);
        if (audio) {
          for (const [i, ch] of audio.chapters.entries()) {
            if (signal.aborted) break;
            item.audio = { index: i + 1, total: audio.chapters.length };
            await send(audioPackageName(item.id, ch), buildChapterPackage(audio.dir, audio.manifest, ch));
          }
        }
        item.state = signal.aborted ? 'failed' : 'done';
        if (signal.aborted) item.error = '已停止';
        item.sent = item.bytes;
      } catch (e) {
        if (signal.aborted) {
          item.state = 'failed';
          item.error = '已停止';
          break;
        }
        item.state = 'failed';
        item.error = (e as Error).message;
        if (e instanceof PhoneError) throw e;
      }
    }
    j.state = signal.aborted ? 'stopped' : 'done';
  } catch (e) {
    j.state = signal.aborted ? 'stopped' : 'failed';
    j.error = signal.aborted ? undefined : (e as Error).message;
  } finally {
    for (const i of j.items) if (i.state === 'queued') i.error = j.state === 'stopped' ? '已停止' : undefined;
    if (j.state !== 'rejected') await phone.end();
  }
}

/** 把手机上的笔记写到书库各书目录的 notes.md；只差导出日期的不重写 */
export async function pullNotes(entries: LibEntry[], key: string, addr: string) {
  const phone = new Phone(addr, key);
  let written = 0;
  let count = 0;
  const notes = await phone.notes();
  for (const n of notes) {
    const entry = entries.find((e) => e.manifest?.id === n.id);
    if (!entry) continue;
    const old = readNotes(entry.dir);
    if (old !== null && sameNotes(old, n.markdown)) continue;
    writeFileSync(path.join(entry.dir, 'notes.md'), n.markdown);
    written += 1;
    count += n.count;
  }
  if (written) await phone.log({ kind: 'notes', detail: `${count} 条高亮 · ${written} 本书` });
  return { written, count, total: notes.length };
}

export async function backup(key: string, addr: string) {
  const phone = new Phone(addr, key);
  const data = await phone.backup();
  const books = new Set(data.progress.map((p) => p.book_id)).size;
  await phone.log({ kind: 'backup', detail: `${books} 本书的进度 · ${data.highlights.length} 条高亮与笔记` });
  return data;
}
