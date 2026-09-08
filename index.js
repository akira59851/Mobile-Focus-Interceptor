/* ============================================================
   移动端优化小工具 (Mobile-Focus-Interceptor) — 主逻辑模块（index.js）
   ============================================================ */

/* 说明（插件名 / 目录名保持 Mobile-Focus-Interceptor）：
   针对 SillyTavern 移动端痛点优化的前端插件，双端共有的问题也会顺手一并修复。

   模块 A：聚焦拦截（仅移动端）
           拦截主会话输入框的代码自动聚焦，只在用户主动点击时允许弹出键盘；
           拦截仅绑定到 #send_textarea 元素实例，不修改全局 focus 方法。
   模块 B：键盘粘贴卡顿修复（仅移动端）
           beforeinput 拦截 + visibility:hidden 抑制重绘，将分段粘贴合并为一次性渲染；
           合并窗口按文本量自适应，超大文本分段/重复粘贴不逐段整段重写。
   模块 C：Token Counter 分词高亮渲染优化（桌面/移动通用）
           透明拦截 appendChild/insertBefore + content-visibility 分组，
           解决大文本分词高亮渲染导致的页面假死；首屏上限 + 「继续加载」逐帧渐进渲染。
   ============================================================ */

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
        return;
    }

    var inputElements = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
    var patchedElement = null;
    var patchedElementRecord = null;
    var userFocusWindowMs = 1500;
    var lastUserFocusTarget = null;
    var lastUserFocusTime = 0;

    function isEditableElement(el) {
        return el instanceof HTMLElement && (
            inputElements.has(el.tagName) ||
            el.isContentEditable
        );
    }

    /**
     * Find the exact editable control activated by the user. composedPath() also
     * handles controls inside web components; label.control covers label taps.
     */
    function getUserFocusTarget(e) {
        var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        if (path.length === 0 && e.target) {
            path = [e.target];
        }

        for (var i = 0; i < path.length; i++) {
            var el = path[i];
            if (!(el instanceof HTMLElement)) continue;
            if (isEditableElement(el)) return el;
            if (el.tagName === 'LABEL' && isEditableElement(el.control)) {
                return el.control;
            }
        }

        return null;
    }

    function rememberUserFocusTarget(e) {
        // Synthetic events must not grant scripts permission to bypass the guard.
        if (e.isTrusted === false) return null;
        lastUserFocusTarget = getUserFocusTarget(e);
        lastUserFocusTime = lastUserFocusTarget ? Date.now() : 0;
        return lastUserFocusTarget;
    }

    function restoreDirectUserFocus(e) {
        var target = rememberUserFocusTarget(e);
        if (
            !target ||
            !shouldBlockAutomaticFocus(target)
        ) {
            return;
        }

        // Run the element's original focus method while the trusted click
        // gesture is still active. This recovers mobile taps whose browser
        // default focus was lost.
        callOriginalFocus(target);
    }

    document.addEventListener('touchstart', rememberUserFocusTarget, { passive: true, capture: true });
    document.addEventListener('pointerdown', rememberUserFocusTarget, { passive: true, capture: true });
    document.addEventListener('mousedown', rememberUserFocusTarget, { capture: true });
    document.addEventListener('click', restoreDirectUserFocus, { capture: true });

    function shouldBlockAutomaticFocus(el) {
        return el.id === 'send_textarea';
    }

    function wasDirectlyActivatedByUser(el) {
        return lastUserFocusTarget === el && Date.now() - lastUserFocusTime <= userFocusWindowMs;
    }

    function callOriginalFocus(el, options) {
        var focusMethod = patchedElementRecord && el === patchedElement && el.focus === patchedElementRecord.patchedFocus
            ? patchedElementRecord.originalFocus
            : el.focus;

        if (typeof focusMethod === 'function') {
            return focusMethod.call(el, options);
        }
        return undefined;
    }

    function patchElement(el) {
        if (!(el instanceof HTMLElement) || !shouldBlockAutomaticFocus(el) || el === patchedElement) {
            return;
        }

        var ownDescriptor = Object.getOwnPropertyDescriptor(el, 'focus');
        var originalFocus = el.focus;
        if (typeof originalFocus !== 'function') {
            return;
        }

        var patchedFocus = function (options) {
            if (
                this !== el ||
                !shouldBlockAutomaticFocus(el) ||
                wasDirectlyActivatedByUser(el)
            ) {
                return originalFocus.call(this, options);
            }

            if (!el.isConnected) {
                return originalFocus.call(el, options);
            }
            var computedStyle = window.getComputedStyle(el);
            if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
                return originalFocus.call(el, options);
            }

            return undefined;
        };

        try {
            Object.defineProperty(el, 'focus', {
                configurable: true,
                enumerable: ownDescriptor ? ownDescriptor.enumerable : false,
                writable: true,
                value: patchedFocus,
            });
            patchedElement = el;
            patchedElementRecord = {
                patchedFocus: patchedFocus,
                originalFocus: originalFocus,
                ownDescriptor: ownDescriptor,
            };
        } catch (err) {
            console.warn('[MobileFocus] 无法拦截目标输入框的 focus：', err);
        }
    }

    function restorePatchedElement() {
        if (!patchedElement || !patchedElementRecord) {
            return;
        }

        var el = patchedElement;
        var record = patchedElementRecord;
        try {
            // Do not overwrite a focus method installed later by another plugin.
            if (el.focus === record.patchedFocus) {
                if (record.ownDescriptor) {
                    Object.defineProperty(el, 'focus', record.ownDescriptor);
                } else {
                    delete el.focus;
                }
            }
        } catch (err) {
            console.warn('[MobileFocus] 无法恢复目标输入框的 focus：', err);
        }

        patchedElement = null;
        patchedElementRecord = null;
    }

    function syncTargetElement() {
        var currentTarget = document.getElementById('send_textarea');
        if (patchedElement && patchedElement !== currentTarget) {
            restorePatchedElement();
        }
        if (currentTarget && currentTarget !== patchedElement) {
            patchElement(currentTarget);
        }
    }

    syncTargetElement();

    var observer = new MutationObserver(syncTargetElement);

    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['id'],
        childList: true,
        subtree: true,
    });

    function destroy() {
        observer.disconnect();
        restorePatchedElement();
        document.removeEventListener('touchstart', rememberUserFocusTarget, { capture: true });
        document.removeEventListener('pointerdown', rememberUserFocusTarget, { capture: true });
        document.removeEventListener('mousedown', rememberUserFocusTarget, { capture: true });
        document.removeEventListener('click', restoreDirectUserFocus, { capture: true });
        window.removeEventListener('beforeunload', destroy);
        window.__mobileFocusInterceptorInstalled__ = false;
        if (window.__mobileFocusInterceptorDestroy__ === destroy) {
            delete window.__mobileFocusInterceptorDestroy__;
        }
    }

    window.addEventListener('beforeunload', destroy);
    window.__mobileFocusInterceptorDestroy__ = destroy;

    console.log('[MobileFocus] 聚焦拦截器就绪');
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

    console.log('[MobileFocus] 粘贴性能优化就绪');
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
                    console.warn('[MobileFocus] 继续加载异常：', err);
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

        console.log('[MobileFocus] Token Counter 渲染优化就绪');
    } catch (err) {
        // fail-open：任何异常都不影响插件其它模块与 ST 本身
        console.warn('[MobileFocus] Token Counter 渲染优化初始化失败：', err);
        window.__tokenCounterRenderFixInstalled__ = false;
    }
}

// ============================================================
// 扩展入口
// ============================================================

function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initMobileFocusInterceptor();
            initPastePerformanceFix();
            initTokenCounterRenderFix();
        });
    } else {
        initMobileFocusInterceptor();
        initPastePerformanceFix();
        initTokenCounterRenderFix();
    }
}

if (typeof window !== 'undefined' && !window.ST_EXTENSION) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initMobileFocusInterceptor();
            initPastePerformanceFix();
            initTokenCounterRenderFix();
        });
    } else {
        initMobileFocusInterceptor();
        initPastePerformanceFix();
        initTokenCounterRenderFix();
    }
}
