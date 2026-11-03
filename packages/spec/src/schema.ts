import { z } from 'zod';

/** 书籍 id 与文件名共用的字符集：小写字母、数字、连字符 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHAPTER_FILE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

/** YAML 中不加引号的日期会被解析成 Date，这里统一成 YYYY-MM-DD 字符串 */
const isoDate = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
);

/** 读完本书后推荐接着读的一本：书 id 加一句理由（显示在最后一章末尾的「接着读」里） */
const nextBookSchema = z.object({
  id: z.string().regex(SLUG_RE, 'id 只能包含 [a-z0-9-]'),
  reason: z.string().trim().min(1).max(60, 'reason 写一句话，不超过 60 字').optional(),
});

export const bookManifestSchema = z.object({
  id: z.string().regex(SLUG_RE, 'id 只能包含 [a-z0-9-]'),
  title: z.string().trim().min(1),
  subtitle: z.string().trim().min(1).optional(),
  category: z
    .string()
    .regex(/^[^/\s]+(?:\/[^/\s]+)*$/, 'category 用 / 分层，不能有空段或空白')
    .optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  level: z.enum(LEVELS).optional(),
  created: isoDate.optional(),
  updated: isoDate.optional(),
  chapters: z
    .array(z.string().regex(CHAPTER_FILE_RE, '章节文件名只能包含 [a-z0-9-] 并以 .md 结尾'))
    .min(1)
    .refine((list) => new Set(list).size === list.length, 'chapters 中有重复文件'),
  next: z
    .array(nextBookSchema)
    .max(3, 'next 最多 3 本')
    .refine((list) => new Set(list.map((b) => b.id)).size === list.length, 'next 中有重复的书')
    .optional(),
});

export type BookManifest = z.infer<typeof bookManifestSchema>;
export type NextBook = z.infer<typeof nextBookSchema>;
export type BookLevel = (typeof LEVELS)[number];
