/* ============================================================
   移动端优化小工具 (Mobile-Focus-Interceptor) — 主逻辑模块（index.js）
   ============================================================ */

/* 说明（插件名 / 目录名保持 Mobile-Focus-Interceptor）：
   针对 SillyTavern 移动端痛点优化的前端插件，双端共有的问题也会顺手一并修复。

   模块 A：聚焦拦截（仅移动端）
           拦截代码自动聚焦，只在用户主动点击输入框时允许聚焦弹出键盘。
   模块 B：键盘粘贴卡顿修复（仅移动端）
           beforeinput 拦截 + visibility:hidden 抑制重绘，将分段粘贴合并为一次性渲染；
           合并窗口按文本量自适应，超大文本分段/重复粘贴不逐段整段重写。
   模块 C：Token Counter 分词高亮渲染优化（桌面/移动通用）
           透明拦截 appendChild/insertBefore + content-visibility 分组，
           解决大文本分词高亮渲染导致的页面假死；首屏上限 + 「继续加载」逐帧渐进渲染。
   模块 D：ST 原生 :has() 样式失效修复（桌面/移动通用）
           删除 ST 主样式表中触发整页样式失效的 z-index 规则，
           用内联 z-index 复刻其行为，修复抽屉/弹窗后键盘开合持续卡顿。
   模块 E：外部小窗键盘布局冻结（仅移动端）
           Android 外部小窗应用呼出键盘时也会缩小 ST 的布局视口；
           检测到 ST 输入框未聚焦，或刚切出 ST 后输入框仍保留焦点时的
           视口骤减后，用像素高度冻结主布局，避免 ST 跟随外部键盘缩放，
           同时保留 ST 自身键盘的原生行为。

   控制台输出：默认只打印 1 条整体加载成功提示，以及真正出现问题时的 warn / error；
           把下方 MFI_DEBUG 改为 true，可额外看到分模块就绪信息与详细调试日志。
   ============================================================ */

// ============================================================
// 调试输出
// ============================================================
// MFI_DEBUG：控制台输出开关，默认 false（减少控制台噪音，避免刷屏）
//   false —— 只有「插件整体加载成功」1 条提示 + 真正出现问题时的 warn / error
//   true  —— 额外打印各模块就绪信息（按模块分别打印）与运行期详细调试日志
// 排查问题时改为 true 再刷新 ST 即可；warn / error 不受此开关影响，始终打印。
var MFI_DEBUG = false;

/** 分模块的详细日志：仅 MFI_DEBUG=true 时输出 */
function mfiLog() {
    if (MFI_DEBUG) {
        console.log.apply(console, arguments);
    }
}

/** 运行期详细日志（键盘布局冻结/恢复等过程性事件）：仅 MFI_DEBUG=true 时输出 */
function mfiDebug() {
    if (MFI_DEBUG) {
        console.debug.apply(console, arguments);
    }
}

/** 整体加载成功提示：不受 MFI_DEBUG 影响，每次加载只打印一条 */
var mfiLoadedLogged = false;
function mfiLogLoaded() {
    if (mfiLoadedLogged) {
        return;
    }
    mfiLoadedLogged = true;
    console.log('[MobileFocus] 移动端优化小工具已加载');
}

function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 768;
}

// ============================================================
// 模块 A: 聚焦拦截
// ============================================================

function initMobileFocusInterceptor() {
    if (window.__mobileFocusInterceptorInstalled__) {
        return;
    }
    window.__mobileFocusInterceptorInstalled__ = true;

    if (!isMobile()) {
        mfiLog('[MobileFocus] 模块 A 跳过：仅移动端启用');
        return;
    }

    var lastTouchTime = 0;
    var wasTouchOnInput = false;

    function updateTouchTime(e) {
        lastTouchTime = Date.now();
        var el = e.target;
        wasTouchOnInput = (
            el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            el.isContentEditable
        );
    }

    document.addEventListener('touchstart', updateTouchTime, { passive: true, capture: true });
    document.addEventListener('pointerdown', updateTouchTime, { passive: true, capture: true });
    document.addEventListener('mousedown', updateTouchTime, { capture: true });

    var originalFocus = HTMLElement.prototype.focus;
    var inputElements = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

    HTMLElement.prototype.focus = function (options) {
        var now = Date.now();
        var isUserInitiated = (now - lastTouchTime) < 500 && wasTouchOnInput;

        if (isUserInitiated || !inputElements.has(this.tagName)) {
            return originalFocus.call(this, options);
        }

        if (!this.isConnected) {
            return originalFocus.call(this, options);
        }
        var computedStyle = window.getComputedStyle(this);
        if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
            return originalFocus.call(this, options);
        }

        return undefined;
    };

    function destroy() {
        HTMLElement.prototype.focus = originalFocus;
        document.removeEventListener('touchstart', updateTouchTime, { capture: true });
        document.removeEventListener('pointerdown', updateTouchTime, { capture: true });
        document.removeEventListener('mousedown', updateTouchTime, { capture: true });
        window.__mobileFocusInterceptorInstalled__ = false;
    }

    window.addEventListener('beforeunload', destroy);
    window.__mobileFocusInterceptorDestroy__ = destroy;

    mfiLog('[MobileFocus] 模块 A 聚焦拦截器就绪');
}

// ============================================================
// 模块 B: 键盘粘贴卡顿修复（仅移动端）
// ============================================================
// 策略：
//   A. 单次 >=5000 字符 → 直接判定为大文本粘贴，preventDefault + 100ms flush
//   B. 200ms 内 >=3 次 beforeinput 且有一次 >3 字符 → 多段粘贴，preventDefault + 动态超时 flush
//   C. 以上都不满足 → 正常打字，放行
// flush 时使用 visibility:hidden 抑制重绘 + rAF 分离文本渲染和高度调整，
// 将浏览器分段渲染合并为一次，性能对齐长按粘贴。
// 说明：仅对 <textarea>/<input> 拦截（contenteditable 交给浏览器原生处理，
// 避免 value 写入逻辑不兼容导致丢字）。

