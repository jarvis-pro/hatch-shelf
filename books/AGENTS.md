# 写书规范

本目录下的每个子目录是一本书。任何 agent 在这里写书时必须遵守本文件；完整背景见仓库根目录 `README.md` 第 4 节。

要写哪些书、每本的大纲和进度见 `ROADMAP.md`；写完一本按其中「约定」更新进度。

## 目录结构

```
books/<book-id>/
├── book.yaml
├── cover.png          # 可选；缺省时 App 自动生成文字封面
├── 01-xxx.md
├── 02-xxx.md
└── assets/            # 本书的全部图片
```

## book.yaml

```yaml
id: go-concurrency            # 必填，全局唯一，[a-z0-9-]，必须与目录名一致；同 id 再次导入即为更新
title: Go 并发编程实战          # 必填
subtitle: 从 goroutine 到调度器  # 可选
category: tech/go             # 可选，书架分组，用 / 分层
tags: [go, concurrency]       # 可选
level: intermediate           # 可选：beginner | intermediate | advanced
created: 2026-11-02           # 可选，YYYY-MM-DD
updated: 2026-11-02           # 可选，每次修改内容时更新
chapters:                     # 必填，显式排序；未列入的 .md 会被忽略
  - 01-goroutine.md
  - 02-channel.md
```

字段的权威定义是 `packages/spec/src/schema.ts`，两者冲突时以代码为准并修正本文件。

## 硬规则

- 每章一个 `.md` 文件，以**唯一**的 H1 作为章标题；章内用 H2 / H3 组织（阅读器目录取 H1–H3）
- 文件名只使用 `[a-z0-9-]` 和 `.md`，建议用两位序号前缀：`01-intro.md`
- 图片放在本书 `assets/` 下，用相对路径引用：`![说明](assets/xxx.png)`
- **禁止远程图片**（`http(s)://`），手机离线时无法显示
- 图表优先使用 Mermaid（` ```mermaid `）
- 代码块必须标注语言（` ```go `、` ```bash `、` ```text ` …）
- 数学公式使用 KaTeX 语法：行内 `$...$`，块级 `$$...$$`
- 图片格式限于 png / jpg / jpeg / gif / webp / svg，其余文件导入时会被丢弃

## 提交

- 内容提交使用 `content:` 前缀，例如 `content: add go-concurrency ch3`
- 写完后运行 `shelf-pack check books/<id>` 自检（M4 起可用）
