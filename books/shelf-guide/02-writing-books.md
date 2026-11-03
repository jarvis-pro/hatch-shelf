# 写书规范

一本书就是一个目录，里面放一个 `book.yaml` 和若干章节文件。

## 目录结构

```text
books/go-concurrency/
├── book.yaml
├── cover.png          # 可选
├── 01-goroutine.md
├── 02-channel.md
└── assets/            # 本书的全部图片
```

## book.yaml

```yaml
id: go-concurrency            # 必填，[a-z0-9-]，同 id 再次导入即为更新
title: Go 并发编程实战          # 必填
subtitle: 从 goroutine 到调度器  # 可选
category: 技术/Go             # 可选，书架分组，用 / 分层
level: intermediate           # 可选：beginner | intermediate | advanced
chapters:                     # 必填，显式排序
  - 01-goroutine.md
  - 02-channel.md
```

## 硬规则

- 每章一个 `.md` 文件，以**唯一**的 H1 作为章标题
- 图片只能引用 `assets/` 下的相对路径，**禁止远程图片**
- 图表用 Mermaid 或 SVG 图片，不要在代码块里用字符画图
- 公式使用 KaTeX 语法
- 代码块必须标注语言
- 文件名只使用 `[a-z0-9-]` 和 `.md`

## 图片

图片和章节放在同一本书里，用相对路径引用：

```markdown
![渐变示例](assets/gradient.png)
```

效果如下（点击可放大）：

![渐变示例](assets/gradient.png)

### 用哪种方式画图

- **流程、结构、层级**：用 Mermaid，直接写在章节里
- **柱状图、坐标图、示意图**：画成 SVG 放进 `assets/`，图片自带白色底板，在暗色主题下也看得清
- **不要用字符拼图**：`│╲`、`████` 这类在手机上会错位，看不清

## 自检

写完后在电脑上运行：

```bash
shelf-pack check books/go-concurrency
```

它会检查 `book.yaml` 格式、缺失的章节和远程图片。