function initPastePerformanceFix() {
    if (window.__pastePerformanceFixInstalled__) {
        return;
    }
    window.__pastePerformanceFixInstalled__ = true;

    // 仅移动端生效（2026-08-22 回归）：桌面端粘贴大文本无此卡顿，避免拦截误伤；
    // 模块 A 聚焦拦截同样仅移动端，与此保持一致
    if (!isMobile()) {
        mfiLog('[MobileFocus] 模块 B 跳过：仅移动端启用（桌面端粘贴大文本无此卡顿）');
        return;
    }

    // --- 核心状态 ---
    var burstTimestamps = [];
    var hasSubstantialText = false;
    var textParts = [];
    var pasteStartPos = null;
    var pasteTarget = null;   // 当前正在粘贴的目标元素
    var batching = false;
    var flushTimer = null;
    var currentTimeout = 300;
    /** 当前批次已累积的文本长度（避免每次计算 join 结果长度） */
    var textAccumLen = 0;
    /** 最近一次大文本 flush 的时间，用于识别「连续分段粘贴」 */
    var lastBigFlushAt = -1e9;
    /** rAF ID，用于在 destroy 时取消 */
    var rafId = null;

    /** 判断元素是否为可输入的 textarea/input/contenteditable */
    function isEditable(el) {
        // 只用 value 语义完整的元素：contenteditable 无 .value，拦截后无法写入
        return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
    }

    /**
     * 根据当前批次已累积的文本量决定 flush 等待时间。
     * 文本越大越可能是超大文本分段粘贴：多等一会儿把更多分段合并成一次渲染，
     * 避免每段都触发一次「整段重写 + 全量布局」（这是分段粘贴卡顿的根源）。
     */
    function getFlushDelay() {
        if (textAccumLen >= 1000000) return 2000;
        if (textAccumLen >= 500000) return 1500;
        if (textAccumLen >= 200000) return 1000;
        if (textAccumLen >= 100000) return 600;
        return 300;
    }

    /**
     * 将累积的文本一次性写入目标元素
     */
    function flushBuffer() {
        batching = false;
        clearTimeout(flushTimer);
        flushTimer = null;
        burstTimestamps = [];
        hasSubstantialText = false;
        currentTimeout = 300;

        var accumulatedText = textParts.join('');
        textParts = [];
        textAccumLen = 0;

        if (accumulatedText.length === 0 || pasteStartPos === null || !pasteTarget) {
            pasteStartPos = null;
            pasteTarget = null;
            return;
        }

        var target = pasteTarget;
        var start = pasteStartPos;
        var valueLen = target.value.length;
        var end = target.selectionEnd;
        var before = start > 0 ? target.value.substring(0, start) : '';
        var after = end < valueLen ? target.value.substring(end) : '';

        pasteStartPos = null;
        pasteTarget = null;

        // 隐藏目标元素，避免 value 赋值期间的重绘
        target.style.visibility = 'hidden';

        // 一次性写入文本（内部做字形布局，但不重绘）
        target.value = before + accumulatedText + after;
        var newPos = start + accumulatedText.length;
        if (typeof target.setSelectionRange === 'function') {
            target.setSelectionRange(newPos, newPos);
        }

        // 让 input 安全网知道值已由我们写入：flush 后派发的 input 直接透传给
        // ST，不再被吞掉等 250ms 重发（每次粘贴省掉一次延迟 + 一轮重复处理）
        lastInputTarget = target;
        lastValueLength = target.value.length;

        if (accumulatedText.length >= 5000) {
            lastBigFlushAt = Date.now();
        }

        // rAF 中恢复可见并触发 input
        rafId = requestAnimationFrame(function () {
            rafId = null;
            target.style.visibility = '';
            target.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    /**
     * beforeinput 事件处理器（document capture 阶段）
     * 对所有 textarea/input/contenteditable 生效
     */
    function onBeforeInputCapture(e) {
        var target = e.target;
        if (!isEditable(target)) return;

        // 不拦截 IME 组合输入
        if (e.isComposing) return;

        var textInsertTypes = ['insertText', 'insertFromPaste', 'insertCompositionText', 'insertReplacementText'];
        if (textInsertTypes.indexOf(e.inputType) === -1) {
            // 粘贴累积期间出现删除/其他编辑：先把已累积文本落盘，避免写入位置错乱
            if (batching) {
                flushBuffer();
            }
            return;
        }

        var text = '';
        if (e.dataTransfer && e.dataTransfer.getData('text/plain')) {
            text = e.dataTransfer.getData('text/plain');
        } else if (typeof e.data === 'string') {
            text = e.data;
        } else if (e.data !== null && e.data !== undefined) {
            text = String(e.data);
        }

        if (!text) return;

        // 如果正在累积其他元素，先 flush
        if (batching && pasteTarget && pasteTarget !== target) {
            flushBuffer();
        }

        // 策略 A: 单次大文本直接拦截
        if (text.length >= 5000) {
            if (!batching) {
                batching = true;
                pasteTarget = target;
                pasteStartPos = target.selectionStart;
                textParts = [];
            }

            textParts.push(text);
            textAccumLen += text.length;
            e.preventDefault();

            // 单段大文本保持 100ms 即时；同一批里已有多段、或 250ms 内刚 flush 过
            // 大文本（真·连续分段流），才按累积量延长合并窗口。
            // 窗口刻意收紧：手动一次一次地重复粘贴（间隔远大于 250ms）不受影响。
            var delay = 100;
            if (textParts.length > 1 || Date.now() - lastBigFlushAt < 250) {
                delay = getFlushDelay();
            }
            clearTimeout(flushTimer);
            flushTimer = setTimeout(flushBuffer, delay);
            return;
        }

        // 策略 B: 多段粘贴频率检测
        var now = Date.now();
        burstTimestamps.push(now);
        if (text.length > 3) hasSubstantialText = true;

        while (burstTimestamps.length > 0 && now - burstTimestamps[0] > 200) {
            burstTimestamps.shift();
        }

        if (burstTimestamps.length >= 3 && hasSubstantialText) {
            if (!batching) {
                batching = true;
                pasteTarget = target;
                pasteStartPos = target.selectionStart;
                textParts = [];
                currentTimeout = 300;
            }

            textParts.push(text);
            textAccumLen += text.length;
            e.preventDefault();

            currentTimeout = Math.min(currentTimeout * 2, 2000);
            clearTimeout(flushTimer);
            flushTimer = setTimeout(flushBuffer, Math.max(currentTimeout, getFlushDelay()));
        } else {
            // 策略 C: 正常放行
            if (batching) {
                flushBuffer();
            }
        }
    }

    /**
     * input 事件处理器（document capture 阶段）—— 安全网
     * 处理绕过 beforeinput 的场景
     */
    var lastValueLength = 0;
    var lastInputTarget = null;
    var batchTimer = null;

    function onInputCapture(e) {
        var target = e.target;
        if (!isEditable(target)) return;
        if (batching) return;

        // 不同元素，重置 lastValueLength
        if (target !== lastInputTarget) {
            lastInputTarget = target;
            lastValueLength = target.value.length;
        }

        var currentLength = target.value.length;
        var delta = Math.abs(currentLength - lastValueLength);

        if (delta < 20) {
            lastValueLength = currentLength;
            return;
        }

        e.stopImmediatePropagation();
        clearTimeout(batchTimer);
        batchTimer = setTimeout(function () {
            lastValueLength = target.value.length;
            target.dispatchEvent(new Event('input', { bubbles: true }));
        }, 250);
    }

    document.addEventListener('beforeinput', onBeforeInputCapture, true);
    document.addEventListener('input', onInputCapture, true);

    function destroy() {
        clearTimeout(flushTimer);
        clearTimeout(batchTimer);
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (pasteTarget) pasteTarget.style.visibility = '';
        document.removeEventListener('beforeinput', onBeforeInputCapture, true);
        document.removeEventListener('input', onInputCapture, true);
        window.__pastePerformanceFixInstalled__ = false;
    }

    window.addEventListener('beforeunload', destroy);
    window.__pastePerformanceFixDestroy__ = destroy;

    mfiLog('[MobileFocus] 模块 B 粘贴性能优化就绪');
}

// ============================================================
// 模块 C: Token Counter 分词高亮渲染优化（桌面/移动通用）
// ============================================================
// 问题：ST 内置 Token Counter 每次输入都会为每个 token 生成一个带背景色的
// <code> 元素；几万个小元素一次性插入会触发数十秒的样式/布局/绘制，
// 导致粘贴长文本后页面假死（桌面端、移动端均存在）。
// 方案：透明拦截 appendChild/insertBefore，把插入 #tokenized_chunks_display
// 的 code/br 改挂到「content-visibility 分组」中，让浏览器跳过视口外内容
// 的渲染。不改 ST 源码、不丢任何高亮、文字仍可选中。
// 额外处理：
//  - 首屏最多渲染 INITIAL_LIMIT 个分词块，超出部分暂存记录并显示
//    「继续加载」按钮，点击后按 LOAD_MORE_STEP 分批、逐帧渐进挂载，
//    功能不阉割；禁用滚动锚定避免插入内容时浏览器反复调整滚动位置
//  - 渲染完成后实测分组高度写入 --tc-group-h，作为 contain-intrinsic-size
//    的估计值，避免滚动时 scrollHeight 漂移导致滚动条/内容跳动
//  - 限制输入框与 ID 文本框高度（field-sizing 会把 100K 文本撑到数百像素，
//    真机滚动穿过超大 textarea 时布局/绘制成本很高）
// 实测：100K 字符（约 2 万个 token）主线程阻塞 13.2s -> 1.6s；
// 滚动高度漂移从 +62% 降到接近 0。

function initTokenCounterRenderFix() {
    if (window.__tokenCounterRenderFixInstalled__) {
        return;
    }
    window.__tokenCounterRenderFixInstalled__ = true;

    try {
        var GROUP_SIZE = 30;            // 每个分组容纳的 code 数量
        var INITIAL_LIMIT = 10000;      // 首屏渲染上限（超出后等用户点「继续加载」）
        var LOAD_MORE_STEP = 10000;     // 每次继续加载的分词块数量
        var HEIGHT_MEASURE_DELAY = 60;  // 渲染结束后延迟测量分组高度（毫秒）

        var displayEl = null;      // 缓存 #tokenized_chunks_display
        var currentGroup = null;   // 当前正在填充的分组
        var groupCodeCount = 0;    // 当前分组内 code 数量
        var totalCodeCount = 0;    // 本轮渲染已挂载的 code 数量
        var pendingChunks = [];    // 超出上限后暂存的分词记录（继续加载用）
        var loadMoreBtn = null;    // 「继续加载」按钮容器
        var loadingMore = false;   // 是否正在渐进加载中
        var loadMoreRaf = null;    // 渐进加载的 rAF id
        var heightTimer = null;    // 分组高度测量定时器
        var btnTimer = null;       // 按钮文本最终刷新定时器

        var originalAppendChild = Node.prototype.appendChild;
        var originalInsertBefore = Node.prototype.insertBefore;
        var styleEl = null;

        /** 获取目标容器；引用失效时重新查找（弹窗每次打开都会新建） */
        function getDisplay() {
            if (displayEl && displayEl.isConnected) {
                return displayEl;
            }
            displayEl = document.getElementById('tokenized_chunks_display');
            return displayEl;
        }

        /** 本轮渲染若刚被 empty() 清空，则重置计数与暂存 */
        function resetIfFreshRender(disp) {
            if (disp.children.length === 0) {
                totalCodeCount = 0;
                pendingChunks = [];
                loadMoreBtn = null;
                currentGroup = null;
                groupCodeCount = 0;
            }
        }

        /** 创建/复用当前分组（分组自身走原始方法，避免递归；有按钮时插到按钮前） */
        function ensureGroup(disp) {
            if (currentGroup && currentGroup.isConnected) {
                return currentGroup;
            }
            currentGroup = document.createElement('div');
            currentGroup.className = 'tc-cv-group';
            if (loadMoreBtn && loadMoreBtn.isConnected) {
                originalInsertBefore.call(disp, currentGroup, loadMoreBtn);
            } else {
                originalAppendChild.call(disp, currentGroup);
            }
            groupCodeCount = 0;
            scheduleHeightMeasure(disp);
            return currentGroup;
        }

        /** 把一条暂存的分词记录挂到分组（继续加载用） */
        function attachRecord(disp, rec) {
            if (groupCodeCount >= GROUP_SIZE) {
                currentGroup = null;
            }
            var group = ensureGroup(disp);
            if (rec.type === 'code') {
                var code = document.createElement('code');
                code.textContent = rec.text;
                code.title = String(rec.id);
                if (rec.color) {
                    code.style.backgroundColor = rec.color;
                }
                originalAppendChild.call(group, code);
                groupCodeCount++;
                totalCodeCount++;
            } else {
                originalAppendChild.call(group, document.createElement('br'));
            }
        }

        /** 创建/更新「继续加载」按钮 */
        function updateLoadMoreButton(disp) {
            var remaining = 0;
            for (var i = 0; i < pendingChunks.length; i++) {
                if (pendingChunks[i].type === 'code') {
                    remaining++;
                }
            }

            if (remaining <= 0) {
                if (loadMoreBtn && loadMoreBtn.isConnected) {
                    loadMoreBtn.parentNode.removeChild(loadMoreBtn);
                }
                loadMoreBtn = null;
                return;
            }

            if (!loadMoreBtn || !loadMoreBtn.isConnected) {
                loadMoreBtn = document.createElement('div');
                loadMoreBtn.className = 'tc-cv-load-more';
                originalAppendChild.call(disp, loadMoreBtn);
            }

            var btn = loadMoreBtn.querySelector('.tc-cv-load-more-btn');
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tc-cv-load-more-btn';
                btn.addEventListener('click', function () {
                    loadMore(disp);
                });
                loadMoreBtn.appendChild(btn);
            }

            var step = Math.min(LOAD_MORE_STEP, remaining);
            btn.disabled = false;
            btn.textContent = '继续加载 ' + step + ' 个分词块（剩余 ' + remaining + ' 个）';
        }

        /**
         * 点击「继续加载」：按固定步长渐进挂载。
         * 一次点击的目标是 LOAD_MORE_STEP 个分词块，但通过 rAF 把工作拆到多帧
         * （每帧约 16ms），避免同步插入大量元素时因滚动锚定/布局绘制造成长时间卡顿。
         */
        function loadMore(disp) {
            if (loadingMore) {
                return;
            }
            loadingMore = true;
            if (loadMoreBtn && loadMoreBtn.isConnected) {
                var curBtn = loadMoreBtn.querySelector('.tc-cv-load-more-btn');
                if (curBtn) {
                    curBtn.disabled = true;
                    curBtn.textContent = '加载中…';
                }
            }

            var loaded = 0;

            function step() {
                try {
                    var start = performance.now();
                    while (pendingChunks.length > 0 && loaded < LOAD_MORE_STEP) {
                        var rec = pendingChunks.shift();
                        if (rec.type === 'code') {
                            loaded++;
                        }
                        attachRecord(disp, rec);
                        // 每帧限时：到点就让出主线程，下一帧继续
                        if (performance.now() - start >= 16) {
                            break;
                        }
                    }

                    if (pendingChunks.length > 0 && loaded < LOAD_MORE_STEP) {
                        loadMoreRaf = requestAnimationFrame(step);
                    } else {
                        loadingMore = false;
                        loadMoreRaf = null;
                        updateLoadMoreButton(disp);
                    }
                } catch (err) {
                    // 防御：任何意外异常都恢复按钮状态，避免卡在「加载中…」
                    loadingMore = false;
                    loadMoreRaf = null;
                    try {
                        updateLoadMoreButton(disp);
                    } catch (e) { /* 忽略 */ }
                    console.warn('[MobileFocus] 模块 C 继续加载异常：', err);
                }
            }

            loadMoreRaf = requestAnimationFrame(step);
        }

        /** 渲染任务结束后刷新按钮上的剩余数字（期间文本更新无意义，因为任务未结束不绘制） */
        function scheduleButtonFinalize(disp) {
            clearTimeout(btnTimer);
            btnTimer = setTimeout(function () {
                btnTimer = null;
                if (loadMoreBtn && loadMoreBtn.isConnected) {
                    updateLoadMoreButton(disp);
                }
            }, 100);
        }

        /** 渲染结束后实测分组高度，写入 CSS 变量消除滚动漂移 */
        function scheduleHeightMeasure(disp) {
            clearTimeout(heightTimer);
            heightTimer = setTimeout(function () {
                heightTimer = null;
                var first = disp.querySelector('.tc-cv-group');
                if (!first) {
                    return;
                }
                // 强制按真实内容布局一次（30 个元素，开销极小），避免拿到估算高度
                var prev = first.style.contentVisibility;
                first.style.contentVisibility = 'visible';
                var h = first.getBoundingClientRect().height;
                first.style.contentVisibility = prev;
                if (h > 0) {
                    disp.style.setProperty('--tc-group-h', Math.ceil(h) + 'px');
                }
            }, HEIGHT_MEASURE_DELAY);
        }

        /** 把 token-counter 的插入改挂到分组 */
        function routeToGroup(disp, child) {
            // 分组/按钮自身直接挂载，避免递归
            if (child.nodeType === 1 && (child === currentGroup || child === loadMoreBtn || child.className === 'tc-cv-group' || child.className === 'tc-cv-load-more')) {
                return originalAppendChild.call(disp, child);
            }

            resetIfFreshRender(disp);

            // 未知元素保持原样，不改变其原有结构
            if (child.nodeType !== 1 || (child.tagName !== 'CODE' && child.tagName !== 'BR')) {
                return originalAppendChild.call(disp, child);
            }

            // 首屏上限：超过后暂存记录，显示「继续加载」按钮
            if (totalCodeCount >= INITIAL_LIMIT) {
                if (child.tagName === 'CODE') {
                    pendingChunks.push({
                        type: 'code',
                        text: child.textContent,
                        id: child.getAttribute('title'),
                        color: child.style.backgroundColor || '',
                    });
                } else {
                    pendingChunks.push({ type: 'br' });
                }
                if (pendingChunks.length === 1) {
                    updateLoadMoreButton(disp);
                }
                scheduleButtonFinalize(disp);
                return child; // 保持 appendChild 返回子节点的约定
            }

            // 当前分组已满则换新组
            if (groupCodeCount >= GROUP_SIZE) {
                currentGroup = null;
            }
            var group = ensureGroup(disp);
            if (child.tagName === 'CODE') {
                groupCodeCount++;
                totalCodeCount++;
            }
            return originalAppendChild.call(group, child);
        }

        var patchedAppendChild = function (child) {
            var disp = getDisplay();
            if (this === disp) {
                return routeToGroup(disp, child);
            }
            return originalAppendChild.call(this, child);
        };

        var patchedInsertBefore = function (child, ref) {
            var disp = getDisplay();
            if (this === disp) {
                // token-counter 只做顺序追加，这里同样按分组处理
                return routeToGroup(disp, child);
            }
            return originalInsertBefore.call(this, child, ref);
        };

        Node.prototype.appendChild = patchedAppendChild;
        Node.prototype.insertBefore = patchedInsertBefore;

        // 注入分组与提示样式（原 #tokenized_chunks_display > code 选择器
        // 对嵌套在分组内的 code 失效，需要复制一份样式）
        styleEl = document.createElement('style');
        styleEl.id = 'mfi-tc-cv-style';
        styleEl.textContent = '' +
            '#tokenized_chunks_display {' +
            '  overflow-anchor: none;' +
            '}' +
            // 继续加载时若不禁用滚动锚定，浏览器会把视口下方的文本框等当作锚点，
            // 每插入一批内容就微调一次滚动位置，导致文本框内容抖动
            '.popup-content:has(#tokenized_chunks_display) {' +
            '  overflow-anchor: none;' +
            '}' +
            '#tokenized_chunks_display .tc-cv-group {' +
            '  content-visibility: auto;' +
            '  contain-intrinsic-size: var(--tc-group-h, 40px);' +
            '}' +
            '#tokenized_chunks_display .tc-cv-group > code {' +
            '  color: black;' +
            '  text-shadow: none;' +
            '  padding: 2px;' +
            '  display: inline-block;' +
            '}' +
            '#tokenized_chunks_display .tc-cv-load-more {' +
            '  padding: 8px 2px;' +
            '  text-align: center;' +
            '}' +
            '#tokenized_chunks_display .tc-cv-load-more .tc-cv-load-more-btn {' +
            '  cursor: pointer;' +
            '  padding: 6px 14px;' +
            '  font-size: 14px;' +
            // 跟随 ST 主题：面板/气泡底色 + 正文文字色 + 边框色（与 .menu_button 一致）
            '  color: var(--SmartThemeBodyColor);' +
            '  background-color: var(--SmartThemeBlurTintColor);' +
            '  border: 1px solid var(--SmartThemeBorderColor);' +
            '  border-radius: 5px;' +
            '}' +
            '#tokenized_chunks_display .tc-cv-load-more .tc-cv-load-more-btn:hover:not(:disabled) {' +
            '  background-color: var(--white30a);' +
            '}' +
            '#tokenized_chunks_display .tc-cv-load-more .tc-cv-load-more-btn:disabled {' +
            '  opacity: .6;' +
            '  cursor: default;' +
            '}' +
            // 超大文本时输入框与 ID 框会被 field-sizing 撑到数百像素高，
            // 滚动穿过 textarea 的布局/绘制成本很高，限制高度让其内部滚动
            '#token_counter_textarea,' +
            '#token_counter_ids {' +
            '  max-height: 25vh;' +
            '  overflow-y: auto;' +
            '}';
        (document.head || document.documentElement).appendChild(styleEl);

        function destroy() {
            clearTimeout(heightTimer);
            clearTimeout(btnTimer);
            if (loadMoreRaf !== null) {
                cancelAnimationFrame(loadMoreRaf);
                loadMoreRaf = null;
            }
            if (Node.prototype.appendChild === patchedAppendChild) {
                Node.prototype.appendChild = originalAppendChild;
            }
            if (Node.prototype.insertBefore === patchedInsertBefore) {
                Node.prototype.insertBefore = originalInsertBefore;
            }
            if (styleEl && styleEl.parentNode) {
                styleEl.parentNode.removeChild(styleEl);
            }
            window.__tokenCounterRenderFixInstalled__ = false;
        }

        window.addEventListener('beforeunload', destroy);
        window.__tokenCounterRenderFixDestroy__ = destroy;

        mfiLog('[MobileFocus] 模块 C Token Counter 渲染优化就绪');
    } catch (err) {
        // fail-open：任何异常都不影响插件其它模块与 ST 本身
        console.warn('[MobileFocus] 模块 C Token Counter 渲染优化初始化失败：', err);
        window.__tokenCounterRenderFixInstalled__ = false;
    }
}

// ============================================================
// 模块 D: ST 原生 :has() 样式失效修复（桌面/移动通用）
// ============================================================
// ST 主样式表中的这条规则会在抽屉/弹窗交互后被浏览器反复用于整页
// 样式失效判断；即使规则当前没有命中，也会让 class 变化触发大范围
// UpdateLayoutTree，表现为打开世界书/扩展管理后键盘收起越来越卡。
//
// 方案：只从主 style.css 的 CSSOM 中删除这一条精确规则，并用 JS 内联
//       z-index 复刻它原本的视觉行为。匹配不到、样式表被替换或 CSSOM
//       不可访问时 fail-open；样式表替换后由 head 观察器重新扫描。

function initNativeHasInvalidationFix() {
    if (window.__nativeHasInvalidationFixInstalled__) {
        return;
    }
    window.__nativeHasInvalidationFixInstalled__ = true;

    var TARGET_SELECTOR = [
        'body:has(.drawer-content.maximized) #top-settings-holder:has(.drawer-content.openDrawer:not(.fillLeft):not(.fillRight))',
        'body:has(.drawer-content.open) #top-settings-holder:has(.drawer-content.openDrawer:not(.fillLeft):not(.fillRight))',
        'body:has(#character_popup.open) #top-settings-holder:has(.drawer-content.openDrawer:not(.fillLeft):not(.fillRight))',
    ].join(', ');
    var TARGET_Z_INDEX = '4005';

    var patchedRules = [];
    var patchedRuleKeys = new WeakMap();
    var headObserver = null;
    var stateObserver = null;
    var observedStateTargets = new WeakSet();
    var scanTimer = null;
    var scanRetryTimer = null;
    var scanRetries = 0;
    var destroyed = false;
    var managedHolder = null;
    var originalInlineZIndex = null;
    var inlineManaged = false;
    var patchActive = false;

    var mainStyleUrl = null;
    try {
        mainStyleUrl = new URL('style.css', document.baseURI);
    } catch (err) {
        // URL 解析失败时保持 fail-open
        window.__nativeHasInvalidationFixInstalled__ = false;
        return;
    }

    function normalizeSelectorText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            .trim();
    }

    var normalizedTargetSelector = normalizeSelectorText(TARGET_SELECTOR);

    function isMainStyleSheet(sheet) {
        var owner = sheet && sheet.ownerNode;
        if (!owner || owner.nodeType !== 1 || owner.tagName !== 'LINK') {
            return false;
        }

        var isStylesheet = owner.relList && typeof owner.relList.contains === 'function'
            ? owner.relList.contains('stylesheet')
            : owner.rel === 'stylesheet';
        if (!isStylesheet) {
            return false;
        }

        try {
            var resolved = new URL(owner.href || owner.getAttribute('href') || '', document.baseURI);
            return resolved.origin === mainStyleUrl.origin && resolved.pathname === mainStyleUrl.pathname;
        } catch (err) {
            return false;
        }
    }

    function isTargetRule(rule) {
        if (!rule || rule.type !== 1 || typeof rule.selectorText !== 'string' || !rule.style) {
            return false;
        }

        return normalizeSelectorText(rule.selectorText) === normalizedTargetSelector &&
            rule.style.length === 1 &&
            rule.style.getPropertyValue('z-index') === TARGET_Z_INDEX &&
            rule.style.getPropertyPriority('z-index') === '';
    }

    function collectTargetRules(ruleList, owner, found) {
        for (var i = 0; i < ruleList.length; i++) {
            var rule = ruleList[i];
            if (isTargetRule(rule)) {
                found.push({
                    owner: owner,
                    index: i,
                    cssText: rule.cssText,
                });
                continue;
            }

            // 兼容未来 ST 把规则包进 @media/@supports/@container 的情况。
            if (rule && rule.cssRules && rule.cssRules.length) {
                collectTargetRules(rule.cssRules, rule, found);
            }
        }
    }

    function getPatchedRuleKeys(sheet) {
        var keys = patchedRuleKeys.get(sheet);
        if (!keys) {
            keys = new Set();
            patchedRuleKeys.set(sheet, keys);
        }
        return keys;
    }

    function ruleKey(item) {
        return item.index + '|' + item.cssText;
    }

    function patchFoundRules(sheet, found) {
        var byOwner = [];
        var ownerMap = new Map();
        var patchedKeys = getPatchedRuleKeys(sheet);

        found.forEach(function (item) {
            var key = ruleKey(item);
            if (patchedKeys.has(key)) {
                return;
            }
            var bucket = ownerMap.get(item.owner);
            if (!bucket) {
                bucket = [];
                ownerMap.set(item.owner, bucket);
                byOwner.push(bucket);
            }
            bucket.push(item);
        });

        byOwner.forEach(function (items) {
            // 先删后面的规则，避免删除导致前面的索引移位。
            items.slice().sort(function (a, b) {
                return b.index - a.index;
            }).forEach(function (item) {
                try {
                    item.owner.deleteRule(item.index);
                    patchedKeys.add(ruleKey(item));
                    patchedRules.push({
                        sheet: sheet,
                        owner: item.owner,
                        index: item.index,
                        cssText: item.cssText,
                    });
                } catch (err) {
                    // 单条删除失败不影响其它规则，保持 fail-open。
                }
            });
        });
    }

    function restorePatchedRules() {
        var rules = patchedRules.slice().sort(function (a, b) {
            return a.index - b.index;
        });
        patchedRules = [];
        patchedRuleKeys = new WeakMap();
        patchActive = false;

        rules.forEach(function (item) {
            if (!item.sheet || !item.sheet.ownerNode || !item.sheet.ownerNode.isConnected) {
                return;
            }
            try {
                var ownerRules = item.owner.cssRules;
                var index = Math.min(item.index, ownerRules.length);
                item.owner.insertRule(item.cssText, index);
            } catch (err) {
                // 页面已离开或样式表已重建时无需强行恢复。
            }
        });
    }

    function isStateElement(element) {
        return !!(element && element.nodeType === 1 &&
            element.matches &&
            element.matches('.drawer-content, #character_popup'));
    }

    function containsStateElement(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }
        if (node.matches && node.matches('.drawer-content, #character_popup, #top-settings-holder, #movingDivs')) {
            return true;
        }
        return !!(node.querySelector && node.querySelector('.drawer-content, #character_popup, #top-settings-holder, #movingDivs'));
    }

    function restoreManagedInline() {
        if (!managedHolder || !inlineManaged) {
            return;
        }

        if (originalInlineZIndex && originalInlineZIndex.value) {
            managedHolder.style.setProperty('z-index', originalInlineZIndex.value, originalInlineZIndex.priority);
        } else {
            managedHolder.style.removeProperty('z-index');
        }
        inlineManaged = false;
    }

    function updateTopSettingsZIndex() {
        if (!patchActive) {
            restoreManagedInline();
            return;
        }

        var holder = document.getElementById('top-settings-holder');
        if (!holder) {
            restoreManagedInline();
            managedHolder = null;
            originalInlineZIndex = null;
            return;
        }

        if (holder !== managedHolder) {
            restoreManagedInline();
            managedHolder = holder;
            originalInlineZIndex = {
                value: holder.style.getPropertyValue('z-index'),
                priority: holder.style.getPropertyPriority('z-index'),
            };
            inlineManaged = false;
        }

        var hasOpenDrawer = holder.querySelector('.drawer-content.openDrawer:not(.fillLeft):not(.fillRight)');
        var body = document.body;
        var shouldRaise = !!(hasOpenDrawer && body &&
            body.querySelector('.drawer-content.maximized, .drawer-content.open, #character_popup.open'));

        if (shouldRaise) {
            var currentValue = holder.style.getPropertyValue('z-index');
            // 若页面本来就有外部内联 z-index，原 CSS 规则同样无法覆盖它，
            // 这里也不应擅自改写。
            if (!inlineManaged && currentValue !== '' && currentValue !== TARGET_Z_INDEX) {
                return;
            }
            inlineManaged = true;
            holder.style.setProperty('z-index', TARGET_Z_INDEX);
        } else {
            restoreManagedInline();
        }
    }

    function observeStateTarget(element, options) {
        if (!element || observedStateTargets.has(element)) {
            return;
        }
        observedStateTargets.add(element);
        try {
            stateObserver.observe(element, options);
        } catch (err) {
            // 忽略不可观察的节点。
        }
    }

    function bindStateObservers() {
        if (destroyed || !stateObserver) {
            return;
        }

        var holder = document.getElementById('top-settings-holder');
        var movingDivs = document.getElementById('movingDivs');

        observeStateTarget(holder, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class'],
        });
        observeStateTarget(movingDivs, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class'],
        });
        observeStateTarget(document.body, { childList: true });

        Array.prototype.forEach.call(document.querySelectorAll('.drawer-content, #character_popup'), function (element) {
            if ((holder && holder.contains(element)) || (movingDivs && movingDivs.contains(element))) {
                return;
            }
            observeStateTarget(element, {
                attributes: true,
                attributeFilter: ['class'],
            });
        });
    }

    function onStateMutations(mutations) {
        var relevant = false;
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (mutation.type === 'attributes') {
                if (isStateElement(mutation.target)) {
                    relevant = true;
                    break;
                }
                continue;
            }

            if (mutation.type === 'childList') {
                var j;
                for (j = 0; j < mutation.addedNodes.length; j++) {
                    if (containsStateElement(mutation.addedNodes[j])) {
                        relevant = true;
                        break;
                    }
                }
                if (relevant) {
                    break;
                }
                for (j = 0; j < mutation.removedNodes.length; j++) {
                    if (containsStateElement(mutation.removedNodes[j])) {
                        relevant = true;
                        break;
                    }
                }
                if (relevant) {
                    break;
                }
            }
        }

        if (relevant) {
            bindStateObservers();
            updateTopSettingsZIndex();
        }
    }

    function scanAndPatch() {
        if (destroyed) {
            return;
        }

        var sheets = Array.prototype.slice.call(document.styleSheets || []);
        var mainSheetReady = false;
        var targetHandled = false;

        sheets.forEach(function (sheet) {
            if (!isMainStyleSheet(sheet)) {
                return;
            }
            var rules;
            try {
                rules = sheet.cssRules;
            } catch (err) {
                return;
            }

            if (!rules || rules.length === 0) {
                if (sheet.ownerNode && sheet.ownerNode.addEventListener) {
                    sheet.ownerNode.addEventListener('load', scheduleScan, { once: true });
                }
                return;
            }
            mainSheetReady = true;

            var found = [];
            collectTargetRules(rules, sheet, found);
            if (found.length > 0) {
                patchFoundRules(sheet, found);
                targetHandled = true;
                return;
            }

            // 已经打过补丁的 sheet 再次扫描时目标本来就不存在。
            if (patchedRules.some(function (item) {
                return item.sheet === sheet;
            })) {
                targetHandled = true;
                return;
            }
        });

        if (mainSheetReady) {
            scanRetries = 0;
        } else {
            // link 已插入 DOM 但尚未登记进 document.styleSheets 时，
            // 用有界重试兜底；load 事件仍会正常触发下一次扫描。
            patchActive = false;
            restoreManagedInline();
            scheduleScanRetry();
            return;
        }

        if (!targetHandled) {
            patchActive = false;
            restoreManagedInline();
            return;
        }

        patchActive = true;
        bindStateObservers();
        updateTopSettingsZIndex();
    }

    function scheduleScan() {
        if (destroyed || scanTimer !== null) {
            return;
        }
        scanTimer = setTimeout(function () {
            scanTimer = null;
            scanAndPatch();
        }, 0);
    }

    function scheduleScanRetry() {
        if (destroyed || scanRetryTimer !== null || scanRetries >= 12) {
            return;
        }
        scanRetries++;
        scanRetryTimer = setTimeout(function () {
            scanRetryTimer = null;
            scheduleScan();
        }, 50);
    }

    function isStylesheetLink(node) {
        if (!node || node.nodeType !== 1 || node.tagName !== 'LINK') {
            return false;
        }
        var isStylesheet = node.relList && typeof node.relList.contains === 'function'
            ? node.relList.contains('stylesheet')
            : node.rel === 'stylesheet';
        return isStylesheet;
    }

    function onHeadMutations(mutations) {
        var relevant = false;
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (mutation.type === 'attributes') {
                if (isStylesheetLink(mutation.target)) {
                    relevant = true;
                    break;
                }
                continue;
            }

            if (mutation.type === 'childList') {
                var j;
                for (j = 0; j < mutation.addedNodes.length; j++) {
                    var added = mutation.addedNodes[j];
                    if (isStylesheetLink(added) && added.addEventListener) {
                        added.addEventListener('load', scheduleScan, { once: true });
                    }
                    if (isStylesheetLink(added) || (added.querySelector && added.querySelector('link[rel~="stylesheet"]'))) {
                        relevant = true;
                        break;
                    }
                }
                if (relevant) {
                    break;
                }
                for (j = 0; j < mutation.removedNodes.length; j++) {
                    var removed = mutation.removedNodes[j];
                    if (isStylesheetLink(removed) || (removed.querySelector && removed.querySelector('link[rel~="stylesheet"]'))) {
                        relevant = true;
                        break;
                    }
                }
                if (relevant) {
                    break;
                }
            }
        }

        if (relevant) {
            scheduleScan();
        }
    }

    stateObserver = new MutationObserver(onStateMutations);
    bindStateObservers();
    scanAndPatch();

    headObserver = new MutationObserver(onHeadMutations);
    headObserver.observe(document.head || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'rel'],
    });

    function destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;

        if (scanTimer !== null) {
            clearTimeout(scanTimer);
            scanTimer = null;
        }
        if (scanRetryTimer !== null) {
            clearTimeout(scanRetryTimer);
            scanRetryTimer = null;
        }
        if (headObserver) {
            headObserver.disconnect();
            headObserver = null;
        }
        if (stateObserver) {
            stateObserver.disconnect();
            stateObserver = null;
        }

        restorePatchedRules();
        restoreManagedInline();
        patchActive = false;
        managedHolder = null;
        originalInlineZIndex = null;
        window.__nativeHasInvalidationFixInstalled__ = false;
    }

    window.addEventListener('beforeunload', destroy);
    window.__nativeHasInvalidationFixDestroy__ = destroy;
    mfiLog('[MobileFocus] 模块 D ST 原生 :has 样式失效修复就绪');
}

