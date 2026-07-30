/**
 * Mobile Focus Interceptor - SillyTavern Extension
 * 拦截移动端代码自动聚焦，防止虚拟键盘频繁弹出
 * 
 * v1.1.0 - 新增移动端键盘粘贴卡顿修复
 * 通过 beforeinput capture 拦截 + visibility:hidden 抑制重绘，
 * 将键盘分段粘贴合并为一次性渲染，性能对齐长按粘贴
 */

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

    console.log('[MobileFocus] 聚焦拦截器就绪');
}

// ============================================================
// 模块 B: 移动端键盘粘贴卡顿修复
// ============================================================
// 策略：
//   A. 单次 >=5000 字符 → 直接判定为大文本粘贴，preventDefault + 100ms flush
//   B. 200ms 内 >=3 次 beforeinput 且有一次 >3 字符 → 多段粘贴，preventDefault + 动态超时 flush
//   C. 以上都不满足 → 正常打字，放行
// flush 时使用 visibility:hidden 抑制重绘 + rAF 分离文本渲染和高度调整，
// 将浏览器分段渲染合并为一次，性能对齐长按粘贴。

function initPastePerformanceFix() {
    if (window.__pastePerformanceFixInstalled__) {
        return;
    }
    window.__pastePerformanceFixInstalled__ = true;

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
    /** rAF ID，用于在 destroy 时取消 */
    var rafId = null;

    /** 判断元素是否为可输入的 textarea/input/contenteditable */
    function isEditable(el) {
        return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable;
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

        if (textParts.length === 0 || pasteStartPos === null || !pasteTarget) {
            textParts = [];
            pasteStartPos = null;
            pasteTarget = null;
            return;
        }

        var target = pasteTarget;
        var accumulatedText = textParts.join('');
        var start = pasteStartPos;
        var before = target.value.substring(0, start);
        var after = target.value.substring(target.selectionEnd);

        textParts = [];
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
        if (textInsertTypes.indexOf(e.inputType) === -1) return;

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
            e.preventDefault();

            clearTimeout(flushTimer);
            flushTimer = setTimeout(flushBuffer, 100);
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
            e.preventDefault();

            currentTimeout = Math.min(currentTimeout * 2, 2000);
            clearTimeout(flushTimer);
            flushTimer = setTimeout(flushBuffer, currentTimeout);
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
// 扩展入口
// ============================================================

function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initMobileFocusInterceptor();
            initPastePerformanceFix();
        });
    } else {
        initMobileFocusInterceptor();
        initPastePerformanceFix();
    }
}

if (typeof window !== 'undefined' && !window.ST_EXTENSION) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initMobileFocusInterceptor();
            initPastePerformanceFix();
        });
    } else {
        initMobileFocusInterceptor();
        initPastePerformanceFix();
    }
}
