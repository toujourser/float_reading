# Linux.do 浮窗阅读 (Float Reading)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Enabled-green.svg)](https://www.tampermonkey.net/)

一个为 [Linux.do](https://linux.do/) 论坛打造的增强脚本，旨在提供更流畅、现代的阅读体验。通过模态框（浮窗）形式直接查看帖子，支持深度嵌套评论，让讨论脉络一目了然。

## ✨ 核心特性

- **🚀 浮窗阅读**: 无需离开当前列表页，点击标题即可在优雅的模态框中阅读全文。
- **🌲 树状评论**: 支持无限层级的嵌套评论，采用类似 Reddit/HN 的紧凑风格，轻松追踪对话分支。
- **⚡ 极速响应**:
  - **骨架屏加载**: 消除加载时的突兀感。
  - **LRU 缓存**: 自动存储已访问的主题，缩短二次打开时间。
  - **无限滚动**: 评论区支持流式加载，大数据量下依然丝滑。
- **🎨 现代 UI**: 基于 Vanilla CSS 打造的精致界面，支持毛玻璃效果与动态微动画。
- **🛠️ 快捷功能**: 底部集成了点赞、评论、收藏、分享等快捷操作栏。
- **🖼️ 图片预览**: 内置 Lightbox 效果，点击图片即可全屏查看，体验更佳。

## 📦 安装方法

1. **安装环境**: 确保你的浏览器已安装 [Tampermonkey](https://www.tampermonkey.net/) 插件。
2. **获取脚本**:
   - 方式一：克隆本仓库并手动添加 `linuxdo.user.js` 到 Tampermonkey。
   - 方式二（推荐）：待发布至 Greasy Fork 后直接点击安装[greasyfork](https://greasyfork.org/zh-CN/scripts/565692-linux-do-%E6%B5%AE%E7%AA%97%E9%98%85%E8%AF%BB)。
3. **刷新页面**: 打开 [Linux.do](https://linux.do/) 即可自动生效。

## 💡 使用说明

- **触发方式**: 在论坛列表页，点击任意帖子标题即可弹出阅读浮窗。
- **快捷键**: 点击模态框外部或右上角关闭按钮，或者按 `ESC` 键即可退出。
- **评论互动**: 
  - 每一个评论下方都有快捷回复按钮，点击直接调用论坛原生编辑器。
  - 实时显示回复结果，无需全页刷新。

## 🛠️ 技术实现

本脚本采用原生 JavaScript (ES6+) 开发，不依赖大型框架，确保极轻的性能开销。

- **状态管理**: 简单高效的内存对象管理。
- **DOM 优化**: 使用 `DocumentFragment` 批量渲染，减少重排。
- **缓存策略**: 自定义 `Map` 实现的带过期机制的缓存系统。

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request 来改进此工程！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 协议。