// ============================================================
// 模块 E: 外部小窗键盘布局冻结（仅移动端）
// ============================================================
// 真机数据（Android Chrome 152）：
//   正常：innerHeight=695，100dvh=695.71，100lvh=751.71
//   外部小窗键盘弹出：innerHeight=361，100dvh=361.71，100lvh=417.71
//
// 连 lvh 都一起缩小，说明 Android 确实缩小了布局视口，而不是只改 dvh。
// ST 的 viewport meta 使用 interactive-widget=resizes-content，因此
// body/#sheld/#chat 会跟着键盘开合变化。不能直接改 meta，否则 ST 自己
// 的输入框也会被键盘遮住。
//
// 方案：检测「ST 输入框未聚焦，或刚切出 ST 后输入框仍保留 DOM 焦点时，
//       布局视口骤减」后，用像素高度临时冻结 body/#sheld/#chat；回到 ST
//       点击输入框前解除，保留 ST 自身键盘的原生 resizes-content 行为。
//       样式表、事件和状态都只在本模块内管理，异常时 fail-open。

function initExternalKeyboardViewportFix() {
    if (window.__externalKeyboardViewportFixInstalled__) {
        return;
    }

    if (!isMobile()) {
        mfiLog('[MobileFocus] 模块 E 跳过：仅移动端启用');
        return;
    }

    var MIN_KEYBOARD_SHRINK = 120;
    var RESTORE_TOLERANCE = 12;
    var BASELINE_RETRY_MS = 600;
    var EXTERNAL_CONTEXT_MS = 15000;

    var baseline = null;
    var frozen = false;
    var styleEl = null;
    var resetTimer = null;
    var initialBaselineTimer = null;
    var lastBlurAt = 0;
    var destroyed = false;

    function isEditable(element) {
        return !!(
            element && (
                element.tagName === 'INPUT' ||
                element.tagName === 'TEXTAREA' ||
                element.tagName === 'SELECT' ||
                element.isContentEditable
            )
        );
    }

    function measureLayout() {
        var body = document.body;
        var sheld = document.getElementById('sheld');
        var chat = document.getElementById('chat');

        if (!body || !sheld || !chat) {
            return null;
        }

        return {
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            bodyH: body.getBoundingClientRect().height,
            sheldH: sheld.getBoundingClientRect().height,
            chatH: chat.getBoundingClientRect().height,
            orientation: screen.orientation ? screen.orientation.type : '',
            screenW: screen.width,
            screenH: screen.height,
        };
    }

    function ensureStyle() {
        if (styleEl) {
            return;
        }

        styleEl = document.createElement('style');
        styleEl.id = 'mfi-external-kb-freeze-style';
        styleEl.textContent = [
            'html.mfi-external-kb-freeze body {',
            '    height: var(--mfi-external-kb-body-h) !important;',
            '}',
            'html.mfi-external-kb-freeze #sheld {',
            '    height: var(--mfi-external-kb-sheld-h) !important;',
            '    max-height: var(--mfi-external-kb-sheld-h) !important;',
            '}',
            'html.mfi-external-kb-freeze #chat {',
            '    height: var(--mfi-external-kb-chat-h) !important;',
            '    max-height: var(--mfi-external-kb-chat-h) !important;',
            '}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(styleEl);
    }

    function setBaseline() {
        var measured = measureLayout();
        if (!measured || measured.bodyH <= 0 || measured.sheldH <= 0 || measured.chatH <= 0) {
            return false;
        }

        baseline = measured;
        return true;
    }

    function applyFreeze(reason) {
        if (destroyed || frozen) {
            return;
        }
        if (!baseline && !setBaseline()) {
            return;
        }

        ensureStyle();
        var root = document.documentElement;
        root.style.setProperty('--mfi-external-kb-body-h', baseline.bodyH + 'px');
        root.style.setProperty('--mfi-external-kb-sheld-h', baseline.sheldH + 'px');
        root.style.setProperty('--mfi-external-kb-chat-h', baseline.chatH + 'px');
        root.classList.add('mfi-external-kb-freeze');
        frozen = true;

        mfiDebug('[MobileFocus] 模块 E 外部小窗键盘布局冻结：', reason);
    }

    function releaseFreeze(reason) {
        if (!frozen) {
            return;
        }

        document.documentElement.classList.remove('mfi-external-kb-freeze');
        frozen = false;

        mfiDebug('[MobileFocus] 模块 E 外部小窗键盘布局恢复：', reason);
    }

    function scheduleBaselineReset(reason) {
        clearTimeout(resetTimer);
        releaseFreeze(reason);
        baseline = null;
        resetTimer = setTimeout(function () {
            resetTimer = null;
            if (destroyed) {
                return;
            }
            setBaseline();
            evaluateViewport('baseline-reset');
        }, BASELINE_RETRY_MS);
    }

    function evaluateViewport(reason) {
        if (destroyed) {
            return;
        }

        var measured = measureLayout();
        if (!measured) {
            return;
        }

        var screenChanged = baseline && (
            Math.abs(measured.screenW - baseline.screenW) > 50 ||
            Math.abs(measured.screenH - baseline.screenH) > 50
        );
        var widthChanged = baseline &&
            Math.abs(measured.viewportW - baseline.viewportW) > 50;
        var orientationChanged = baseline && measured.orientation &&
            baseline.orientation &&
            measured.orientation !== baseline.orientation;

        // 真正旋转屏幕时宽高会一起变化；外部键盘只会改变高度，不能把
        // 高度骤减误判成旋转。
        if (screenChanged && widthChanged && orientationChanged) {
            scheduleBaselineReset(reason + ':orientation');
            return;
        }

        if (!baseline) {
            setBaseline();
            return;
        }

        var shrink = baseline.viewportH - measured.viewportH;
        var editableActive = isEditable(document.activeElement);
        var externalContext = lastBlurAt > 0 && (Date.now() - lastBlurAt < EXTERNAL_CONTEXT_MS);
        var stInputFocused = editableActive && document.hasFocus() && !externalContext;

        // ST 自己的输入框聚焦且页面仍在 ST 前台时保持原生行为；
        // 若刚切出过 ST，则即使输入框仍是 DOM 焦点也按外部键盘处理。
        if (stInputFocused) {
            releaseFreeze(reason + ':st-input');
            return;
        }

        if (!frozen) {
            if (shrink >= MIN_KEYBOARD_SHRINK && (!editableActive || externalContext)) {
                applyFreeze(reason + ':shrink=' + Math.round(shrink));
            } else if (Math.abs(shrink) < RESTORE_TOLERANCE) {
                // 浏览器地址栏收展等小幅变化时更新基线，避免误判。
                setBaseline();
            }
            return;
        }

        if (measured.viewportH >= baseline.viewportH - RESTORE_TOLERANCE) {
            releaseFreeze(reason + ':restored');
        }
    }

    function onResize() {
        evaluateViewport('resize');
    }

    function onOrientationChange() {
        var measured = measureLayout();
        var screenChanged = !baseline || !measured || (
            Math.abs(measured.screenW - baseline.screenW) > 50 ||
            Math.abs(measured.screenH - baseline.screenH) > 50
        );
        var widthChanged = !baseline || !measured ||
            Math.abs(measured.viewportW - baseline.viewportW) > 50;

        if (screenChanged && widthChanged) {
            scheduleBaselineReset('orientationchange');
        }
    }

    function onWindowBlur() {
        lastBlurAt = Date.now();
        evaluateViewport('window-blur');
    }

    function onUserInteraction() {
        lastBlurAt = 0;
        evaluateViewport('user-interaction');
    }

    function onEditableInteraction() {
        releaseFreeze('editable-interaction');
    }

    function destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;

        clearTimeout(resetTimer);
        clearTimeout(initialBaselineTimer);
        releaseFreeze('destroy');

        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onOrientationChange);
        window.removeEventListener('blur', onWindowBlur);
        document.removeEventListener('pointerdown', onUserInteraction, true);
        document.removeEventListener('touchstart', onUserInteraction, true);
        document.removeEventListener('focusin', onUserInteraction, true);
        document.removeEventListener('pointerdown', onEditableEvent, true);
        document.removeEventListener('touchstart', onEditableEvent, true);
        document.removeEventListener('focusin', onEditableEvent, true);

        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', onResize);
        }

        if (styleEl && styleEl.parentNode) {
            styleEl.parentNode.removeChild(styleEl);
        }
        styleEl = null;

        var root = document.documentElement;
        root.classList.remove('mfi-external-kb-freeze');
        root.style.removeProperty('--mfi-external-kb-body-h');
        root.style.removeProperty('--mfi-external-kb-sheld-h');
        root.style.removeProperty('--mfi-external-kb-chat-h');

        baseline = null;
        window.__externalKeyboardViewportFixInstalled__ = false;
    }

    function onEditableEvent(event) {
        if (isEditable(event.target)) {
            onEditableInteraction();
        }
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onOrientationChange, { passive: true });
    window.addEventListener('blur', onWindowBlur, { passive: true });
    document.addEventListener('pointerdown', onUserInteraction, { passive: true, capture: true });
    document.addEventListener('touchstart', onUserInteraction, { passive: true, capture: true });
    document.addEventListener('focusin', onUserInteraction, { passive: true, capture: true });
    document.addEventListener('pointerdown', onEditableEvent, { passive: true, capture: true });
    document.addEventListener('touchstart', onEditableEvent, { passive: true, capture: true });
    document.addEventListener('focusin', onEditableEvent, { passive: true, capture: true });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onResize, { passive: true });
    }

    initialBaselineTimer = setTimeout(function () {
        initialBaselineTimer = null;
        if (destroyed) {
            return;
        }
        setBaseline();
        evaluateViewport('initial');
    }, 300);

    window.addEventListener('beforeunload', destroy);
    window.__externalKeyboardViewportFixDestroy__ = destroy;
    window.__externalKeyboardViewportFixInstalled__ = true;
    mfiLog('[MobileFocus] 模块 E 外部小窗键盘布局冻结就绪');
}

// ============================================================
// 扩展入口
// ============================================================

/** 启动全部模块，最后打印整体加载提示（关闭调试时控制台只有这一条） */
function startAllModules() {
    initMobileFocusInterceptor();
    initPastePerformanceFix();
    initTokenCounterRenderFix();
    initNativeHasInvalidationFix();
    initExternalKeyboardViewportFix();
    mfiLogLoaded();
}

function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAllModules);
    } else {
        startAllModules();
    }
}

if (typeof window !== 'undefined' && !window.ST_EXTENSION) {
    init();
}
