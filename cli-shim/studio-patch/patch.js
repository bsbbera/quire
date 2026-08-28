/* Quire patch for InkOS Studio — translation only.
 *
 * Studio hardcodes ~415 Chinese strings outside its own i18n table, so no
 * language switch can reach them. This walks the rendered DOM and replaces
 * them. It is a stopgap: the fix is `tr("中文", "English")` at each call site,
 * the idiom the rest of the codebase already uses, and every string moved
 * there can be deleted from the table below.
 *
 * Resizable panels, the progress panel and the Quire palette used to live here
 * too, hacked onto the rendered DOM because Studio shipped as a minified
 * bundle. It does not any more — the fork builds from source in vendor/studio —
 * so those three are components and a stylesheet in packages/studio now:
 * hooks/use-resizable.ts, components/ProgressPanel.tsx, src/index.css.
 *
 * studio.mjs re-injects this on every launch, so an `inkos update` that
 * replaces the bundle does not silently drop the patch.
 */
(() => {
  "use strict";
  if (window.__quirePatched) return;
  window.__quirePatched = true;

  /* =======================================================================
     1. Translation
     ===================================================================== */

  // Patterns first: these carry runtime values, so the rendered text never
  // matches a fixed string.
  const RULES = [
    [/^第\s*(\d+)\s*章$/, "Chapter $1"],
    [/^第(\d+)章$/, "Chapter $1"],
    [/^第\s*(\d+)\s*幕$/, "Act $1"],
    [/^第\s*(\d+)\s*幕\s*取得$/, "acquired in act $1"],
    [/^第\s*(\d+)\s*幕配图$/, "Act $1 illustration"],
    [/^第\s*(\d+)\s*章修订$/, "Chapter $1 revision"],
    [/^第\s*(\d+)\s*章状态已同步$/, "Chapter $1 state synced"],
    [/^第\s*(\d+)\s*章状态已修复$/, "Chapter $1 state repaired"],
    [/^基于第\s*(\d+)\s*章$/, "based on chapter $1"],
    [/^(\d+)\s*字$/, "$1 chars"],
    [/^(\d+)\s*张卡片$/, "$1 cards"],
    [/^(\d+)\s*个文件操作$/, "$1 file operations"],
    [/^(\d+)\s*条候选分支$/, "$1 candidate branches"],
    [/^推演未来约\s*(\d+)\s*章$/, "projects ~$1 chapters ahead"],
    [/^个\s*BM25\s*候选$/, "BM25 candidates"],
    [/^长度\s*(\d+):\s*(\d+)\s*条$/, "length $1: $2 paths"],
    [/^仅显示前\s*(\d+)\s*条路径$/, "showing first $1 paths only"],
    [/^路径过多，仅统计前\s*(\d+)\s*条$/, "too many paths — counting first $1 only"],
    [/^连接成功，(\d+)\s*个模型$/, "Connected — $1 models"],
    [/^模型目录（(\d+)）$/, "Model catalogue ($1)"],
    [/^移除模型\s*(.+)$/, "Remove model $1"],
    [/^移除\s*(.+)$/, "Remove $1"],
    [/^删除\s*(.+)$/, "Delete $1"],
    [/^已上传：(.*)$/, "Uploaded: $1"],
    [/^已创建翻译项目：(.*)$/, "Translation project created: $1"],
    [/^配图失败：(.*)$/, "Illustration failed: $1"],
    [/^保存失败：(.*)$/, "Save failed: $1"],
    [/^加载失败：(.*)$/, "Load failed: $1"],
    [/^封面未生成：(.*)$/, "Cover not generated: $1"],
    [/^节点缺失：(.*)$/, "Missing node: $1"],
    [/^报告：(.*)$/, "Report: $1"],
    [/^核心：(.*)$/, "Core: $1"],
    [/^主题：(.*)$/, "Theme: $1"],
    [/^题材：(.*)$/, "Genre: $1"],
    [/^已解锁结局\s*(.*)$/, "Ending unlocked $1"],
  ];

  // Exact strings. Longest-first replacement happens below, so substrings of
  // other entries are safe to list.
  const DICT = {
    // --- status / generic ---
    "连接失败": "Connection failed", "自动配图": "Auto-illustrate",
    "自定义服务": "Custom service", "请先填写 Base URL": "Enter a Base URL first",
    "自动识别": "Auto-detect", "对话": "Chat", "世界锚点": "World anchors",
    "流程图": "Flow chart", "树": "Tree", "主要角色": "Main characters",
    "试玩": "Play test", "章节": "Chapters", "审稿通过": "Review passed",
    "世界契约": "World contract", "视觉契约": "Visual contract",
    "关闭": "Close", "返回": "Back", "世界时间": "World time",
    "互动世界": "Interactive world", "格式无效": "Invalid format",
    "部分外部 Skill 未加载": "Some external skills did not load",
    "添加 Skill": "Add skill", "上传图片或资料": "Upload images or documents",
    "读取配置来源失败": "Could not read the config source",
    "服务商管理": "Manage providers", "请先输入 API Key": "Enter an API key first",
    "中文（简体）": "Chinese (Simplified)", "中文（繁体）": "Chinese (Traditional)",
    "其他": "Other", "玄幻": "Xuanhuan", "都市": "Urban", "仙侠": "Xianxia",
    "恐怖": "Horror", "通用": "General",
    "关键结果": "Key results", "目标": "Goal", "故事基石": "Story foundation",
    "卷纲规划": "Volume plan", "核心": "Core", "世界观": "Worldbuilding",
    "角色": "Characters", "标签": "Tags", "当前": "Current",

    // --- export / interactive film ---
    "导出 / 交付": "Export / deliver", "导出 JSON": "Export JSON",
    "导出 Ink": "Export Ink", "导出可玩网页（HTML）": "Export playable web page (HTML)",
    "暂无世界锚点。请先切换到「对话」，请 AI 帮您设定世界观和角色。":
      "No world anchors yet. Switch to Chat and ask the AI to set up the world and characters.",
    "故事核心": "Story core", "主题": "Theme", "题材": "Genre",
    "时长": "Duration", "分钟": "minutes", "世界规则": "World rules",
    "规模配置（P2 功能）— 在此设定节点数量目标、分支深度、多结局数量等参数。":
      "Scale settings (P2) — node count target, branch depth, number of endings.",
    "互动影游": "Interactive film", "新选项": "New option", "新节点": "New node",
    "完成编辑": "Done editing", "编辑": "Edit", "加节点": "Add node",
    "总节点": "Total nodes", "分支": "Branches", "结局": "Endings",
    "死路": "Dead ends", "默认": "Default", "结局边": "Ending edges",
    "悬停路径": "Hover path", "文言": "Prose", "连续性": "Continuity",
    "因果": "Causality", "人物": "Characters", "未发现硬风险": "No hard risks found",
    "意图": "Intent",

    // --- forecast / branches ---
    "人物决定、变化与不确定性": "Character decisions, changes and uncertainty",
    "人物决定": "Character decisions", "人物变化": "Character changes",
    "关系变化": "Relationship changes", "世界变化": "World changes",
    "伏笔变化": "Foreshadowing changes", "不确定性": "Uncertainty",
    "过期推演不可采用": "Stale forecast cannot be adopted",
    "采用此分支": "Adopt this branch", "候选分支已保存": "Candidate branch saved",
    "已写入候选计划；正文、大纲和正史状态没有修改。":
      "written to the candidate plan; prose, outline and canon are unchanged.",
    "该推演基于旧正史，请核验后再继续写作。":
      "This forecast is based on outdated canon — verify before writing on.",
    "剧情多线推演": "Multi-branch forecast", "非正史规划": "Non-canon planning",
    "正史已变化": "Canon has changed", "重新核验": "Re-verify",
    "正史输入已在生成后变化。请重新推演，不要继续采用旧分支。":
      "Canon changed after generation. Re-run the forecast instead of adopting the old branch.",

    // --- pipeline ---
    "执行中": "Running", "执行中…": "Running…", "处理结果": "Result",
    "思考中": "Thinking", "思考中...": "Thinking...", "专业 Skill": "Specialist skill",
    "本轮参考依据": "Context used this round", "预算": "Budget",
    "检索": "Retrieval", "语义压缩": "Semantic compression",
    "完整来源": "Full sources", "建议": "Suggestions",
    "章节修订": "Chapter revision", "仍需复核": "Still needs review",
    "保留原稿": "Keep original", "已处理": "Handled",
    "剩余审稿问题": "Remaining review issues", "章节状态已同步": "Chapter state synced",
    "仍需修订": "Still needs revision", "审稿问题": "Review issues",
    "规格": "Spec", "剧情图谱": "Story graph", "变量旗标": "Variable flags",
    "剧本": "Script", "分镜": "Storyboard", "图像提示词": "Image prompt",
    "图片资产": "Image assets", "剧本已生成": "Script generated",
    "分镜已生成": "Storyboard generated", "互动影游已生成": "Interactive film generated",
    "打开创作向导 →": "Open the creation wizard →", "短篇封面": "Short-story cover",
    "本幕配图": "Act illustration",

    // --- interactive play ---
    "确认执行": "Confirm", "已执行": "Done", "已取消": "Cancelled",
    "继续执行": "Continue", "互动世界已启动": "Interactive world started",
    "互动回合已重做": "Turn redone", "已切换互动回合版本": "Switched turn version",
    "互动世界已推进": "World advanced", "世界前提": "World premise",
    "互动世界设定已更新": "World settings updated",
    "已写入当前世界。": "Written to the current world.",
    "查看操作结果": "View operation results", "关闭生成物预览": "Close artifact preview",
    "生成物": "Artifacts", "正在读取生成物...": "Loading artifacts...",
    "没有可预览内容。": "Nothing to preview.",
    "物件": "Objects", "证据": "Evidence", "线索": "Clues", "主张": "Claims",
    "证据链": "Evidence chain", "未知": "Unknown", "有线索": "Has clue",
    "已看见": "Seen", "已收集": "Collected", "已验证": "Verified",
    "武器化": "Weaponised", "已揭露": "Revealed", "已耗尽": "Exhausted",
    "新": "New", "关系网": "Relationships", "刚获得": "Just acquired",
    "属性": "Attributes", "牵动": "Affects", "关系": "Relations",
    "因为": "because", "经过": "via", "同步": "Sync", "幕": "Act",
    "尚未开始": "Not started", "互动模式": "Interactive mode",
    "开放模式": "Open mode", "收起": "Collapse", "我面对的": "In front of me",
    "周围还没有出现地点或人物": "No places or characters have appeared yet",
    "我握有的": "What I hold",
    "还没有获得物品、证据或线索": "No items, evidence or clues yet",
    "还没有出现数值（压力、资源、关系、倒计时等）":
      "No stats yet (pressure, resources, relationships, timers…)",
    "这个世界还在沉睡": "This world is still asleep",
    "在左边写下你的第一个动作，人物、线索、状态会在这里逐渐点亮。":
      "Write your first action on the left — characters, clues and state light up here.",
    "推进中…": "Advancing…", "等待场景给出选项…": "Waiting for the scene to offer options…",

    // --- skills / models ---
    "选择 Agent Skill": "Choose an agent skill",
    "Agent 会按当前意图自主调用；点选 Skill 可强制它随下一条消息启用。":
      "The agent calls skills on its own; picking one forces it on for the next message.",
    "加载 Skill...": "Loading skills...", "还没有可用 Skill。": "No skills available yet.",
    "选择模型": "Choose a model", "搜索模型...": "Search models...",
    "无匹配模型": "No matching models", "管理服务商": "Manage providers",
    "加载模型...": "Loading models...", "配置模型 →": "Configure models →",
    "重试上一条消息": "Retry last message", "停止当前回复": "Stop this reply",
    "告诉我你想写什么——题材、世界观、主角、核心冲突":
      "Tell me what you want to write — genre, world, protagonist, core conflict",
    "选个玩法，进去再聊你想玩的世界。": "Pick a mode, then describe the world you want.",
    "点着玩": "Click to play", "GM 给选项，点着推进": "The GM offers options; click to advance",
    "自由玩": "Free play", "自己打字，想干嘛干嘛": "Type anything you like",
    "查看世界：持有 / 状态 / 关系": "View world: inventory / state / relationships",
    "查看世界": "View world",
    "先在「模型配置」里配好生图 API 才能开启":
      "Configure an image API under Model Config first",
    "为角色配图": "Illustrate character", "为时刻配图": "Illustrate moment",
    "为背包配图": "Illustrate inventory", "未检测到生图 API。": "No image API detected.",

    // --- rewrite / revise prompts ---
    "可选：输入这次重写要遵循的补充想法。留空则沿用现有 focus。":
      "Optional: extra direction for this rewrite. Leave blank to keep the current focus.",
    "可选：输入这次修订要遵循的补充想法。留空则沿用现有 focus。":
      "Optional: extra direction for this revision. Leave blank to keep the current focus.",
    "可选：输入这次同步时要遵循的补充说明。留空则直接按正文同步。":
      "Optional: extra direction for this sync. Leave blank to sync straight from the prose.",
    "输入重修基础设定的反馈。此操作会重写基础设定，不直接改正文。":
      "Feedback for reworking the foundation. This rewrites the foundation, not the prose.",
    "基础设定已重修。": "Foundation reworked.",
    "可选：下一章规划补充说明。": "Optional: extra notes for planning the next chapter.",
    "可选：下一章组装补充说明。": "Optional: extra notes for composing the next chapter.",
    "手动审查：写完即停，由你点 审稿/修订/通过（更快、更可控）。点此切回自动。":
      "Manual review: stops after writing; you click review / revise / approve. Click to switch to automatic.",
    "自动审查：写完自动审校并按需重写（更省心，但更慢）。点此切到手动·写完即停。":
      "Automatic review: audits and rewrites on its own (easier, slower). Click to switch to manual.",
    "审查：手动·写完即停": "Review: manual — stop after writing",
    "审查：自动": "Review: automatic",
    "根据已编辑章节同步 truth/state": "Sync truth/state from edited chapters",

    // --- config ---
    "配置入口": "Configuration", "切换配置来源失败": "Could not switch config source",
    "导入环境变量配置失败": "Could not import environment config",
    "正在读取配置来源…": "Reading config source…", "项目 .env": "Project .env",
    "LLM 配置来源": "LLM config source", "Studio 运行时：": "Studio runtime:",
    "使用服务页配置和 Studio 密钥": "Uses the services page config and Studio secrets",
    "切换中…": "Switching…", "使用 Studio 配置": "Use Studio config",
    "导入中…": "Importing…", "导入检测到的配置": "Import detected config",
    "检测到 LLM 环境变量覆盖：": "LLM environment override detected:",
    "已检测到但未定位来源": "Detected but source not located",
    "已设置": "Set", "未设置": "Not set", "未配置": "Not configured",
    "读取封面配置失败": "Could not read cover config",
    "封面配置已保存": "Cover config saved",
    "保存封面配置失败": "Could not save cover config",
    "封面生成": "Cover generation",
    "只配置封面通道和模型；封面尺寸由短篇封面提示词和内部默认处理。":
      "Sets the cover channel and model only; size comes from the cover prompt and internal defaults.",
    "已有密钥": "Key stored", "服务": "Service", "封面模型": "Cover model",
    "留空使用该服务的默认地址；自定义地址会作为封面生成 API 根路径。":
      "Blank uses the service default; a custom URL becomes the cover API root.",
    "保存封面配置": "Save cover config", "搜索服务商": "Search providers",
    "清空搜索": "Clear search", "全部": "All", "清除筛选": "Clear filters",
    "只看已连接": "Connected only", "没有匹配的服务商": "No matching providers",
    "删除失败": "Delete failed", "保存失败": "Save failed",
    "返回服务商管理": "Back to provider management", "服务名称": "Service name",
    "例如：本地 Ollama": "e.g. local Ollama", "API Key（可选）": "API key (optional)",
    "本地服务可留空": "Leave blank for local services", "测试连接": "Test connection",
    "删除配置": "Delete config", "流式": "Streaming", "非流式": "Non-streaming",
    "协议类型": "Protocol", "流式响应": "Streaming responses", "开启": "On",
    "输入模型 ID，例如 gemini-3.1-pro": "Enter a model ID, e.g. gemini-3.1-pro",
    "添加": "Add",
    "测试连接发现的模型和手动添加的模型都会在保存后持久化；内置目录只作为兜底。":
      "Models found by testing and models added by hand persist after saving; the built-in catalogue is only a fallback.",
    "点击“测试连接”查看可用模型": "Click Test connection to list available models",
    "高级参数": "Advanced parameters", "飞书 Feishu": "Feishu", "企业微信": "WeCom",

    // --- skills / prompts pages ---
    "Skill 文件夹已导入": "Skill folder imported", "导入外部 Skill": "Import external skill",
    "选择 Skill 文件夹": "Choose a skill folder", "还没有 Skill。": "No skills yet.",
    "无说明": "No description", "Skill 已删除": "Skill deleted",
    "提示词": "Prompts",
    "集中查看和调整内置提示词。修改会保存为项目级覆盖文件，不会改动内置默认值。":
      "Review and adjust the built-in prompts. Edits save as project-level overrides; the defaults are untouched.",
    "没有可编辑提示词。": "No editable prompts.", "已改": "Modified",
    "当前来源": "Current source", "提示词已恢复默认": "Prompt reset to default",
    "恢复默认": "Reset to default", "提示词已保存": "Prompt saved",
    "查看内置默认": "View built-in default",
    "选择左侧提示词后编辑。": "Pick a prompt on the left to edit it.",
    "联网研究搜索服务": "Web research search service",
    "启用项目级搜索配置": "Enable project-level search config",
    "搜索服务": "Search service",
    "Base URL（可选，自定义兼容端点）": "Base URL (optional, custom compatible endpoint)",
    "API Key（可选；留空则读环境变量）": "API key (optional; blank reads the env var)",
    "可直接填 key，或只填环境变量名": "Enter the key itself, or just the env var name",
    "secret (可选)": "secret (optional)",
    "兼容层只读 / Read-only compat shim": "Read-only compat shim",
    "本文件已废弃，仅供外部读取。权威来源：":
      "This file is deprecated and read-only. Authoritative source:",
    "运行时诊断文件 / Runtime diagnostic": "Runtime diagnostic",

    // --- languages ---
    "英语": "English", "日语": "Japanese", "韩语": "Korean", "法语": "French",
    "德语": "German", "西班牙语": "Spanish", "葡萄牙语": "Portuguese",
    "俄语": "Russian", "阿拉伯语": "Arabic", "印尼语": "Indonesian",
    "越南语": "Vietnamese", "泰语": "Thai", "意大利语": "Italian",
    "土耳其语": "Turkish",

    // --- import / fanfic / play ---
    "母本导入成功": "Source text imported", "已有书籍": "Existing books",
    "上传外部母本": "Upload an external source text",
    "选择 TXT、Markdown 或 PDF 文件": "Choose a TXT, Markdown or PDF file",
    "架空 AU": "AU", "性格偏离 OOC": "OOC", "配对 CP": "Pairing",
    "开始游玩": "Start playing", "重新开始": "Restart", "此路不通": "Dead end",
    "（有阻断问题）": "(blocked)", "无问题": "No issues", "情感曲线": "Emotion curve",
    "暂无可分析路径": "No paths to analyse", "情感曲线图": "Emotion curve chart",
    "无结局": "No ending", "（路径总数已超过枚举上限）": "(total paths exceed the enumeration limit)",
    "路径分布": "Path distribution", "暂无路径数据": "No path data",
    "路径长度分布": "Path length distribution",
    "正在加载分析结果…": "Loading analysis…", "暂无分析数据": "No analysis data",

    // --- dashboard / book view ---
    "AI 对话创作": "AI chat writing", "导出整包": "Export full package",
    "保存中…": "Saving…", "生成中…": "Generating…", "生成配图": "Generate illustration",
    "中文创作": "Chinese writing",
    "玄幻 · 仙侠 · 都市 · 恐怖 · 通用": "Xuanhuan · Xianxia · Urban · Horror · General",
    "番茄小说 · 起点中文网 · 飞卢": "Fanqie · Qidian · Feilu",
    "可在设置中更改 · Can be changed in Settings": "Can be changed in Settings",
    "执行": "Run", "主角": "Protagonist", "时代背景": "Setting / era",
    "红线": "Red lines", "同人模式": "Fanfic mode",
    "各卷目标与关键节点": "Volume goals and key beats",
    "当前状态": "Current state", "伏笔池": "Foreshadowing pool",
    "情感弧线": "Emotional arc", "支线进度": "Subplot progress",
    "世界观设定": "World settings", "叙事规则": "Narrative rules",
    "类型": "Type", "回收卷": "Payoff volume", "升级": "Upgrade",
    "备注": "Notes", "是": "Yes", "核心文件": "Core files",
    "查看完整设定 →": "View full settings →", "暂无章节": "No chapters yet",
    "定位": "Positioning", "还没有埋下伏笔。": "No foreshadowing planted yet.",
    "种子": "Seed", "活跃": "Active", "回收": "Payoff",
    "还没有运行状态。开始写作后，每写完一章这里会自动记录最新的故事进展。":
      "No runtime state yet. Once writing starts, each finished chapter records its progress here.",
    "还没有情感弧线记录。开始写作后，这里会记录角色在各章的情绪变化。":
      "No emotional arc yet. Once writing starts, character emotion per chapter is recorded here.",
    "文件不存在": "File not found", "正在写作中...": "Writing...",
    "正在审计中...": "Auditing...", "正在修订中...": "Revising...",
    "书籍信息": "Book info",
    "无法加载项目配置 / Failed to load project config": "Failed to load project config",
    "重试 / Retry": "Retry",
    "加载创作向导…": "Loading creation wizard…", "加载流程图…": "Loading flow chart…",

    // --- engine diagnostics (inkos-core, not Studio) ---
    "无法连接到 API Service。可能原因：": "Cannot reach the API service. Possible causes:",
    "可能原因：": "Possible causes:",
    "地址不正确": "address is wrong",
    "网络不通或被防火墙拦截": "network unreachable or blocked by a firewall",
    "暂时不可用": "temporarily unavailable",
    "是否包含完整路径": "includes the full path",
    "请求超时": "Request timed out",
    "认证失败": "Authentication failed",
    "请检查": "Check",
    "重试中": "Retrying",
    "Studio 运行时不会使用 env 中的 INKOS_LLM_* 配置；请在服务配置页保存 Studio 配置。":
      "The Studio runtime ignores INKOS_LLM_* from the environment — save the config on the services page instead.",
    "检测到旧顶层 LLM 配置；Studio 模式以选中的 service/defaultModel/secrets 为准。":
      "Legacy top-level LLM config detected; Studio uses the selected service / defaultModel / secrets.",
  };

  // A short entry must only match a whole label. Replacing them inside longer
  // text corrupts real words — 是 ("yes") sits inside 是否 ("whether"), and
  // substring-replacing it produced "Yes否".
  const MIN_SUBSTRING = 4;
  // Longest first, so a long phrase is never chopped up by one of its own
  // substrings.
  const SUBSTR_KEYS = Object.keys(DICT)
    .filter((k) => k.length >= MIN_SUBSTRING)
    .sort((a, b) => b.length - a.length);
  const HAS_CJK = /[一-鿿]/;

  function translate(text) {
    if (!text || !HAS_CJK.test(text)) return text;
    const trimmed = text.trim();

    // 1. whole-label match — the only way short entries are ever applied
    if (DICT[trimmed]) return text.replace(trimmed, DICT[trimmed]);
    for (const [re, to] of RULES) {
      if (re.test(trimmed)) return text.replace(trimmed, trimmed.replace(re, to));
    }

    // 2. inline replacement, long entries only
    let out = text;
    for (const k of SUBSTR_KEYS) if (out.includes(k)) out = out.split(k).join(DICT[k]);

    // 3. Engine sentences often come back part-translated. Normalising the
    // full-width punctuation left behind makes those read as English rather
    // than as a mangled mix.
    if (out !== text) {
      out = out
        .replace(/（/g, " (").replace(/）/g, ")")
        .replace(/：/g, ": ").replace(/，/g, ", ")
        .replace(/。/g, ". ").replace(/、/g, ", ")
        .replace(/ {2,}/g, " ");
    }
    return out;
  }

  const ATTRS = ["title", "placeholder", "aria-label"];
  // Never rewrite what the user is editing or what the model wrote — only chrome.
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"]);

  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      const t = translate(root.textContent);
      if (t !== root.textContent) root.textContent = t;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (SKIP.has(root.tagName)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        SKIP.has(n.parentElement?.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const hits = [];
    let n;
    while ((n = walker.nextNode())) if (HAS_CJK.test(n.textContent)) hits.push(n);
    for (const node of hits) {
      const t = translate(node.textContent);
      if (t !== node.textContent) node.textContent = t;
    }
    const els = root.querySelectorAll ? [root, ...root.querySelectorAll("*")] : [root];
    for (const el of els) {
      for (const a of ATTRS) {
        const v = el.getAttribute?.(a);
        if (v && HAS_CJK.test(v)) {
          const t = translate(v);
          if (t !== v) el.setAttribute(a, t);
        }
      }
    }
  }

  /* =======================================================================
     boot
     ===================================================================== */

  function start() {
    translateTree(document.body);

    // Studio is a SPA: everything above has to survive re-renders.
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) translateTree(node);
        if (r.type === "characterData" && r.target.nodeType === Node.TEXT_NODE) {
          const t = translate(r.target.textContent);
          if (t !== r.target.textContent) r.target.textContent = t;
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
