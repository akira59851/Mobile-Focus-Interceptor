/**
 * Mobile Focus Interceptor - SillyTavern Extension
 * 拦截移动端代码自动聚焦，防止虚拟键盘频繁弹出
 */

function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 768;
}

function initMobileFocusInterceptor() {
    // 防止重复初始化
    if (window.__mobileFocusInterceptorInstalled__) {
        return;
    }
    window.__mobileFocusInterceptorInstalled__ = true;

    if (!isMobile()) {
        return;
    }

    /** 记录最近的用户触摸/点击事件时间戳 */
    let lastTouchTime = 0;
    /** 用户触摸的目标是否为输入类元素 */
    let wasTouchOnInput = false;

    // --- 用户交互检测 ---
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

    // --- 重写 HTMLElement.prototype.focus ---
    const originalFocus = HTMLElement.prototype.focus;
    const inputElements = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

    HTMLElement.prototype.focus = function (options) {
        const now = Date.now();
        const isUserInitiated = (now - lastTouchTime) < 500 && wasTouchOnInput;

        // 用户主动触摸输入元素 或 非输入类元素 → 放行
        if (isUserInitiated || !inputElements.has(this.tagName)) {
            return originalFocus.call(this, options);
        }

        // 检查元素是否在 DOM 中且可见
        if (!this.isConnected) {
            return originalFocus.call(this, options);
        }
        var computedStyle = window.getComputedStyle(this);
        if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
            return originalFocus.call(this, options);
        }

        // 代码自动聚焦 → 拦截
        return undefined;
    };

    // --- 清理机制 ---
    function destroy() {
        HTMLElement.prototype.focus = originalFocus;
        document.removeEventListener('touchstart', updateTouchTime, { capture: true });
        document.removeEventListener('pointerdown', updateTouchTime, { capture: true });
        document.removeEventListener('mousedown', updateTouchTime, { capture: true });
        window.__mobileFocusInterceptorInstalled__ = false;
    }

    // 页面卸载时自动清理
    window.addEventListener('beforeunload', destroy);

    // 暴露清理接口，支持手动卸载
    window.__mobileFocusInterceptorDestroy__ = destroy;

    console.log('[MobileFocus] 移动端聚焦拦截器已就绪');
}

// --- SillyTavern 扩展入口 ---
function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileFocusInterceptor);
    } else {
        initMobileFocusInterceptor();
    }
}

// 如果作为独立脚本直接加载（非扩展模式），也自动初始化
if (typeof window !== 'undefined' && !window.ST_EXTENSION) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileFocusInterceptor);
    } else {
        initMobileFocusInterceptor();
    }
}
