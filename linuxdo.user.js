// ==UserScript==
// @name         Linux.do 浮窗阅读
// @namespace    DCSF
// @version      0.1.6
// @license      MIT
// @description  在 Linux.do 论坛中以模态框形式查看帖子，并支持树状嵌套评论、现代卡片风格及底部快捷操作栏
// @author       You
// @match        https://linux.do/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linux.do
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. Config & Styles
    // ==========================================
    const CONFIG = {
        themeColor: '#3b82f6',
        indentSize: 24, // px
        maxDepth: 5,
        loadingText: 'Loading Topic...',
        avatars: {
            op: 48,
            level1: 40,
            level2: 32
        },
        // 性能优化相关配置
        cacheExpiry: 5 * 60 * 1000,     // 缓存 5 分钟
        postsPerBatch: 200,              // 每批次加载的帖子数
        initialRenderLimit: 50,          // 首次渲染的评论数
        renderBatchSize: 30,             // 每批渲染的评论数
        commentsDisplayLimit: 100,       // 初始显示的评论数限制
        // 【新增】分页加载配置
        initialPagesToLoad: 3,           // 默认预加载的页数
        postsPerPage: 20,                // 每页帖子数（Discourse 默认）
        infiniteScrollThreshold: 300,    // 触发加载下一页的距离（px）
        maxCacheSize: 20,                // 缓存最大条数（LRU 驱逐）
    };

    // 缓存管理 - 用于存储已加载的帖子数据，避免重复请求
    const topicCache = new Map(); // topicId -> { data, allPosts, timestamp }

    const STYLES = `
        /* Modal Overlay */
        .ld-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 9999;
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.2s ease;
            font-family: var(--font-family, sans-serif);
        }
        .ld-modal-overlay.open {
            opacity: 1;
        }

        /* Modal Container */
        .ld-modal-container {
            background: var(--secondary, #fff);
            color: var(--primary, #000);
            width: 90%;
            max-width: 1000px;
            height: 90vh;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transform: scale(0.95);
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            border: 1px solid var(--primary-low, #ccc);
        }
        .ld-modal-overlay.open .ld-modal-container {
            transform: scale(1);
        }

        /* Header */
        .ld-modal-header {
            padding: 16px 24px;
            border-bottom: 1px solid var(--primary-low, #eee);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--header_background, #fff);
            flex-shrink: 0;
        }
        .ld-modal-title {
            font-size: 1.25rem;
            font-weight: 700;
            margin: 0;
            color: var(--primary, #333);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }
        .ld-modal-close {
            background: transparent;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--primary-medium, #666);
            padding: 4px;
            margin-left: 16px;
            line-height: 1;
            transition: color 0.2s;
        }
        .ld-modal-close:hover {
            color: var(--primary, #000);
        }

        /* Content Area */
        .ld-modal-content {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
            scroll-behavior: smooth;
            overscroll-behavior: contain; /* 阻止滚动穿透到背景页 */
        }

        /* Footer Action Bar */
        .ld-modal-footer {
            padding: 12px 24px;
            border-top: 1px solid var(--primary-low, #eee);
            background: var(--secondary, #fff);
            display: flex;
            justify-content: space-around; /* Distribute evenly or use flex-start/end */
            align-items: center;
            flex-shrink: 0;
            z-index: 10;
        }
        .ld-footer-btn {
            background: transparent;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.95rem;
            color: var(--primary-medium, #666);
            padding: 8px 16px;
            border-radius: 6px;
            transition: all 0.2s ease;
            font-weight: 600;
        }
        .ld-footer-btn:hover {
            background: var(--primary-low, #f0f0f0);
            color: var(--tertiary, #3b82f6);
        }
        .ld-footer-btn svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        /* Original Post (OP) */
        .ld-topic-op {
            margin-bottom: 32px;
            padding-bottom: 24px;
            border-bottom: 2px solid var(--primary-low, #eee);
        }
        .ld-post-header {
            display: flex;
            align-items: center;
            margin-bottom: 16px;
        }
        .ld-avatar {
            border-radius: 50%;
            margin-right: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .ld-avatar-op { width: ${CONFIG.avatars.op}px; height: ${CONFIG.avatars.op}px; }
        
        .ld-user-info {
            display: flex;
            flex-direction: column;
        }
        .ld-username {
            font-weight: 700;
            font-size: 1.1rem;
            color: var(--primary, #333);
        }
        .ld-time {
            font-size: 0.85rem;
            color: var(--primary-medium, #888);
            margin-top: 2px;
        }
        .ld-cook {
             /* Basic discourse cooked content styles fix */
             line-height: 1.7;
             font-size: 1.05rem;
             color: var(--primary, #222);
        }
        .ld-cook img {
            max-width: 100%;
            height: auto;
            border-radius: 6px;
        }
        .ld-cook blockquote {
            border-left: 5px solid var(--primary-low-mid, #e9e9e9);
            background: var(--primary-very-low, #f9f9f9);
            padding: 8px 12px;
            margin: 1em 0;
            color: var(--primary-medium, #666);
        }

        /* Threaded Comments - 紧凑线程风格 (Reddit/HN style) */
        .ld-comment-tree {
            margin-top: 16px;
        }
        
        /* 评论项 - 移除卡片效果，使用紧凑布局 */
        .ld-comment-item {
            position: relative;
            padding: 12px 0;
            /* 使用细分割线而非卡片边框 */
            border-bottom: 1px solid var(--primary-very-low, rgba(255,255,255,0.06));
        }
        .ld-comment-item:last-child {
            border-bottom: none;
        }
        
        /* 评论内容区 - 无背景、无边框、无阴影 */
        .ld-comment-inner {
            padding: 0;
            background: transparent;
            border: none;
            box-shadow: none;
            border-radius: 0;
        }
        
        /* 评论头部 - 紧凑水平排列 */
        .ld-comment-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .ld-comment-user {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }
        
        /* 头像尺寸 - 更紧凑 */
        .ld-avatar-l1 { width: 28px; height: 28px; flex-shrink: 0; }
        .ld-avatar-l2 { width: 24px; height: 24px; flex-shrink: 0; }

        /* 评论元信息 - 水平紧凑排列 */
        .ld-comment-meta {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .ld-comment-username {
            font-weight: 600;
            font-size: 0.875rem;
            color: var(--primary-high, #e0e0e0);
        }
        .ld-comment-reply-to {
            font-size: 0.75rem;
            color: var(--primary-medium, #888);
            font-weight: 400;
        }
        .ld-comment-time {
            font-size: 0.75rem;
            color: var(--primary-low-mid, #666);
        }
        /* 分隔点 */
        .ld-comment-meta-sep {
            color: var(--primary-low-mid, #555);
            font-size: 0.7rem;
        }

        /* 评论正文 - 增加行高提升阅读舒适度 */
        .ld-comment-body {
            font-size: 0.9rem;
            line-height: 1.6;
            color: var(--primary, #ccc);
            word-break: break-word;
            margin-left: 36px; /* 与头像对齐 */
        }
        .ld-comment-body img {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
            margin: 8px 0;
        }
        .ld-comment-body p {
            margin: 0 0 8px 0;
        }
        .ld-comment-body p:last-child {
            margin-bottom: 0;
        }
        
        /* 嵌套评论 - 更细更淡的连接线 */
        .ld-children {
            margin-left: 16px;
            padding-left: 12px;
            margin-top: 4px;
            /* 更细更淡的连接线 */
            border-left: 1px solid var(--primary-very-low, rgba(255,255,255,0.08));
        }
        .ld-children .ld-comment-item {
            padding: 8px 0;
        }
        .ld-children .ld-comment-body {
            margin-left: 32px; /* 嵌套评论头像更小，对齐调整 */
        }

        /* 评论操作按钮 - 紧凑排列 */
        .ld-comment-actions {
            margin-top: 6px;
            margin-left: 36px;
            display: flex;
            gap: 16px;
        }
        .ld-action-link {
            font-size: 0.75rem;
            color: var(--primary-low-mid, #666);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: color 0.15s;
            padding: 2px 0;
        }
        .ld-action-link:hover {
            color: var(--tertiary, #3b82f6);
        }
        .ld-action-link svg {
            width: 14px;
            height: 14px;
        }
        .ld-like-count {
            display: flex;
            align-items: center;
            gap: 3px;
        }
        /* 【UI优化】已有点赞的评论显示红色心形 */
        .ld-like-count.has-likes {
            color: #e74c3c;
        }
        .ld-like-count.has-likes svg {
            fill: #e74c3c;
        }
        /* 分享按钮 hover 效果 */
        .ld-share-btn:hover {
            color: var(--tertiary, #3b82f6);
        }
        
        /* 【新增】楼层号样式 - 靠右显示，带圆角底纹 */
        .ld-floor-number {
            font-size: 0.65rem;
            color: var(--primary-medium, #666);
            background-color: var(--primary-very-low, rgba(0,0,0,0.06));
            padding: 2px 6px;
            border-radius: 4px;
            margin-left: auto;
            font-weight: 500;
        }

        /* 【新增】OP 标签 - 原帖作者标识 */
        .ld-op-badge {
            display: inline-flex;
            align-items: center;
            font-size: 0.7rem;
            font-weight: 600;
            line-height: 1;
            padding: 2px 7px;
            border-radius: 9999px;
            white-space: nowrap;
            flex-shrink: 0;
            vertical-align: middle;
            /* 浅色主题默认 */
            background-color: #EFF6FF;
            color: #1D4ED8;
        }
        /* 深色主题适配：Discourse 深色模式下 --scheme-type 为 dark */
        html.dark-scheme .ld-op-badge,
        html[data-color-scheme="dark"] .ld-op-badge {
            background-color: #3B82F6;
            color: #FFFFFF;
        }
        /* 备用深色检测：通过 secondary 变量色值判断 */
        @media (prefers-color-scheme: dark) {
            .ld-op-badge {
                background-color: #3B82F6;
                color: #FFFFFF;
            }
        }
        
        /* 【新增】用户已点赞状态 */
        .ld-like-btn.user-liked {
            color: #e74c3c;
        }
        .ld-like-btn.user-liked svg {
            fill: #e74c3c;
        }
        .ld-like-btn.loading {
            opacity: 0.5;
            pointer-events: none;
        }
        .ld-like-btn:hover {
            color: #e74c3c;
        }
        
        /* 【新增】无限滚动加载指示器 */
        .ld-infinite-loader {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: var(--primary-medium, #888);
            font-size: 0.85rem;
            gap: 8px;
        }
        .ld-infinite-loader .ld-mini-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--primary-low, #ddd);
            border-top-color: var(--tertiary, #3b82f6);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        .ld-no-more-comments {
            text-align: center;
            padding: 16px;
            color: var(--primary-low-mid, #666);
            font-size: 0.85rem;
        }

        /* Loading Spinner */
        .ld-spinner {
            border: 4px solid var(--primary-low, #f3f3f3);
            border-top: 4px solid var(--tertiary, #3b82f6);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 40px auto;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .ld-loading-text {
            text-align: center;
            color: var(--primary-medium, #666);
            margin-top: 16px;
        }

        /* Utility */
        .hidden { display: none !important; }

        /* Toast 通知 - 用于显示操作反馈 */
        .ld-toast {
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: var(--primary, #333);
            color: var(--secondary, #fff);
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            z-index: 10001;
            opacity: 0;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .ld-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .ld-toast-success { background: #10b981; }
        .ld-toast-error { background: #ef4444; }
        .ld-toast-info { background: #3b82f6; }

        /* 骨架屏 - 加载时显示占位内容，提升感知速度 */
        .ld-skeleton {
            padding: 20px;
        }
        .ld-skeleton-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
        }
        .ld-skeleton-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(90deg, var(--primary-low, #e0e0e0) 25%, var(--primary-very-low, #f0f0f0) 50%, var(--primary-low, #e0e0e0) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
        }
        .ld-skeleton-user {
            margin-left: 12px;
        }
        .ld-skeleton-line {
            height: 14px;
            border-radius: 4px;
            background: linear-gradient(90deg, var(--primary-low, #e0e0e0) 25%, var(--primary-very-low, #f0f0f0) 50%, var(--primary-low, #e0e0e0) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
            margin-bottom: 8px;
        }
        .ld-skeleton-line.short { width: 60%; }
        .ld-skeleton-line.medium { width: 80%; }
        .ld-skeleton-line.long { width: 100%; }
        .ld-skeleton-content {
            margin-top: 20px;
            padding-bottom: 20px;
            border-bottom: 2px solid var(--primary-low, #eee);
        }
        .ld-skeleton-comments {
            margin-top: 20px;
        }
        .ld-skeleton-comment {
            display: flex;
            padding: 16px;
            margin-bottom: 12px;
            border-radius: 12px;
            border: 1px solid var(--primary-low, #eee);
        }
        .ld-skeleton-comment .ld-skeleton-avatar {
            width: 40px;
            height: 40px;
            flex-shrink: 0;
        }
        .ld-skeleton-comment-body {
            flex: 1;
            margin-left: 12px;
        }
        @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }

        /* 按钮激活状态 - 已点赞/已收藏 */
        .ld-footer-btn.liked {
            color: #e74c3c;
        }
        .ld-footer-btn.liked svg {
            fill: #e74c3c;
        }
        .ld-footer-btn.bookmarked {
            color: var(--tertiary, #3b82f6);
        }
        .ld-footer-btn.bookmarked svg {
            fill: var(--tertiary, #3b82f6);
        }
        .ld-footer-btn.loading {
            opacity: 0.6;
            pointer-events: none;
        }

        /* 加载更多按钮 */
        .ld-load-more {
            display: flex;
            justify-content: center;
            margin: 24px 0;
        }
        .ld-load-more-btn {
            background: var(--tertiary, #3b82f6);
            color: #fff;
            border: none;
            padding: 12px 32px;
            border-radius: 8px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .ld-load-more-btn:hover {
            background: var(--tertiary-hover, #2563eb);
            transform: translateY(-1px);
        }
        .ld-load-more-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        /* 评论计数标题 */
        .ld-comments-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--primary-low, #eee);
        }
        .ld-comments-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--primary, #333);
        }
        .ld-comments-count {
            background: var(--primary-low, #e9e9e9);
            color: var(--primary-medium, #666);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.85rem;
        }

        /* 加载进度 */
        .ld-loading-progress {
            text-align: center;
            color: var(--primary-medium, #666);
            font-size: 0.9rem;
            margin: 16px 0;
        }
        /* Lightbox - 图片全屏预览 */
        .ld-lightbox-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.9);
            z-index: 20000; /* 高于一切 */
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.3s ease;
            backdrop-filter: blur(5px);
        }
        .ld-lightbox-overlay.open {
            opacity: 1;
        }
        .ld-lightbox-img {
            max-width: 95vw;
            max-height: 95vh;
            border-radius: 4px;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
            transform: scale(0.9);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: zoom-out;
        }
        .ld-lightbox-overlay.open .ld-lightbox-img {
            transform: scale(1);
        }
        .ld-lightbox-close {
            position: absolute;
            top: 20px;
            right: 20px;
            width: 40px;
            height: 40px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
            transition: all 0.2s;
            z-index: 20001;
        }
        .ld-lightbox-close:hover {
            background: rgba(255, 255, 255, 0.4);
            transform: rotate(90deg);
        }
        .ld-lightbox-close svg {
            width: 24px;
            height: 24px;
            fill: #fff;
        }
    `;

    // Inject Styles
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    // ==========================================
    // 2. State & Helpers
    // ==========================================
    let modalOverlay, modalContainer, modalContent, modalTitle, modalFooter;
    let currentTopicData = null; // Store current topic data for footer actions
    let currentOpUsername = null; // 【OP标签】追踪当前帖子的原帖作者用户名

    // 【无限滚动状态】
    let infiniteScrollState = {
        topicId: null,
        allPostIds: [],        // 所有帖子的 ID 列表
        loadedPostIds: new Set(), // 已加载的帖子 ID
        isLoading: false,      // 是否正在加载
        hasMore: true,         // 是否还有更多帖子
        commentsContainer: null, // 评论容器引用
        scrollHandler: null,   // 滚动事件处理器引用
    };

    function formatDate(isoString) {
        // Simple relative time or full date
        const date = new Date(isoString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // SVG Icons
    // 【图标说明】
    // - like: 实心心形，用于已点赞状态
    // - likeEmpty: 空心心形，用于未点赞状态（保持视觉统一）
    // - comment: 对话气泡，用于评论数显示
    // - bookmark: 书签图标，用于收藏功能
    // - reply: 经典弯曲箭头（类似 Twitter/Reddit），比之前的图标更现代
    // - share: 分享图标（三点连接向外），用于分享帖子/评论链接
    const ICONS = {
        // 实心心形 - 已点赞
        like: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
        // 空心心形 - 未点赞（用于所有评论保持视觉统一）
        likeEmpty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
        // 对话气泡
        comment: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>',
        // 书签
        bookmark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>',
        // 经典弯曲回复箭头（类似 Twitter/Reddit 风格）- 更现代简洁
        reply: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
        // 分享图标（三点连接向外）
        share: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',
        // 新标签页打开
        newTab: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>'
    };

    // ==========================================
    // 2.1 API 工具函数 - 用于与 Discourse 后端交互
    // ==========================================

    /**
     * 获取 CSRF Token - Discourse 的 POST/PUT 请求需要此 token
     * 优先从页面 meta 标签获取，失败则尝试 Discourse 内部对象
     */
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.content;
        // Fallback: 尝试从 Discourse 内部获取
        try {
            return unsafeWindow.Discourse?.Session?.currentProp('csrfToken');
        } catch (e) {
            console.warn('Failed to get CSRF token from Discourse internals', e);
            return null;
        }
    }

    /**
     * 通用 Discourse API 请求封装
     * 自动添加 CSRF token 和必要的请求头
     */
    async function discourseApi(endpoint, options = {}) {
        const csrfToken = getCsrfToken();
        const headers = {
            'X-Requested-With': 'XMLHttpRequest',
            ...options.headers,
        };

        // 只有非 GET 请求才需要 CSRF token
        if (options.method && options.method !== 'GET') {
            headers['X-CSRF-Token'] = csrfToken;
        }

        // 如果有 body，添加 Content-Type
        if (options.body) {
            headers['Content-Type'] = 'application/json';
        }

        return fetch(endpoint, {
            ...options,
            headers,
            credentials: 'same-origin',
        });
    }

    /**
     * 点赞帖子
     * Discourse API: POST /post_actions
     * post_action_type_id: 2 = like
     * 【注意】Discourse 需要 form-urlencoded 格式，不是 JSON
     */
    async function likePost(postId) {
        try {
            const csrfToken = getCsrfToken();
            const response = await fetch('/post_actions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'same-origin',
                body: `id=${postId}&post_action_type_id=2`,
            });

            if (response.ok) {
                return { success: true };
            } else {
                const error = await response.json().catch(() => ({}));
                return { success: false, error: error.errors?.[0] || '点赞失败' };
            }
        } catch (e) {
            console.error('Like post failed:', e);
            return { success: false, error: '网络错误' };
        }
    }

    /**
     * 取消点赞
     * Discourse API: DELETE /post_actions/{post_id}?post_action_type_id=2
     * 【注意】DELETE 请求也需要 CSRF token
     */
    async function unlikePost(postId) {
        try {
            const csrfToken = getCsrfToken();
            const response = await fetch(`/post_actions/${postId}?post_action_type_id=2`, {
                method: 'DELETE',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'same-origin',
            });
            return { success: response.ok };
        } catch (e) {
            console.error('Unlike post failed:', e);
            return { success: false, error: '网络错误' };
        }
    }

    /**
     * 收藏帖子
     * Discourse API: PUT /t/{topic_id}/bookmark
     */
    async function bookmarkTopic(topicId) {
        try {
            const response = await discourseApi(`/t/${topicId}/bookmark`, {
                method: 'PUT',
            });
            return { success: response.ok };
        } catch (e) {
            console.error('Bookmark topic failed:', e);
            return { success: false, error: '网络错误' };
        }
    }

    /**
     * 取消收藏
     * Discourse API: PUT /t/{topic_id}/remove_bookmarks
     */
    async function unbookmarkTopic(topicId) {
        try {
            const response = await discourseApi(`/t/${topicId}/remove_bookmarks`, {
                method: 'PUT',
            });
            return { success: response.ok };
        } catch (e) {
            console.error('Unbookmark topic failed:', e);
            return { success: false, error: '网络错误' };
        }
    }

    // ==========================================
    // 2.2 Toast 通知 - 显示操作反馈
    // ==========================================
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `ld-toast ld-toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // 触发动画
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // 自动消失
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // ==========================================
    // 2.3 缓存管理 - 避免重复请求已加载的帖子
    // ==========================================
    function getCachedTopic(topicId) {
        const cached = topicCache.get(topicId);
        if (cached && Date.now() - cached.timestamp < CONFIG.cacheExpiry) {
            return cached;
        }
        // 缓存过期，删除
        if (cached) {
            topicCache.delete(topicId);
        }
        return null;
    }

    function setCachedTopic(topicId, data, allPosts) {
        // 【性能优化】LRU 驱逐：超过上限时移除最早的缓存
        if (topicCache.size >= CONFIG.maxCacheSize) {
            const oldestKey = topicCache.keys().next().value;
            topicCache.delete(oldestKey);
        }
        topicCache.set(topicId, {
            data,
            allPosts,
            timestamp: Date.now()
        });
    }

    // ==========================================
    // 2.35 分享功能 - 复制链接到剪贴板
    // ==========================================
    /**
     * 复制链接到剪贴板
     * @param {string} url 要复制的链接
     * @param {string} type 类型（用于提示）: 'topic' 或 'comment'
     */
    async function copyToClipboard(url, type = 'topic') {
        try {
            await navigator.clipboard.writeText(url);
            showToast(`${type === 'topic' ? '帖子' : '评论'}链接已复制`, 'success');
        } catch (e) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = url;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showToast(`${type === 'topic' ? '帖子' : '评论'}链接已复制`, 'success');
            } catch (err) {
                showToast('复制失败，请手动复制', 'error');
            }
            document.body.removeChild(textArea);
        }
    }

    /**
     * 生成评论的直链
     * @param {number} topicId 帖子 ID
     * @param {number} postNumber 评论楼层号
     */
    function getCommentUrl(topicId, postNumber) {
        return `https://linux.do/t/topic/${topicId}/${postNumber}`;
    }
    // ==========================================
    // 2.4 骨架屏 - 更接近真实布局的紧凑样式
    // ==========================================
    function showSkeleton() {
        // 【性能优化】骨架屏更接近真实内容布局，减少布局抖动
        modalContent.innerHTML = `
            <div class="ld-skeleton">
                <!-- OP 骨架 -->
                <div class="ld-skeleton-header">
                    <div class="ld-skeleton-avatar" style="width:48px;height:48px;"></div>
                    <div class="ld-skeleton-user">
                        <div class="ld-skeleton-line" style="width:100px;height:14px;"></div>
                        <div class="ld-skeleton-line" style="width:60px;height:10px;margin-top:4px;"></div>
                    </div>
                </div>
                <div class="ld-skeleton-content" style="margin-top:16px;">
                    <div class="ld-skeleton-line" style="width:100%;"></div>
                    <div class="ld-skeleton-line" style="width:90%;"></div>
                    <div class="ld-skeleton-line" style="width:75%;"></div>
                </div>
                <!-- 评论区骨架 - 紧凑线程风格 -->
                <div class="ld-skeleton-comments" style="margin-top:24px;">
                    ${Array(8).fill(`
                        <div class="ld-skeleton-comment" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <div class="ld-skeleton-avatar" style="width:28px;height:28px;"></div>
                                <div class="ld-skeleton-line" style="width:80px;height:12px;"></div>
                                <div class="ld-skeleton-line" style="width:50px;height:10px;"></div>
                            </div>
                            <div style="margin-left:36px;margin-top:6px;">
                                <div class="ld-skeleton-line" style="width:85%;"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ==========================================
    // 2.5 Router Interceptor - 防止评论后跳转
    // ==========================================
    /**
     * 拦截 Discourse 路由跳转
     * 当模态框打开时，阻止跳转到当前帖子页面
     */
    function installRouterInterceptor() {
        // Force re-installation for debugging
        unsafeWindow.DiscourseRouterInterceptorInstalled = true;

        try {
            const container = unsafeWindow.Discourse.__container__;
            const router = container.lookup('router:main');

            if (!router) {
                console.error('[Linux.do Modal] Router not found during interceptor installation');
                return;
            }

            // Avoid double patching if already patched by this specific logic
            if (router.transitionTo && router.transitionTo.isPatchedByLinuxDo) {
                console.log('[Linux.do Modal] Router interceptor already active');
                return;
            }

            const originalTransitionTo = router.transitionTo;
            const originalReplaceWith = router.replaceWith;
            const originalReplaceRoute = router.replaceRoute || router.replaceWith;

            /**
             * 检查 URL 是否指向当前帖子
             * @param {string} url URL 路径
             * @returns {boolean} 是否是当前帖子
             */
            const isCurrentTopicUrl = (url) => {
                if (!currentTopicData || !url) return false;
                // 匹配 /t/{slug}/{id} 或 /t/topic/{id} 或 /t/{any}/{id}/{postNumber}
                const topicIdStr = String(currentTopicData.id);
                // 正则匹配帖子 URL 中的 ID
                const match = url.match(/\/t\/[^\/]+\/(\d+)/);
                if (match && match[1] === topicIdStr) {
                    return true;
                }
                return false;
            };

            /**
             * 通用拦截逻辑
             */
            const interceptNavigation = function (originalMethod, methodName, ...args) {
                // 检查模态框是否打开
                const isModalOpen = modalOverlay && modalOverlay.classList.contains('open');

                if (isModalOpen) {
                    const routeName = args[0];
                    console.log(`[Linux.do Modal] Router.${methodName} called with:`, args);

                    // 检查是否是 Topic 路由
                    if (routeName && typeof routeName === 'string' && routeName.startsWith('topic')) {
                        const target = args[1];
                        const targetId = (typeof target === 'object') ? target.id : target;

                        // 宽松比较 ID - 只要 currentTopicData 存在且 ID 匹配
                        if (currentTopicData && String(targetId) === String(currentTopicData.id)) {
                            console.warn(`[Linux.do Modal] BLOCKED navigation to ${routeName} (ID: ${targetId})`);

                            // 返回一个假的 Promise 对象
                            return {
                                catch: () => { return this; },
                                then: () => { return this; },
                                finally: () => { return this; },
                                abort: () => { return this; },
                                retry: () => { return this; }
                            };
                        }
                    }
                }
                if (originalMethod) {
                    return originalMethod.apply(this, args);
                }
                return;
            };

            // Patch transitionTo
            if (originalTransitionTo) {
                router.transitionTo = function (...args) {
                    return interceptNavigation.call(this, originalTransitionTo, 'transitionTo', ...args);
                };
                router.transitionTo.isPatchedByLinuxDo = true;
            }

            // Patch replaceWith
            if (originalReplaceWith) {
                router.replaceWith = function (...args) {
                    return interceptNavigation.call(this, originalReplaceWith, 'replaceWith', ...args);
                };
            }

            // Patch replaceRoute
            if (router.replaceRoute) {
                router.replaceRoute = function (...args) {
                    return interceptNavigation.call(this, router.replaceRoute, 'replaceRoute', ...args);
                };
            }

            console.log('[Linux.do Modal] Router interceptor installed (transitionTo & replaceWith)');

            // 【关键修复】拦截 DiscourseURL.routeTo
            // 这是 Discourse composer 评论成功后跳转的主要方法
            try {
                const DiscourseURL = unsafeWindow.require('discourse/lib/url').default;
                if (DiscourseURL && DiscourseURL.routeTo && !DiscourseURL.routeTo.isPatchedByLinuxDo) {
                    const originalRouteTo = DiscourseURL.routeTo.bind(DiscourseURL);
                    DiscourseURL.routeTo = function (url, opts = {}) {
                        const isModalOpen = modalOverlay && modalOverlay.classList.contains('open');

                        if (isModalOpen && isCurrentTopicUrl(url)) {
                            console.warn(`[Linux.do Modal] BLOCKED DiscourseURL.routeTo to: ${url}`);
                            // 返回 undefined，阻止导航
                            return;
                        }

                        return originalRouteTo(url, opts);
                    };
                    DiscourseURL.routeTo.isPatchedByLinuxDo = true;
                    console.log('[Linux.do Modal] DiscourseURL.routeTo interceptor installed');
                }
            } catch (urlError) {
                console.warn('[Linux.do Modal] Failed to patch DiscourseURL.routeTo:', urlError);
            }

            // 【额外保险】拦截 history.pushState 和 replaceState
            // 某些情况下 Discourse 可能直接操作 history
            if (!unsafeWindow.history.pushState.isPatchedByLinuxDo) {
                const originalPushState = unsafeWindow.history.pushState.bind(unsafeWindow.history);
                unsafeWindow.history.pushState = function (state, title, url) {
                    const isModalOpen = modalOverlay && modalOverlay.classList.contains('open');

                    if (isModalOpen && url && isCurrentTopicUrl(url)) {
                        console.warn(`[Linux.do Modal] BLOCKED history.pushState to: ${url}`);
                        return;
                    }

                    return originalPushState(state, title, url);
                };
                unsafeWindow.history.pushState.isPatchedByLinuxDo = true;
                console.log('[Linux.do Modal] history.pushState interceptor installed');
            }

        } catch (e) {
            console.error('[Linux.do Modal] Failed to install router interceptor:', e);
        }
    }

    // Discourse Composer Interaction
    // 【修复】确保传递完整的 topic 信息，包括 categoryId
    function openComposer(topicId, postNumber) {
        // Attempt to access Discourse internals via unsafeWindow
        try {
            const container = unsafeWindow.Discourse.__container__;
            const composerController = container.lookup('controller:composer');
            const Composer = unsafeWindow.require('discourse/models/composer').default;
            const Topic = unsafeWindow.require('discourse/models/topic').default;

            if (!composerController) {
                throw new Error('Cannot find Discourse Composer controller');
            }

            // 【关键修复】构建完整的 Topic 对象
            // 尝试使用 Discourse 模型构建，如果失败则回退到普通对象
            let topicModel;
            try {
                // 如果能获取到 store，尝试 peekRecord
                const store = container.lookup('service:store');
                if (store) {
                    topicModel = store.peekRecord('topic', topicId);
                }
            } catch (e) {
                console.warn('Failed to peek topic record:', e);
            }

            if (!topicModel) {
                // 手动构建
                const topicData = currentTopicData || {};
                topicModel = Topic.create({
                    id: topicId,
                    category_id: topicData.category_id || 49,
                    title: topicData.title,
                    slug: topicData.slug,
                    archetype: 'regular'
                });
            }

            // 构建 composer 配置
            const composerOptions = {
                action: Composer.REPLY,
                draftKey: `topic_${topicId}`,
                draftSequence: 0,
                // 【关键】必须提供这些字段
                topicId: topicId,
                topic: topicModel,
                categoryId: topicModel.category_id,
            };

            // 如果是回复特定帖子
            if (postNumber) {
                // 尝试查找 post 模型
                let postId = null;

                // 从 currentTopicData 中查找 post ID
                if (currentTopicData && currentTopicData.post_stream) {
                    const post = currentTopicData.post_stream.posts.find(p => p.post_number === postNumber);
                    if (post) postId = post.id;
                }

                // 尝试从 Store 查找
                if (!postId) {
                    try {
                        const store = container.lookup('service:store');
                        // 这一步比较难，因为 store 通常按 ID 索引，不按 post_number
                        // 但如果 topicModel 加载了 postStream，可能可以找到
                    } catch (e) { }
                }

                if (postId) {
                    composerOptions.action = Composer.REPLY;
                    composerOptions.postId = postId;
                    // 我们尽量不手动构建 Post Model，只传递 postId 让 Discourse 处理
                } else {
                    // Fallback: 仅传递 postNumber，虽然可能不够完美
                    composerOptions.postId = postNumber; // 某些旧版 Discourse 可能接受这个？
                    // 其实 Discourse 需要的是 postId (Integer)，不是 postNumber
                    // 如果找不到 ID，我们可能无法正确 Reply to Post
                    console.warn('Cannot find post ID for number', postNumber);

                    // 尝试凑合一下
                    composerOptions.post = {
                        post_number: postNumber,
                        topic_id: topicId,
                        id: -1 // 假的 ID 防止报错？
                    };
                }
            }

            composerController.open(composerOptions);

            // 确保 composer 显示在模态框上层
            setTimeout(() => {
                const replyControl = document.querySelector('#reply-control');
                if (replyControl) {
                    replyControl.style.zIndex = '10000';
                }
            }, 100);

            // 【新增】监听评论成功事件，自动刷新评论区
            setupReplySuccessWatcher(topicId);

        } catch (e) {
            console.error('Failed to open composer', e);
            // Fallback: 跳转到帖子页面
            if (postNumber) {
                window.location.href = `/t/${topicId}/${postNumber}`;
            } else {
                window.location.href = `/t/${topicId}`;
            }
        }
    }

    /**
     * 监听评论成功事件
     * 通过拦截 fetch 请求检测 POST /posts 成功
     */
    let replyWatcherActive = false;
    let originalFetch = null;

    function setupReplySuccessWatcher(topicId) {
        if (replyWatcherActive) return;
        replyWatcherActive = true;

        console.log('[Linux.do Modal] Setting up reply watcher for topic:', topicId);

        // 拦截 fetch 请求
        if (!originalFetch) {
            originalFetch = unsafeWindow.fetch;

            unsafeWindow.fetch = async function (...args) {
                const response = await originalFetch.apply(this, args);

                // 检测 POST /posts 请求
                const url = args[0];
                const options = args[1] || {};

                if (replyWatcherActive &&
                    typeof url === 'string' &&
                    url.includes('/posts') &&
                    options.method === 'POST') {

                    // 克隆响应以便检查内容
                    const clonedResponse = response.clone();

                    try {
                        if (clonedResponse.ok) {
                            const data = await clonedResponse.json();
                            // 检查是否是当前帖子的回复
                            if (data && data.post && String(data.post.topic_id) === String(topicId)) {
                                console.log('[Linux.do Modal] POST /posts success detected!');

                                // 【优化】直接将新评论追加到 DOM，无需全量刷新
                                setTimeout(() => {
                                    showToast('评论成功！', 'success');
                                    appendNewCommentToUI(data.post);

                                    // 重置 watcher 状态
                                    replyWatcherActive = false;
                                }, 300);  // 缩短延迟，几乎即时
                            }
                        }
                    } catch (e) {
                        // 响应可能不是 JSON，忽略
                    }
                }

                return response;
            };
        }

        // 60秒后自动取消监听
        setTimeout(() => {
            if (replyWatcherActive) {
                replyWatcherActive = false;
                console.log('[Linux.do Modal] Reply watcher timeout');
            }
        }, 60000);
    }

    /**
     * 检查是否有新评论（备用方法）
     */
    async function checkForNewComments(topicId) {
        try {
            const response = await fetch(`/t/${topicId}.json`, {
                headers: { 'Accept': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const currentCount = currentTopicData?.posts_count || 0;
                const newCount = data.posts_count || 0;
                return newCount > currentCount;
            }
        } catch (e) {
            console.warn('[Linux.do Modal] Failed to check for new comments:', e);
        }
        return false;
    }

    /**
     * 刷新评论区
     * 清除缓存并重新加载评论
     */
    async function refreshComments(topicId) {
        // 清除缓存
        if (topicId) {
            topicCache.delete(topicId);
        }

        // 重新加载帖子
        const url = `https://linux.do/t/topic/${topicId}`;
        await loadTopicIntoModal(url);
    }

    /**
     * 【新增】将新评论直接追加到模态框评论列表末尾
     * 无需重新请求 API，直接从 POST /posts 响应中提取数据渲染
     * @param {Object} postData - Discourse API 返回的 post 对象
     */
    function appendNewCommentToUI(postData) {
        // 1. 构造与 processPosts 兼容的节点
        const node = { ...postData, children: [] };

        // 2. 获取评论容器
        const container = infiniteScrollState.commentsContainer;
        if (!container) {
            console.warn('[Linux.do Modal] Cannot append comment: no container');
            return;
        }

        // 3. 渲染为 DOM 并追加
        const commentEl = renderCommentNode(node, 0, false);
        commentEl.style.animation = 'fadeInUp 0.3s ease';
        container.appendChild(commentEl);

        // 4. 更新状态
        infiniteScrollState.loadedPostIds.add(postData.id);
        if (currentTopicData) {
            currentTopicData.posts_count = (currentTopicData.posts_count || 0) + 1;
            // 同步更新 post_stream
            if (currentTopicData.post_stream) {
                if (currentTopicData.post_stream.stream &&
                    !currentTopicData.post_stream.stream.includes(postData.id)) {
                    currentTopicData.post_stream.stream.push(postData.id);
                }
            }
        }

        // 5. 更新评论计数显示
        const countEl = document.querySelector('.ld-comments-count');
        if (countEl) {
            const currentCount = parseInt(countEl.textContent) || 0;
            countEl.textContent = currentCount + 1;
        }

        // 6. 更新 footer 回复数
        const replyBtn = document.querySelector('#ld-btn-reply-topic span');
        if (replyBtn) {
            const currentReplyCount = parseInt(replyBtn.textContent) || 0;
            replyBtn.textContent = currentReplyCount + 1;
        }

        // 7. 滚动到新评论位置
        setTimeout(() => {
            commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

        // 8. 清除该 topic 缓存（下次打开时重新加载完整数据）
        if (infiniteScrollState.topicId) {
            topicCache.delete(infiniteScrollState.topicId);
        }

        console.log('[Linux.do Modal] New comment appended locally:', postData.id);
    }

    // ==========================================
    // 3. UI Components (Modal)
    // ==========================================
    function createModal() {
        if (modalOverlay) return;

        modalOverlay = document.createElement('div');
        modalOverlay.className = 'ld-modal-overlay';

        modalContainer = document.createElement('div');
        modalContainer.className = 'ld-modal-container';

        // Header
        const header = document.createElement('div');
        header.className = 'ld-modal-header';

        modalTitle = document.createElement('h2');
        modalTitle.className = 'ld-modal-title';
        modalTitle.textContent = 'Loading...';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ld-modal-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = closeModal;

        header.appendChild(modalTitle);
        header.appendChild(closeBtn);

        // Content
        modalContent = document.createElement('div');
        modalContent.className = 'ld-modal-content';

        // Footer
        modalFooter = document.createElement('div');
        modalFooter.className = 'ld-modal-footer';

        modalContainer.appendChild(header);
        modalContainer.appendChild(modalContent);
        modalContainer.appendChild(modalFooter);
        modalOverlay.appendChild(modalContainer);
        document.body.appendChild(modalOverlay);

        // Close events
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
        });

        // 【修复】阻止模态框滚动穿透到背景页面
        // 当模态框内容滚动到顶部/底部时，阻止 wheel 事件传播到背景
        modalOverlay.addEventListener('wheel', (e) => {
            const content = modalContent;
            if (!content) return;
            const { scrollTop, scrollHeight, clientHeight } = content;
            const atTop = scrollTop <= 0 && e.deltaY < 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
            // 如果滚动到边界，阻止默认行为防止背景滚动
            if (atTop || atBottom) {
                e.preventDefault();
            }
        }, { passive: false });

        // 移动端 touchmove 防穿透
        modalOverlay.addEventListener('touchmove', (e) => {
            // 只允许 modalContent 内部的 touch 滚动
            if (!e.target.closest('.ld-modal-content')) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    /**
     * 更新底部操作栏 - 包含点赞、评论、收藏按钮
     * 支持真实的 API 调用和状态管理
     */
    function updateFooter(topic, opPost) {
        if (!modalFooter) return;

        // 从 topic 和 OP post 获取状态
        const likeCount = topic.like_count || 0;
        const replyCount = topic.posts_count ? topic.posts_count - 1 : 0;
        const isBookmarked = topic.bookmarked || false;

        // 检查当前用户是否已点赞 OP（从 actions_summary 中查找）
        // action_type_id 2 = like, acted = true 表示已点赞
        let opLiked = false;
        if (opPost && opPost.actions_summary) {
            const likeAction = opPost.actions_summary.find(a => a.id === 2);
            opLiked = likeAction?.acted || false;
        }

        // 保存状态用于按钮事件
        let currentLikeCount = likeCount;
        let currentLiked = opLiked;
        let currentBookmarked = isBookmarked;

        modalFooter.innerHTML = `
            <button class="ld-footer-btn${currentLiked ? ' liked' : ''}" id="ld-btn-like" title="点赞">
                ${ICONS.like} <span id="ld-like-count">${currentLikeCount}</span>
            </button>
            <button class="ld-footer-btn" title="回复帖子" id="ld-btn-reply-topic">
                ${ICONS.comment} <span>${replyCount}</span>
            </button>
            <button class="ld-footer-btn${currentBookmarked ? ' bookmarked' : ''}" id="ld-btn-bookmark" title="收藏">
                 ${ICONS.bookmark} <span id="ld-bookmark-text">${currentBookmarked ? '' : ''}</span>
            </button>
            <button class="ld-footer-btn" id="ld-btn-share" title="分享">
                 ${ICONS.share}
            </button>
            <button class="ld-footer-btn" id="ld-btn-new-tab" title="新标签页打开">
                 ${ICONS.newTab}
            </button>
        `;

        // 获取按钮引用
        const likeBtn = document.getElementById('ld-btn-like');
        const bookmarkBtn = document.getElementById('ld-btn-bookmark');
        const replyBtn = document.getElementById('ld-btn-reply-topic');

        // 回复按钮事件
        replyBtn.onclick = () => {
            openComposer(topic.id, null);
        };

        // 点赞按钮事件 - 需要 OP 的 post_id
        likeBtn.onclick = async () => {
            if (!opPost) {
                showToast('无法获取帖子信息', 'error');
                return;
            }

            // 防止重复点击
            if (likeBtn.classList.contains('loading')) return;
            likeBtn.classList.add('loading');

            try {
                let result;
                if (currentLiked) {
                    // 取消点赞
                    result = await unlikePost(opPost.id);
                    if (result.success) {
                        currentLiked = false;
                        currentLikeCount = Math.max(0, currentLikeCount - 1);
                        likeBtn.classList.remove('liked');
                        document.getElementById('ld-like-count').textContent = currentLikeCount;
                        showToast('已取消点赞', 'info');
                    } else {
                        showToast(result.error || '取消点赞失败', 'error');
                    }
                } else {
                    // 点赞
                    result = await likePost(opPost.id);
                    if (result.success) {
                        currentLiked = true;
                        currentLikeCount += 1;
                        likeBtn.classList.add('liked');
                        document.getElementById('ld-like-count').textContent = currentLikeCount;
                        showToast('点赞成功！', 'success');
                    } else {
                        showToast(result.error || '点赞失败，请确认已登录', 'error');
                    }
                }
            } catch (e) {
                console.error('Like action failed:', e);
                showToast('操作失败', 'error');
            } finally {
                likeBtn.classList.remove('loading');
            }
        };

        // 收藏按钮事件
        bookmarkBtn.onclick = async () => {
            // 防止重复点击
            if (bookmarkBtn.classList.contains('loading')) return;
            bookmarkBtn.classList.add('loading');

            try {
                let result;
                if (currentBookmarked) {
                    // 取消收藏
                    result = await unbookmarkTopic(topic.id);
                    if (result.success) {
                        currentBookmarked = false;
                        bookmarkBtn.classList.remove('bookmarked');
                        document.getElementById('ld-bookmark-text').textContent = '收藏';
                        showToast('已取消收藏', 'info');
                    } else {
                        showToast('取消收藏失败', 'error');
                    }
                } else {
                    // 收藏
                    result = await bookmarkTopic(topic.id);
                    if (result.success) {
                        currentBookmarked = true;
                        bookmarkBtn.classList.add('bookmarked');
                        document.getElementById('ld-bookmark-text').textContent = '已收藏';
                        showToast('收藏成功！', 'success');
                    } else {
                        showToast('收藏失败，请确认已登录', 'error');
                    }
                }
            } catch (e) {
                console.error('Bookmark action failed:', e);
                showToast('操作失败', 'error');
            } finally {
                bookmarkBtn.classList.remove('loading');
            }
        };

        // 分享按钮事件 - 复制帖子链接到剪贴板
        const shareBtn = document.getElementById('ld-btn-share');
        if (shareBtn) {
            shareBtn.onclick = () => {
                const topicUrl = `https://linux.do/t/topic/${topic.id}`;
                copyToClipboard(topicUrl, 'topic');
            };
        }

        // 新标签页打开按钮事件
        const newTabBtn = document.getElementById('ld-btn-new-tab');
        if (newTabBtn) {
            newTabBtn.onclick = () => {
                window.open(`https://linux.do/t/topic/${topic.id}`, '_blank');
            };
        }
    }

    function openModal() {
        if (!modalOverlay) createModal();
        installRouterInterceptor(); // 确保拦截器已安装
        modalOverlay.classList.remove('hidden');
        void modalOverlay.offsetWidth;
        modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        if (!modalOverlay) return;
        modalOverlay.classList.remove('open');
        setTimeout(() => {
            modalOverlay.classList.add('hidden');
            modalContent.innerHTML = '';
            modalTitle.textContent = '';
            modalFooter.innerHTML = '';
            currentTopicData = null;

            // 【性能优化】清理 reply watcher 和 fetch 拦截
            replyWatcherActive = false;
            if (originalFetch) {
                unsafeWindow.fetch = originalFetch;
                originalFetch = null;
            }

            // 清理无限滚动状态
            resetInfiniteScrollState();
        }, 200);
        document.body.style.overflow = '';
    }

    // ==========================================
    // 3.1 Lightbox Component
    // ==========================================
    let lightboxOverlay, lightboxImg;

    function createLightbox() {
        if (lightboxOverlay) return;

        lightboxOverlay = document.createElement('div');
        lightboxOverlay.className = 'ld-lightbox-overlay';

        lightboxImg = document.createElement('img');
        lightboxImg.className = 'ld-lightbox-img';

        const closeBtn = document.createElement('div');
        closeBtn.className = 'ld-lightbox-close';
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

        lightboxOverlay.appendChild(lightboxImg);
        lightboxOverlay.appendChild(closeBtn);
        document.body.appendChild(lightboxOverlay);

        // Events
        const closeLightbox = () => {
            lightboxOverlay.classList.remove('open');
            setTimeout(() => {
                lightboxOverlay.style.display = 'none';
                lightboxImg.src = '';
            }, 300);
        };

        lightboxOverlay.onclick = (e) => {
            if (e.target !== lightboxImg) closeLightbox();
        };

        lightboxImg.onclick = closeLightbox;
        closeBtn.onclick = closeLightbox;

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && lightboxOverlay.classList.contains('open')) {
                closeLightbox();
            }
        });

        // Store close function on element for external access if needed
        lightboxOverlay.close = closeLightbox;
    }

    function openLightbox(src) {
        if (!lightboxOverlay) createLightbox();

        lightboxImg.src = src;
        lightboxOverlay.style.display = 'flex';
        // Force reflow
        void lightboxOverlay.offsetWidth;
        lightboxOverlay.classList.add('open');
    }

    function showLoading() {
        modalContent.innerHTML = `
            <div class="ld-spinner"></div>
            <div class="ld-loading-text">${CONFIG.loadingText}</div>
        `;
    }

    // ==========================================
    // 4. Data Fetching & Processing
    // ==========================================

    // 【频率限制保护】记录上次请求时间
    let lastFetchTime = 0;
    const MIN_FETCH_INTERVAL = 500; // 最小请求间隔 500ms

    /**
     * 从 URL 中提取 topic ID
     */
    function extractTopicId(url) {
        const match = url.match(/\/t\/[^/]+\/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * 获取帖子基础数据
     * 【优化】默认不使用 ?print=true 避免触发频率限制
     * 只在帖子数量确实需要时才加载更多
     */
    async function fetchTopicData(url, usePrint = false) {
        // 【频率限制保护】确保请求间隔
        const now = Date.now();
        const timeSinceLastFetch = now - lastFetchTime;
        if (timeSinceLastFetch < MIN_FETCH_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, MIN_FETCH_INTERVAL - timeSinceLastFetch));
        }
        lastFetchTime = Date.now();

        let jsonUrl = url.endsWith('.json') ? url : `${url}.json`;
        if (usePrint) {
            jsonUrl += '?print=true';
        }
        try {
            const response = await fetch(jsonUrl, {
                credentials: 'same-origin'
            });

            if (!response.ok) {
                // 【改进错误处理】尝试解析错误信息
                let errorMsg = '加载失败';
                try {
                    const errorData = await response.json();
                    if (errorData.errors && errorData.errors.length > 0) {
                        errorMsg = errorData.errors[0];
                    }
                } catch (e) {
                    // 无法解析错误信息，使用 HTTP 状态
                    if (response.status === 429) {
                        errorMsg = '请求过于频繁，请稍后再试';
                    } else if (response.status === 403) {
                        errorMsg = '没有权限访问此帖子';
                    } else if (response.status === 404) {
                        errorMsg = '帖子不存在';
                    }
                }
                return { error: errorMsg };
            }

            return await response.json();
        } catch (error) {
            console.error('Linux.do Modal Script Error:', error);
            return { error: '网络错误，请检查连接' };
        }
    }

    /**
     * 获取指定 post IDs 的帖子
     * 用于加载超过初始加载的帖子
     */
    async function fetchPostsByIds(topicId, postIds) {
        if (!postIds || postIds.length === 0) return [];

        const allPosts = [];
        // 分批获取，每批最多 200 个
        for (let i = 0; i < postIds.length; i += CONFIG.postsPerBatch) {
            const batch = postIds.slice(i, i + CONFIG.postsPerBatch);
            const params = batch.map(id => `post_ids[]=${id}`).join('&');
            try {
                const response = await fetch(`/t/${topicId}/posts.json?${params}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.post_stream && data.post_stream.posts) {
                        allPosts.push(...data.post_stream.posts);
                    }
                }
            } catch (e) {
                console.error('Failed to fetch posts batch:', e);
            }
        }
        return allPosts;
    }

    /**
     * 加载帖子的所有评论
     * 策略：
     * 1. 首次使用 ?print=true 尝试获取最多 1000 条
     * 2. 如果帖子数量超过已加载的，分批获取剩余的
     */
    async function fetchAllPosts(topicId, postStream, updateProgress) {
        const allPostIds = postStream.stream || [];
        const loadedPosts = postStream.posts || [];
        const loadedPostIds = new Set(loadedPosts.map(p => p.id));

        // 找出还未加载的 post IDs
        const missingPostIds = allPostIds.filter(id => !loadedPostIds.has(id));

        if (missingPostIds.length === 0) {
            // 所有帖子都已加载
            return loadedPosts;
        }

        if (updateProgress) {
            updateProgress(`正在加载评论... (${loadedPosts.length}/${allPostIds.length})`);
        }

        // 分批加载剩余帖子
        const additionalPosts = [];
        for (let i = 0; i < missingPostIds.length; i += CONFIG.postsPerBatch) {
            const batch = missingPostIds.slice(i, i + CONFIG.postsPerBatch);
            const params = batch.map(id => `post_ids[]=${id}`).join('&');
            try {
                const response = await fetch(`/t/${topicId}/posts.json?${params}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.post_stream && data.post_stream.posts) {
                        additionalPosts.push(...data.post_stream.posts);
                        if (updateProgress) {
                            const total = loadedPosts.length + additionalPosts.length;
                            updateProgress(`正在加载评论... (${total}/${allPostIds.length})`);
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to fetch posts batch:', e);
            }
        }

        // 合并并按 post_number 排序
        const allPosts = [...loadedPosts, ...additionalPosts];
        allPosts.sort((a, b) => a.post_number - b.post_number);

        return allPosts;
    }

    /**
     * 处理帖子数据，构建树状结构
     */
    function processPosts(posts) {
        if (!posts || posts.length === 0) return { op: null, comments: [] };

        const op = posts[0];
        const rawComments = posts.slice(1);

        // Map post_number to post object for reply lookup
        const postsByNumber = {};
        posts.forEach(p => {
            postsByNumber[p.post_number] = { ...p, children: [] };
        });

        const rootComments = [];

        rawComments.forEach(p => {
            const node = postsByNumber[p.post_number];
            // reply_to_post_number points to the post being replied to.
            // If null, it's a direct reply to topic (effectively reply to OP).

            // If reply_to_post_number is defined and NOT OP's number (1), it's a nested reply.
            if (p.reply_to_post_number && p.reply_to_post_number !== op.post_number) {
                const parent = postsByNumber[p.reply_to_post_number];
                if (parent) {
                    parent.children.push(node);
                } else {
                    // Parent missing, treat as root
                    rootComments.push(node);
                }
            } else {
                rootComments.push(node);
            }
        });

        return { op, comments: rootComments };
    }

    // ==========================================
    // 5. Rendering
    // ==========================================
    function renderOP(op, topicTitle) {
        if (!op) return document.createElement('div');

        const wrapper = document.createElement('div');
        wrapper.className = 'ld-topic-op';

        // Update Modal Title
        modalTitle.textContent = topicTitle || op.topic_slug;

        const header = document.createElement('div');
        header.className = 'ld-post-header';

        const avatarUrl = op.avatar_template.replace('{size}', String(CONFIG.avatars.op * 2)); // Retina
        const fullAvatarUrl = avatarUrl.startsWith('http') ? avatarUrl : `https://linux.do${avatarUrl}`;

        header.innerHTML = `
            <img src="${fullAvatarUrl}" class="ld-avatar ld-avatar-op" alt="${op.username}">
            <div class="ld-user-info">
                <span class="ld-username">${op.display_username || op.username}</span>
                <span class="ld-time">${formatDate(op.created_at)}</span>
            </div>
        `;

        const body = document.createElement('div');
        body.className = 'ld-cook';
        body.innerHTML = op.cooked;

        wrapper.appendChild(header);
        wrapper.appendChild(body);
        return wrapper;
    }

    /**
     * 渲染单条评论 - 使用更紧凑的水平布局
     * 【性能优化】延迟加载子评论，避免一次性渲染整个嵌套树
     * @param {Object} comment 评论数据
     * @param {number} depth 嵌套深度
     * @param {boolean} deferChildren 是否延迟渲染子评论
     * @returns {HTMLElement} 评论 DOM 元素
     */
    function renderCommentNode(comment, depth = 0, deferChildren = false) {
        const item = document.createElement('div');
        item.className = 'ld-comment-item';
        item.dataset.postId = comment.id; // 用于点赞等操作

        // 【性能优化】直接构造 HTML 字符串，减少 DOM 操作
        const avatarSize = depth === 0 ? 28 : 24;
        const avatarClass = depth === 0 ? 'ld-avatar-l1' : 'ld-avatar-l2';
        const avatarUrl = comment.avatar_template.replace('{size}', String(avatarSize * 2));
        const fullAvatarUrl = avatarUrl.startsWith('http') ? avatarUrl : `https://linux.do${avatarUrl}`;

        // 紧凑的水平元信息布局
        const replyToHtml = comment.reply_to_user
            ? `<span class="ld-comment-meta-sep">→</span><span class="ld-comment-reply-to">@${comment.reply_to_user.username}</span>`
            : '';

        // 【UI优化】点赞状态检测
        // - acted: 当前用户是否已点赞
        // - can_act: 是否可以点赞（未登录或自己的帖子无法点赞）
        const likeAction = comment.actions_summary?.find(a => a.id === 2);
        const likeCount = likeAction?.count || 0;
        const hasLiked = likeAction?.acted || false;
        const canLike = likeAction?.can_act !== false; // 默认允许点赞
        const likeIcon = hasLiked ? ICONS.like : ICONS.likeEmpty;
        const likeCountText = likeCount > 0 ? ` <span class="ld-like-num">${likeCount}</span>` : '';
        const likedClass = hasLiked ? ' has-likes user-liked' : (likeCount > 0 ? ' has-likes' : '');

        // 【新增】楼层号显示 - 使用 post_number（主楼=1，评论从2开始）
        // 评论楼层 = post_number - 1（因为主楼是1）
        const floorNumber = comment.post_number - 1;
        const floorHtml = floorNumber > 0 ? `<span class="ld-floor-number">#${floorNumber}</span>` : '';

        // 【OP标签】判断当前评论是否为原帖作者
        const opBadgeHtml = (currentOpUsername && comment.username === currentOpUsername)
            ? '<span class="ld-op-badge">OP</span>'
            : '';

        item.innerHTML = `
            <div class="ld-comment-inner">
                <div class="ld-comment-header">
                    <div class="ld-comment-user">
                        <img src="${fullAvatarUrl}" class="ld-avatar ${avatarClass}" alt="${comment.username}" loading="lazy">
                        <div class="ld-comment-meta">
                            <span class="ld-comment-username">${comment.username}</span>
                            ${opBadgeHtml}
                            ${replyToHtml}
                            <span class="ld-comment-meta-sep">·</span>
                            <span class="ld-comment-time">${formatDate(comment.created_at)}</span>
                        </div>
                    </div>
                    ${floorHtml}
                </div>
                <div class="ld-comment-body">${comment.cooked}</div>
                <div class="ld-comment-actions">
                    <div class="ld-action-link ld-like-btn${likedClass}" data-post-id="${comment.id}" data-liked="${hasLiked}" data-can-like="${canLike}">${likeIcon}${likeCountText}</div>
                    <div class="ld-action-link ld-reply-btn">${ICONS.reply} 回复</div>
                    <div class="ld-action-link ld-share-btn">${ICONS.share} 分享</div>
                </div>
            </div>
        `;

        // 【新增】绑定点赞按钮 - 调用真实 API
        const likeBtn = item.querySelector('.ld-like-btn');
        if (likeBtn && canLike) {
            likeBtn.onclick = async (e) => {
                e.stopPropagation();
                if (likeBtn.classList.contains('loading')) return;

                const postId = parseInt(likeBtn.dataset.postId);
                const isLiked = likeBtn.dataset.liked === 'true';

                likeBtn.classList.add('loading');

                try {
                    let result;
                    if (isLiked) {
                        // 取消点赞
                        result = await unlikePost(postId);
                        if (result.success) {
                            likeBtn.classList.remove('user-liked', 'has-likes');
                            likeBtn.dataset.liked = 'false';
                            likeBtn.innerHTML = ICONS.likeEmpty;
                            const numEl = likeBtn.querySelector('.ld-like-num');
                            if (numEl) {
                                const newCount = Math.max(0, parseInt(numEl.textContent) - 1);
                                if (newCount > 0) {
                                    numEl.textContent = newCount;
                                } else {
                                    numEl.remove();
                                }
                            }
                            showToast('已取消点赞', 'info');
                        } else {
                            showToast(result.error || '取消失败', 'error');
                        }
                    } else {
                        // 点赞
                        result = await likePost(postId);
                        if (result.success) {
                            likeBtn.classList.add('user-liked', 'has-likes');
                            likeBtn.dataset.liked = 'true';
                            // 更新图标和数字
                            const numEl = likeBtn.querySelector('.ld-like-num');
                            if (numEl) {
                                numEl.textContent = parseInt(numEl.textContent) + 1;
                            } else {
                                likeBtn.innerHTML = `${ICONS.like} <span class="ld-like-num">1</span>`;
                            }
                            showToast('点赞成功！', 'success');
                        } else {
                            showToast(result.error || '点赞失败', 'error');
                        }
                    }
                } catch (err) {
                    console.error('Like action failed:', err);
                    showToast('操作失败', 'error');
                } finally {
                    likeBtn.classList.remove('loading');
                }
            };
        }

        // 绑定回复按钮
        const replyBtn = item.querySelector('.ld-reply-btn');
        if (replyBtn) {
            replyBtn.onclick = (e) => {
                e.stopPropagation();
                openComposer(comment.topic_id, comment.post_number);
            };
        }

        // 绑定分享按钮 - 复制评论链接到剪贴板
        const shareBtn = item.querySelector('.ld-share-btn');
        if (shareBtn) {
            shareBtn.onclick = (e) => {
                e.stopPropagation();
                const commentUrl = getCommentUrl(comment.topic_id, comment.post_number);
                copyToClipboard(commentUrl, 'comment');
            };
        }

        // 【性能优化】延迟渲染子评论
        if (comment.children && comment.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'ld-children';
            item.appendChild(childrenContainer);

            if (deferChildren) {
                // 延迟渲染：使用 requestIdleCallback 或 setTimeout 在空闲时渲染
                const renderChildrenDeferred = () => {
                    const fragment = document.createDocumentFragment();
                    comment.children.forEach(child => {
                        fragment.appendChild(renderCommentNode(child, depth + 1, true));
                    });
                    childrenContainer.appendChild(fragment);
                };

                if ('requestIdleCallback' in window) {
                    requestIdleCallback(renderChildrenDeferred, { timeout: 500 });
                } else {
                    setTimeout(renderChildrenDeferred, 16);
                }
            } else {
                // 立即渲染（用于首屏关键内容）
                const fragment = document.createDocumentFragment();
                comment.children.forEach(child => {
                    fragment.appendChild(renderCommentNode(child, depth + 1, depth >= 1)); // 深层嵌套延迟
                });
                childrenContainer.appendChild(fragment);
            }
        }

        return item;
    }

    /**
     * 渐进式分批渲染评论
     * 【性能优化】
     * 1. 使用 requestAnimationFrame 确保不阻塞 UI
     * 2. 使用 DocumentFragment 批量插入，减少重排
     * 3. 首批快速渲染，后续批次使用更大间隔
     * 4. 深层嵌套评论延迟加载
     */
    function renderCommentsInBatches(comments, container, onComplete) {
        let index = 0;
        const firstBatchSize = 15; // 【优化】首批快速渲染更少评论
        const normalBatchSize = CONFIG.renderBatchSize;
        let isFirstBatch = true;

        function renderBatch() {
            const batchSize = isFirstBatch ? firstBatchSize : normalBatchSize;
            const fragment = document.createDocumentFragment();
            const end = Math.min(index + batchSize, comments.length);

            for (let i = index; i < end; i++) {
                // 【优化】首批评论立即渲染子评论，后续批次延迟渲染
                fragment.appendChild(renderCommentNode(comments[i], 0, !isFirstBatch));
            }

            container.appendChild(fragment);
            index = end;
            isFirstBatch = false;

            if (index < comments.length) {
                // 【优化】使用 requestAnimationFrame 保持流畅
                requestAnimationFrame(renderBatch);
            } else if (onComplete) {
                onComplete();
            }
        }

        // 【优化】立即开始首批渲染
        requestAnimationFrame(renderBatch);
    }

    /**
     * 主加载函数 - 加载帖子到模态框
     * 【优化点】
     * 1. 默认预加载前3页评论
     * 2. 使用骨架屏提升感知速度
     * 3. 支持无限滚动加载更多评论
     * 4. 缓存已加载的帖子数据
     */
    async function loadTopicIntoModal(url) {
        openModal();
        showSkeleton();

        const topicId = extractTopicId(url);

        // 重置无限滚动状态
        resetInfiniteScrollState();

        // 检查缓存
        const cached = topicId ? getCachedTopic(topicId) : null;
        let data, allPosts;

        if (cached) {
            data = cached.data;
            allPosts = cached.allPosts;
        } else {
            // 首次加载帖子基础数据
            data = await fetchTopicData(url, false);

            if (data && data.error) {
                modalContent.innerHTML = `
                    <div style="text-align:center;padding:40px;">
                        <p style="color:#ef4444;font-size:1rem;margin-bottom:12px;">⚠️ ${data.error}</p>
                        <button class="ld-load-more-btn" onclick="window.open('${url}', '_blank')">
                            在新标签页打开
                        </button>
                    </div>
                `;
                return;
            }

            if (!data || !data.post_stream) {
                modalContent.innerHTML = '<p style="color:red;text-align:center;">无法加载帖子</p>';
                return;
            }

            currentTopicData = data;

            // 【新增】预加载前3页评论
            // Discourse 默认每页约20条帖子
            const streamIds = data.post_stream.stream || [];
            const loadedPostIds = new Set(data.post_stream.posts.map(p => p.id));
            const postsToLoad = CONFIG.initialPagesToLoad * CONFIG.postsPerPage;

            // 找出需要额外加载的帖子 ID
            const idsToFetch = streamIds
                .filter(id => !loadedPostIds.has(id))
                .slice(0, postsToLoad);

            allPosts = [...data.post_stream.posts];

            if (idsToFetch.length > 0) {
                const additionalPosts = await fetchPostsByIds(topicId, idsToFetch);
                if (additionalPosts.length > 0) {
                    allPosts = [...allPosts, ...additionalPosts];
                }
            }

            // 缓存数据
            if (topicId) {
                setCachedTopic(topicId, data, allPosts);
            }
        }

        // 设置无限滚动状态
        infiniteScrollState.topicId = topicId;
        infiniteScrollState.allPostIds = data.post_stream.stream || [];
        infiniteScrollState.loadedPostIds = new Set(allPosts.map(p => p.id));
        infiniteScrollState.hasMore = infiniteScrollState.loadedPostIds.size < infiniteScrollState.allPostIds.length;

        const { op, comments } = processPosts(allPosts);

        // 【OP标签】记录原帖作者用户名，供 renderCommentNode 使用
        currentOpUsername = op ? op.username : null;

        modalContent.innerHTML = '';

        // 更新 Footer
        updateFooter({
            id: data.id,
            like_count: data.like_count || 0,
            posts_count: data.posts_count,
            bookmarked: data.bookmarked,
            ...data
        }, op);

        // 渲染 OP
        modalContent.appendChild(renderOP(op, data.title));

        // 渲染评论区
        if (comments.length > 0) {
            const totalComments = infiniteScrollState.allPostIds.length - 1; // 减去 OP
            const commentsHeader = document.createElement('div');
            commentsHeader.className = 'ld-comments-header';
            commentsHeader.innerHTML = `
                <span class="ld-comments-title">评论</span>
                <span class="ld-comments-count">${totalComments}</span>
            `;
            modalContent.appendChild(commentsHeader);

            const treeContainer = document.createElement('div');
            treeContainer.className = 'ld-comment-tree';
            modalContent.appendChild(treeContainer);

            // 保存容器引用用于无限滚动
            infiniteScrollState.commentsContainer = treeContainer;

            // 渲染评论
            renderCommentsInBatches(comments, treeContainer, () => {
                // 添加无限滚动加载指示器
                if (infiniteScrollState.hasMore) {
                    const loader = document.createElement('div');
                    loader.className = 'ld-infinite-loader';
                    loader.id = 'ld-infinite-loader';
                    loader.innerHTML = `<div class="ld-mini-spinner"></div><span>滚动加载更多评论... (剩余 ${infiniteScrollState.allPostIds.length - infiniteScrollState.loadedPostIds.size} 条)</span>`;
                    modalContent.appendChild(loader);

                    // 设置无限滚动监听
                    setupInfiniteScroll();
                } else {
                    // 所有评论已加载
                    const noMore = document.createElement('div');
                    noMore.className = 'ld-no-more-comments';
                    noMore.textContent = '已加载全部评论';
                    modalContent.appendChild(noMore);
                }
            });
        } else {
            const noComments = document.createElement('div');
            noComments.className = 'ld-no-more-comments';
            noComments.textContent = '暂无评论';
            modalContent.appendChild(noComments);
        }
    }

    /**
     * 重置无限滚动状态
     */
    function resetInfiniteScrollState() {
        // 移除旧的滚动监听
        if (infiniteScrollState.scrollHandler && modalContent) {
            modalContent.removeEventListener('scroll', infiniteScrollState.scrollHandler);
        }

        infiniteScrollState = {
            topicId: null,
            allPostIds: [],
            loadedPostIds: new Set(),
            isLoading: false,
            hasMore: true,
            commentsContainer: null,
            scrollHandler: null,
        };
    }

    /**
     * 设置无限滚动监听
     * 当滚动到距离底部 300px 时自动加载下一批评论
     */
    function setupInfiniteScroll() {
        const scrollContainer = modalContent;
        if (!scrollContainer) return;

        const handleScroll = async () => {
            // 检查是否接近底部
            const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
            const distanceToBottom = scrollHeight - scrollTop - clientHeight;

            if (distanceToBottom < CONFIG.infiniteScrollThreshold &&
                !infiniteScrollState.isLoading &&
                infiniteScrollState.hasMore) {
                await loadMoreComments();
            }
        };

        // 【性能优化】使用 requestAnimationFrame 节流，贴合浏览器渲染帧率
        let rafPending = false;
        infiniteScrollState.scrollHandler = () => {
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(() => {
                    handleScroll();
                    rafPending = false;
                });
            }
        };

        scrollContainer.addEventListener('scroll', infiniteScrollState.scrollHandler);
    }

    /**
     * 加载更多评论（无限滚动触发）
     */
    async function loadMoreComments() {
        if (infiniteScrollState.isLoading || !infiniteScrollState.hasMore) return;

        infiniteScrollState.isLoading = true;

        // 获取加载指示器
        const loader = document.getElementById('ld-infinite-loader');

        if (loader) {
            loader.innerHTML = `<div class="ld-mini-spinner"></div><span>正在加载...</span>`;
        }

        try {
            // 找出下一批需要加载的帖子 ID
            const idsToFetch = infiniteScrollState.allPostIds
                .filter(id => !infiniteScrollState.loadedPostIds.has(id))
                .slice(0, CONFIG.postsPerPage);

            if (idsToFetch.length === 0) {
                infiniteScrollState.hasMore = false;
                if (loader) {
                    loader.innerHTML = '<span>已加载全部评论</span>';
                    loader.className = 'ld-no-more-comments';
                }
                return;
            }

            const newPosts = await fetchPostsByIds(infiniteScrollState.topicId, idsToFetch);

            if (newPosts.length > 0) {
                // 更新已加载 ID 集合
                newPosts.forEach(p => infiniteScrollState.loadedPostIds.add(p.id));

                // 【修复】增量帖子不含 OP，不能使用 processPosts（它会切掉第一条）
                // 直接将每条帖子作为根评论节点处理
                const newComments = newPosts.map(p => ({ ...p, children: [] }));

                // 渲染新评论到容器
                if (infiniteScrollState.commentsContainer && newComments.length > 0) {
                    renderCommentsInBatches(newComments, infiniteScrollState.commentsContainer);
                }

                // 检查是否还有更多
                const remaining = infiniteScrollState.allPostIds.length - infiniteScrollState.loadedPostIds.size;
                infiniteScrollState.hasMore = remaining > 0;

                if (!infiniteScrollState.hasMore) {
                    if (loader) {
                        loader.innerHTML = '<span>已加载全部评论</span>';
                        loader.className = 'ld-no-more-comments';
                    }
                } else if (loader) {
                    // 更新剩余数量
                    loader.innerHTML = `<div class="ld-mini-spinner"></div><span>滚动加载更多评论... (剩余 ${remaining} 条)</span>`;
                }
            } else {
                infiniteScrollState.hasMore = false;
                if (loader) {
                    loader.innerHTML = '<span>已加载全部评论</span>';
                    loader.className = 'ld-no-more-comments';
                }
            }
        } catch (e) {
            console.error('Failed to load more comments:', e);
            showToast('加载评论失败', 'error');
            // 恢复加载器状态
            if (loader) {
                const remaining = infiniteScrollState.allPostIds.length - infiniteScrollState.loadedPostIds.size;
                loader.innerHTML = `<div class="ld-mini-spinner"></div><span>滚动加载更多评论... (剩余 ${remaining} 条)</span>`;
            }
        } finally {
            infiniteScrollState.isLoading = false;
        }
    }

    // ==========================================
    // 6. Initialization
    // ==========================================
    function init() {
        document.body.addEventListener('click', function (e) {
            const anchor = e.target.closest('a');
            if (!anchor) return;

            const href = anchor.getAttribute('href');
            if (!href) return;

            // Match topic links
            let isTopicLink = false;
            let targetUrl = href;

            if (href.startsWith('http')) {
                if (href.includes('linux.do/t/')) isTopicLink = true;
            } else if (href.startsWith('/t/')) {
                isTopicLink = true;
                targetUrl = `https://linux.do${href}`;
            }

            // Exclude specific post links if we only want topic start?
            // Actually, /t/topic/123/456 is a link to post 456. 
            // The user wants "Topic View". If they click a specific post link, maybe scroll to it?
            // For now, simpler to just load the topic.

            if (isTopicLink) {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                e.stopPropagation();
                loadTopicIntoModal(targetUrl);
            }
        }, true);

        // 【新增】图片点击事件代理 - 打开 Lightbox
        document.body.addEventListener('click', function (e) {
            // 检查是否是模态框内的图片
            if (!modalOverlay || !modalOverlay.contains(e.target)) return;

            if (e.target.tagName === 'IMG' &&
                (e.target.closest('.ld-cook') || e.target.closest('.ld-comment-body'))) {

                // 排除头像和表情
                if (e.target.classList.contains('emoji') ||
                    e.target.classList.contains('ld-avatar') ||
                    e.target.classList.contains('avatar')) return;

                e.preventDefault();
                e.stopPropagation();

                // 尝试获取全分辨率图片链接
                let src = e.target.src;
                // Discourse 有时会在父级 a 标签放原图链接
                const parentLink = e.target.closest('a.lightbox');
                if (parentLink) {
                    src = parentLink.href;
                }

                openLightbox(src);
            }
        }, true); // Use capture to intercept before other handlers if possible
    }

    init();

})();
