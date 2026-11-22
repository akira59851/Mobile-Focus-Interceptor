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
           仅在 Token Counter 弹窗打开期间透明拦截 appendChild/insertBefore，
           配合 content-visibility 分组，解决大文本分词高亮渲染导致的页面假死；
           首屏上限 + 「继续加载」逐帧渐进渲染，面板关闭后恢复宿主原生方法。
   模块 D：ST 原生 :has() 样式失效修复（桌面/移动通用）
           删除 ST 主样式表中触发整页样式失效的 z-index 规则，
           用内联 z-index 复刻其行为，修复抽屉/弹窗后键盘开合持续卡顿。
   模块 I：ST 抽屉展开动画优化（桌面/移动通用）
           上层抽屉、标准小抽屉和角色头像信息区先完成最终布局，
           再用裁切动画向下揭示，避免展开期间反复重排和内容位移。
   模块 E：外部小窗键盘布局冻结（仅移动端）
           Android 外部小窗应用呼出键盘时也会缩小 ST 的布局视口；
           先排除 ST 自身窗口模式变化，再根据页面焦点和纯高度骤减识别
           外部键盘，用像素高度冻结主布局；ST 自己呼出键盘时保持原生行为。
   模块 H：非主界面输入时固定聊天背景（仅移动端）
           在 ST 自己的世界书、角色、设置或弹窗输入时，只冻结聊天主区域；
           当前上层界面继续跟随键盘调整，主输入框仍保持 ST 原生行为。
   模块 F：离开页面前原生确认（桌面/移动通用）
           返回、刷新或关闭页面时显示浏览器原生确认，
           降低误触导致 ST 页面重置的风险；Chrome 安装应用模式
           额外接管侧滑返回，避免直接关闭应用。
   模块 G：重新生成与备选生成确认（仅移动端）
           在 ST 原生操作或 ST 自带快捷回复会重新生成、
           生成新备选回复前显示简洁确认；切换已有候选不受影响。

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

// ============================================================
// 设置与设备判断
// ============================================================
var MFI_SETTINGS_KEY = 'MobileFocusInterceptor';
var MFI_SETTINGS_SCHEMA_VERSION = 1;
var MFI_PLATFORM_MOBILE = 'mobile';
var MFI_PLATFORM_DESKTOP = 'desktop';

/* 功能顺序即设置面板顺序；platforms 同时决定显示哪些平台选框 */
var MFI_FEATURE_DEFINITIONS = [
    {
        id: 'focusGuard',
        label: '防止键盘频繁弹出',
        platforms: [MFI_PLATFORM_MOBILE],
        init: initMobileFocusInterceptor,
        initName: 'initMobileFocusInterceptor',
        destroyName: '__mobileFocusInterceptorDestroy__',
        installedFlag: '__mobileFocusInterceptorInstalled__',
    },
    {
        id: 'pastePerformance',
        label: '优化长文本粘贴卡顿',
        platforms: [MFI_PLATFORM_MOBILE],
        init: initPastePerformanceFix,
        initName: 'initPastePerformanceFix',
        destroyName: '__pastePerformanceFixDestroy__',
        installedFlag: '__pastePerformanceFixInstalled__',
    },
    {
        id: 'tokenCounter',
        label: '优化 Token 计数器卡顿',
        platforms: [MFI_PLATFORM_MOBILE, MFI_PLATFORM_DESKTOP],
        init: initTokenCounterRenderFix,
        initName: 'initTokenCounterRenderFix',
        destroyName: '__tokenCounterRenderFixDestroy__',
        installedFlag: '__tokenCounterRenderFixInstalled__',
    },
    {
        id: 'nativeHasFix',
        label: '优化键盘开合与界面流畅度',
        platforms: [MFI_PLATFORM_MOBILE, MFI_PLATFORM_DESKTOP],
        init: initNativeHasInvalidationFix,
        initName: 'initNativeHasInvalidationFix',
        destroyName: '__nativeHasInvalidationFixDestroy__',
        installedFlag: '__nativeHasInvalidationFixInstalled__',
    },
    {
        id: 'drawerAnimation',
        label: '优化面板开合卡顿',
        platforms: [MFI_PLATFORM_MOBILE, MFI_PLATFORM_DESKTOP],
        init: initDrawerAnimationOptimization,
        initName: 'initDrawerAnimationOptimization',
        destroyName: '__drawerAnimationOptimizationDestroy__',
        installedFlag: '__drawerAnimationOptimizationInstalled__',
    },
    {
        id: 'hotswapCache',
        label: '角色收藏头像缓存',
        platforms: [MFI_PLATFORM_MOBILE, MFI_PLATFORM_DESKTOP],
        init: initHotswapCacheOptimization,
        initName: 'initHotswapCacheOptimization',
        destroyName: '__hotswapCacheOptimizationDestroy__',
        installedFlag: '__hotswapCacheOptimizationInstalled__',
    },
    {
        id: 'externalKeyboard',
        label: '防止浮窗键盘顶起界面',
        platforms: [MFI_PLATFORM_MOBILE],
        init: initExternalKeyboardViewportFix,
        initName: 'initExternalKeyboardViewportFix',
        destroyName: '__externalKeyboardViewportFixDestroy__',
        installedFlag: '__externalKeyboardViewportFixInstalled__',
    },
    {
        id: 'innerUiKeyboard',
        label: '上层输入时锁定底层布局',
        platforms: [MFI_PLATFORM_MOBILE],
        init: initInnerUiKeyboardLayoutFix,
        initName: 'initInnerUiKeyboardLayoutFix',
        destroyName: '__innerUiKeyboardLayoutFixDestroy__',
        installedFlag: '__innerUiKeyboardLayoutFixInstalled__',
    },
    {
        id: 'exitConfirm',
        label: '离开页面弹窗确认',
        platforms: [MFI_PLATFORM_MOBILE, MFI_PLATFORM_DESKTOP],
        defaultEnabled: false,
        init: initExitConfirmGuard,
        initName: 'initExitConfirmGuard',
        destroyName: '__exitConfirmGuardDestroy__',
        installedFlag: '__exitConfirmGuardInstalled__',
    },
    {
        id: 'generationConfirm',
        label: '重新生成/备选回复弹窗确认',
        platforms: [MFI_PLATFORM_MOBILE],
        defaultEnabled: false,
        init: initGenerationConfirmGuard,
        initName: 'initGenerationConfirmGuard',
        destroyName: '__generationConfirmGuardDestroy__',
        installedFlag: '__generationConfirmGuardInstalled__',
    },
];

/* 设置面板按使用场景分组；功能运行和配置顺序仍以定义表为准。 */
var MFI_SETTING_GROUPS = [
    {
        label: '输入与键盘',
        featureIds: [
            'focusGuard',
            'pastePerformance',
            'externalKeyboard',
            'innerUiKeyboard',
        ],
    },
    {
        label: '界面与性能',
        featureIds: [
            'nativeHasFix',
            'drawerAnimation',
            'hotswapCache',
            'tokenCounter',
        ],
    },
    {
        label: '防误触保护',
        featureIds: [
            'exitConfirm',
            'generationConfirm',
        ],
    },
];

var MFI_USAGE_HELP_INTRO = [
    '主要优化 SillyTavern 移动端的界面与输入体验，部分优化同时适用于电脑端。',
    '设置即时生效（选项旁的设备图标代表适用范围）。',
];

var MFI_USAGE_HELP_GROUPS = [
    {
        label: '输入与键盘',
        items: [
            ['防止键盘频繁弹出', '阻止虚拟键盘自动弹出，仅主动点击输入框时允许唤起。'],
            ['优化长文本粘贴卡顿', '减少通过虚拟键盘粘贴大量文本时的延迟与卡顿。'],
            ['防止浮窗键盘顶起界面', '外部浮窗应用唤起键盘时，ST 主界面不再被顶起。'],
            ['上层输入时锁定底层布局', '在世界书、角色卡等界面中呼出键盘时，锁定底层主界面不被顶起，减少不必要的布局变动与卡顿。'],
        ],
    },
    {
        label: '界面与性能',
        items: [
            ['优化键盘开合与界面流畅度', '解决打开抽屉或弹窗后，手机键盘弹出/收起持续卡顿以及电脑端面板操作迟缓的问题。'],
            ['优化面板开合卡顿', '让抽屉与折叠区更快展开并瞬间收起，减少画面掉帧与跳动。'],
            ['角色收藏头像缓存', '减少重复打开角色管理面板时不必要的扫描和刷新。'],
            ['优化 Token 计数器卡顿', '优化长文本的分词高亮渲染，避免页面卡顿与假死，分词结果过长时分段加载。'],
        ],
    },
    {
        label: '防误触保护',
        items: [
            ['离开页面弹窗确认', '刷新、关闭或侧滑返回前弹窗确认，防止误触导致页面重载。'],
            ['重新生成/备选回复弹窗确认', '重新生成或生成备选回复前弹窗确认，防止误触丢失内容或消耗额度。'],
        ],
    },
];

var mfiSettings = null;
var mfiSettingsLoaded = false;
var mfiPluginInitialized = false;
var mfiSettingsInitAttempts = 0;
var mfiSettingsInitTimer = null;
var settingsUiRetryTimer = null;
var settingsUiObserver = null;
var pageLifecycleBound = false;
var mfiQuickReplyGuardEpoch = 0;
var mfiQuickReplySetPrototype = null;
var mfiQuickReplyGuardOriginalExecuteWithOptions = null;
var mfiQuickReplyGuardWrappedExecuteWithOptions = null;
var mfiQuickReplyGuardActive = false;
var mfiQuickReplyUserIntentUntil = 0;
var mfiGenerationConfirmRequest = null;
var mfiUsageHelpOpen = false;

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

/** 读取 ST 上下文；扩展配置通过它存入当前用户的 ST 设置。 */
function getStContext() {
    try {
        if (!window.SillyTavern || typeof window.SillyTavern.getContext !== 'function') {
            return null;
        }
        return window.SillyTavern.getContext();
    } catch (error) {
        return null;
    }
}

/** 与 ST 原生 isMobile() 保持一致：手机和平板归入 mobile，其余归入 desktop。 */
function getCurrentPlatform() {
    const context = getStContext();
    if (context && typeof context.isMobile === 'function') {
        try {
            return context.isMobile() ? MFI_PLATFORM_MOBILE : MFI_PLATFORM_DESKTOP;
        } catch (error) {
            /* 继续使用下方 ST 同款 Bowser 兜底 */
        }
    }

    const Bowser = window.SillyTavern
        && window.SillyTavern.libs
        && window.SillyTavern.libs.Bowser;
    if (Bowser && typeof Bowser.parse === 'function') {
        try {
            const type = Bowser.parse(navigator.userAgent || '').platform.type;
            return type === 'mobile' || type === 'tablet'
                ? MFI_PLATFORM_MOBILE
                : MFI_PLATFORM_DESKTOP;
        } catch (error) {
            /* 继续使用简化 UA 兜底 */
        }
    }

    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
        ? MFI_PLATFORM_MOBILE
        : MFI_PLATFORM_DESKTOP;
}

function isMobile() {
    return getCurrentPlatform() === MFI_PLATFORM_MOBILE;
}

/* Chrome/Edge 安装为应用后由独立窗口承载页面，需单独识别。 */
function isStandaloneAppMode() {
    try {
        return !!window.matchMedia
            && window.matchMedia('(display-mode: standalone)').matches;
    } catch (error) {
        return false;
    }
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 只保留功能实际支持的平台；缺失值按各功能自己的默认状态处理。 */
function normalizeFeatureSettings(definition, rawFeature) {
    const source = isPlainObject(rawFeature) ? rawFeature : {};
    const defaultEnabled = definition.defaultEnabled !== false;
    const normalized = {};
    definition.platforms.forEach(function (platform) {
        normalized[platform] = source[platform] === undefined
            ? defaultEnabled
            : source[platform] !== false;
    });
    return normalized;
}

function createDefaultSettings() {
    const features = {};
    MFI_FEATURE_DEFINITIONS.forEach(function (definition) {
        features[definition.id] = normalizeFeatureSettings(definition, null);
    });
    return {
        schemaVersion: MFI_SETTINGS_SCHEMA_VERSION,
        masterEnabled: true,
        features: features,
    };
}

function normalizeSettings(rawSettings) {
    const source = isPlainObject(rawSettings) ? rawSettings : {};
    const rawFeatures = isPlainObject(source.features) ? source.features : {};
    const features = {};
    MFI_FEATURE_DEFINITIONS.forEach(function (definition) {
        features[definition.id] = normalizeFeatureSettings(
            definition,
            rawFeatures[definition.id],
        );
    });
    return {
        schemaVersion: MFI_SETTINGS_SCHEMA_VERSION,
        masterEnabled: source.masterEnabled !== false,
        features: features,
    };
}

/** 从 ST 设置读取配置；ST 上下文尚未就绪时返回 false。 */
function loadMfiSettings() {
    const context = getStContext();
    if (!context || !context.extensionSettings) {
        return false;
    }
    mfiSettings = normalizeSettings(context.extensionSettings[MFI_SETTINGS_KEY]);
    mfiSettingsLoaded = true;
    return true;
}

/** 写入本插件自己的设置键，保留对象内未知字段，不碰其他插件配置。 */
function saveMfiSettings() {
    if (!mfiSettings) {
        return false;
    }
    const context = getStContext();
    if (!context || !context.extensionSettings) {
        return false;
    }

    const stored = isPlainObject(context.extensionSettings[MFI_SETTINGS_KEY])
        ? context.extensionSettings[MFI_SETTINGS_KEY]
        : {};
    const storedFeatures = isPlainObject(stored.features) ? stored.features : {};
    const features = {};

    MFI_FEATURE_DEFINITIONS.forEach(function (definition) {
        const previous = isPlainObject(storedFeatures[definition.id])
            ? storedFeatures[definition.id]
            : {};
        const next = {};
        Object.keys(previous).forEach(function (key) {
            if (key !== MFI_PLATFORM_MOBILE && key !== MFI_PLATFORM_DESKTOP) {
                next[key] = previous[key];
            }
        });
        definition.platforms.forEach(function (platform) {
            next[platform] = mfiSettings.features[definition.id][platform] !== false;
        });
        features[definition.id] = next;
    });

    /* 保留未来版本或手工补充的未知功能，避免保存时丢掉数据 */
    Object.keys(storedFeatures).forEach(function (featureId) {
        if (!Object.prototype.hasOwnProperty.call(features, featureId)) {
            features[featureId] = storedFeatures[featureId];
        }
    });

    context.extensionSettings[MFI_SETTINGS_KEY] = {
        ...stored,
        schemaVersion: MFI_SETTINGS_SCHEMA_VERSION,
        masterEnabled: mfiSettings.masterEnabled !== false,
        features: features,
    };

    if (typeof context.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    }
    return true;
}

function getFeatureDefinition(featureId) {
    return MFI_FEATURE_DEFINITIONS.find(function (definition) {
        return definition.id === featureId;
    }) || null;
}

function getPlatformControlText(platform, featureLabel) {
    const platformLabel = platform === MFI_PLATFORM_MOBILE ? '手机' : '电脑';
    return `${platformLabel}端启用：${featureLabel}`;
}

/** 设置面板只补少量排列规则，颜色与字号继续继承 ST 原生样式。 */
function ensureSettingsStyle() {
    if (document.getElementById('mfi-settings-style')) {
        return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = 'mfi-settings-style';
    styleEl.textContent = [
        '#mfi-settings #mfi-feature-list {',
        '    display: grid;',
        '    grid-template-columns: 156px 40px 40px;',
        '    column-gap: 2px;',
        '    row-gap: 4px;',
        '    align-items: center;',
        '    width: max-content;',
        '    max-width: 100%;',
        '    margin-right: auto;',
        '}',
        '#mfi-settings .mfi-master-row {',
        '    display: flex;',
        '    align-items: center;',
        '    gap: 8px;',
        '    width: calc(156px + 40px + 40px + 4px);',
        '    max-width: 100%;',
        '}',
        '#mfi-settings .mfi-master-toggle-label {',
        '    display: inline-flex;',
        '    align-items: center;',
        '    gap: 5px;',
        '    width: max-content;',
        '    max-width: calc(100% - 100px);',
        '    margin: 0;',
        '    cursor: pointer;',
        '}',
        '#mfi-settings .mfi-help-button {',
        '    flex: 0 0 auto;',
        '    width: max-content;',
        '    min-width: max-content;',
        '    height: fit-content;',
        '    margin: 5px 0 5px auto;',
        '    padding: 2px 8px;',
        '    line-height: 1.4;',
        '    white-space: nowrap;',
        '    background-color: color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent) !important;',
        '    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 35%, transparent) !important;',
        '}',
        '#mfi-settings .mfi-help-button:hover {',
        '    background-color: color-mix(in srgb, var(--SmartThemeBodyColor) 18%, transparent) !important;',
        '}',
        '#mfi-settings .mfi-setting-group-title {',
        '    grid-column: 1 / -1;',
        '    margin-top: 5px;',
        '    padding-top: 6px;',
        '    border-top: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 30%, transparent);',
        '    color: var(--SmartThemeBodyColor);',
        '    font-size: .88em;',
        '    font-weight: 600;',
        '    opacity: .8;',
        '}',
        '#mfi-settings .mfi-setting-group-title:first-child {',
        '    margin-top: 0;',
        '    padding-top: 0;',
        '    border-top: 0;',
        '}',
        '#mfi-settings .mfi-setting-row {',
        '    display: contents;',
        '}',
        '#mfi-settings .mfi-setting-label {',
        '    min-width: 0;',
        '    line-height: 1.25;',
        '    white-space: normal;',
        '}',
        '#mfi-settings .mfi-platform-placeholder {',
        '    display: block;',
        '    width: 40px;',
        '    height: 1px;',
        '}',
        '#mfi-settings .mfi-platform-toggle {',
        '    display: inline-flex;',
        '    align-items: center;',
        '    gap: 3px;',
        '    width: 40px;',
        '    margin: 0;',
        '    padding: 0;',
        '    cursor: pointer;',
        '}',
        '#mfi-settings .mfi-platform-toggle input {',
        '    margin: 0;',
        '    flex: 0 0 auto;',
        '}',
        '#mfi-settings[data-master-off="true"] .mfi-platform-toggle,',
        '#mfi-settings[data-master-off="true"] .mfi-platform-placeholder {',
        '    opacity: .55;',
        '}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(styleEl);
}

function createPlatformToggle(definition, platform) {
    const toggle = document.createElement('label');
    toggle.className = 'checkbox_label mfi-platform-toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `mfi-toggle-${definition.id}-${platform}`;
    input.dataset.mfiFeature = definition.id;
    input.dataset.mfiPlatform = platform;
    input.checked = mfiSettings.features[definition.id][platform] !== false;
    input.setAttribute('aria-label', getPlatformControlText(platform, definition.label));
    input.addEventListener('change', function () {
        if (!mfiSettings || !mfiSettings.features[definition.id]) {
            return;
        }
        mfiSettings.features[definition.id][platform] = input.checked;
        saveMfiSettings();
        if (platform === getCurrentPlatform()) {
            syncFeatureRuntime(definition);
        }
    });

    const icon = document.createElement('i');
    icon.className = platform === MFI_PLATFORM_MOBILE
        ? 'fa-solid fa-mobile-screen-button'
        : 'fa-solid fa-desktop';
    icon.setAttribute('aria-hidden', 'true');

    toggle.append(input, icon);
    return toggle;
}

/* 说明列表左对齐，避免 ST 默认居中排版后圆点和正文错位。 */
function alignUsageHelpList(list) {
    list.style.textAlign = 'left';
    list.querySelectorAll('li').forEach(function (item) {
        item.style.textAlign = 'left';
    });
}

/* 只使用 ST 原生排版元素组织说明，正文过长时交给弹窗内容区滚动。 */
function buildUsageHelpContent() {
    const content = document.createElement('div');
    content.className = 'flex-container flexFlowColumn';
    content.style.gap = '1em';
    content.style.paddingBottom = '.25em';

    const title = document.createElement('h3');
    title.className = 'margin0 textAlignCenter';
    title.textContent = '设置说明';
    content.appendChild(title);

    MFI_USAGE_HELP_INTRO.forEach(function (text) {
        const paragraph = document.createElement('p');
        paragraph.className = 'margin0';
        paragraph.style.lineHeight = '1.55';
        paragraph.textContent = text;
        content.appendChild(paragraph);
    });

    MFI_USAGE_HELP_GROUPS.forEach(function (group) {
        const section = document.createElement('section');
        section.className = 'flex-container flexFlowColumn';
        section.style.gap = '.4em';

        const heading = document.createElement('h4');
        heading.className = 'margin0';
        heading.textContent = group.label;
        section.appendChild(heading);

        const list = document.createElement('ul');
        list.style.margin = '0';
        list.style.paddingLeft = '1.25em';
        list.style.lineHeight = '1.55';

        group.items.forEach(function (item) {
            const listItem = document.createElement('li');
            listItem.style.marginBottom = '.3em';
            const name = document.createElement('strong');
            name.textContent = item[0] + '：';
            listItem.append(name, document.createTextNode(item[1]));
            list.appendChild(listItem);
        });

        alignUsageHelpList(list);
        section.appendChild(list);
        content.appendChild(section);
    });

    return content;
}

async function openUsageHelpDialog() {
    if (mfiUsageHelpOpen) {
        return;
    }

    const context = getStContext();
    if (!context || !context.POPUP_TYPE || !context.POPUP_RESULT) {
        console.warn('[MobileFocus] 设置说明弹窗不可用：ST 弹窗组件缺失');
        return;
    }

    const PopupClass = context.Popup
        || (window.SillyTavern && window.SillyTavern.libs && window.SillyTavern.libs.Popup);
    if (typeof PopupClass !== 'function') {
        console.warn('[MobileFocus] 设置说明弹窗不可用：ST Popup 类缺失');
        return;
    }

    mfiUsageHelpOpen = true;
    try {
        const popup = new PopupClass(
            buildUsageHelpContent(),
            context.POPUP_TYPE.TEXT,
            '',
            {
                wide: true,
                large: isMobile(),
                leftAlign: true,
                allowVerticalScrolling: true,
                okButton: false,
                cancelButton: false,
                defaultResult: context.POPUP_RESULT.NEGATIVE,
                customButtons: [
                    {
                        text: '关闭',
                        result: context.POPUP_RESULT.NEGATIVE,
                    },
                ],
            },
        );
        await popup.show();
    } catch (error) {
        console.warn('[MobileFocus] 设置说明弹窗打开失败：', error);
    } finally {
        mfiUsageHelpOpen = false;
    }
}

function createSettingsPanelContent() {
    const container = document.createElement('div');
    container.id = 'mfi-settings';
    container.className = 'inline-drawer wide100p';

    const header = document.createElement('div');
    header.className = 'inline-drawer-toggle inline-drawer-header';
    const title = document.createElement('strong');
    title.textContent = '移动端优化小工具';
    const chevron = document.createElement('div');
    chevron.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
    header.append(title, chevron);

    const content = document.createElement('div');
    content.className = 'inline-drawer-content';

    const masterRow = document.createElement('div');
    masterRow.className = 'mfi-master-row';
    const masterLabel = document.createElement('label');
    masterLabel.className = 'checkbox_label mfi-master-toggle-label';
    masterLabel.htmlFor = 'mfi-master-toggle';
    const masterInput = document.createElement('input');
    masterInput.type = 'checkbox';
    masterInput.id = 'mfi-master-toggle';
    masterInput.checked = mfiSettings.masterEnabled !== false;
    masterInput.addEventListener('change', function () {
        if (!mfiSettings) {
            return;
        }
        mfiSettings.masterEnabled = masterInput.checked;
        updateSettingsControlsDisabled();
        saveMfiSettings();
        syncAllFeatureRuntimes();
    });
    const masterText = document.createElement('span');
    masterText.textContent = '启用优化';
    masterLabel.append(masterInput, masterText);

    const helpButton = document.createElement('button');
    helpButton.type = 'button';
    helpButton.id = 'mfi-help-button';
    helpButton.className = 'menu_button mfi-help-button';
    helpButton.textContent = '设置说明';
    helpButton.setAttribute('aria-haspopup', 'dialog');
    helpButton.addEventListener('click', function () {
        void openUsageHelpDialog();
    });
    masterRow.append(masterLabel, helpButton);

    const divider = document.createElement('hr');
    divider.className = 'marginTopBot5';
    const featureList = document.createElement('div');
    featureList.id = 'mfi-feature-list';
    featureList.className = 'flex-container flexFlowColumn';

    MFI_SETTING_GROUPS.forEach(function (group) {
        const groupTitle = document.createElement('div');
        groupTitle.className = 'mfi-setting-group-title';
        groupTitle.textContent = group.label;
        featureList.appendChild(groupTitle);

        group.featureIds.forEach(function (featureId) {
            const definition = getFeatureDefinition(featureId);
            if (!definition) {
                return;
            }
            const row = document.createElement('div');
            row.className = 'mfi-setting-row';

            const label = document.createElement('small');
            label.className = 'mfi-setting-label';
            label.textContent = definition.label;

            row.appendChild(label);
            definition.platforms.forEach(function (platform) {
                row.appendChild(createPlatformToggle(definition, platform));
            });
            if (definition.platforms.length < 2) {
                const placeholder = document.createElement('span');
                placeholder.className = 'mfi-platform-placeholder';
                placeholder.setAttribute('aria-hidden', 'true');
                row.appendChild(placeholder);
            }

            featureList.appendChild(row);
        });
    });

    content.append(masterRow, divider, featureList);
    container.append(header, content);
    return container;
}

function updateSettingsControlsDisabled() {
    const container = document.getElementById('mfi-settings');
    if (!container || !mfiSettings) {
        return;
    }
    const masterOff = mfiSettings.masterEnabled === false;
    container.dataset.masterOff = masterOff ? 'true' : 'false';
    const masterInput = document.getElementById('mfi-master-toggle');
    if (masterInput) {
        masterInput.checked = !masterOff;
    }
    container.querySelectorAll('input[data-mfi-feature]').forEach(function (input) {
        input.disabled = masterOff;
    });
}

function ensureSettingsPanel() {
    if (document.getElementById('mfi-settings')) {
        updateSettingsControlsDisabled();
        return true;
    }
    const host = document.getElementById('extensions_settings');
    if (!host) {
        return false;
    }
    ensureSettingsStyle();
    host.appendChild(createSettingsPanelContent());
    updateSettingsControlsDisabled();
    return true;
}

/** 清理设置面板注入期间的重试和观察器。 */
function stopSettingsPanelInjection() {
    if (settingsUiObserver) {
        settingsUiObserver.disconnect();
        settingsUiObserver = null;
    }
    if (settingsUiRetryTimer) {
        clearInterval(settingsUiRetryTimer);
        settingsUiRetryTimer = null;
    }
}

/** ST 扩展面板偶尔晚于脚本生成；重试和观察器都有明确结束条件。 */
function scheduleSettingsPanelInjection() {
    if (ensureSettingsPanel()) {
        stopSettingsPanelInjection();
        return;
    }
    if (!settingsUiRetryTimer) {
        let attempts = 0;
        settingsUiRetryTimer = setInterval(function () {
            attempts += 1;
            if (ensureSettingsPanel() || attempts >= 20) {
                stopSettingsPanelInjection();
            }
        }, 500);
    }
    if (!settingsUiObserver && typeof MutationObserver === 'function') {
        settingsUiObserver = new MutationObserver(function () {
            if (ensureSettingsPanel()) {
                stopSettingsPanelInjection();
            }
        });
        settingsUiObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }
}

// ============================================================
// 模块 A: 聚焦拦截
// ============================================================

function initMobileFocusInterceptor() {
    if (window.__mobileFocusInterceptorInstalled__) {
        return;
    }

    if (!isMobile()) {
        mfiLog('[MobileFocus] 模块 A 跳过：仅移动端启用');
        return;
    }

    window.__mobileFocusInterceptorInstalled__ = true;

    var lastTouchTime = 0;
    var wasTouchOnInput = false;
    var interceptorActive = true;

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

    function interceptedFocus(options) {
        /* 若其它插件在本插件之后包装了 focus，停止时仍让旧包装直接透传。 */
        if (!interceptorActive) {
            return originalFocus.call(this, options);
        }
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
    }

    HTMLElement.prototype.focus = interceptedFocus;

    function destroy() {
        interceptorActive = false;
        if (HTMLElement.prototype.focus === interceptedFocus) {
            HTMLElement.prototype.focus = originalFocus;
        }
        document.removeEventListener('touchstart', updateTouchTime, { capture: true });
        document.removeEventListener('pointerdown', updateTouchTime, { capture: true });
        document.removeEventListener('mousedown', updateTouchTime, { capture: true });
        window.__mobileFocusInterceptorInstalled__ = false;
    }

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

    // 仅移动端生效（2026-08-22 回归）：桌面端粘贴大文本无此卡顿，避免拦截误伤；
    // 模块 A 聚焦拦截同样仅移动端，与此保持一致
    if (!isMobile()) {
        mfiLog('[MobileFocus] 模块 B 跳过：仅移动端启用（桌面端粘贴大文本无此卡顿）');
        return;
    }

    window.__pastePerformanceFixInstalled__ = true;

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
    /** 等待 rAF 恢复并派发 input 的目标元素 */
    var rafTarget = null;

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
    function flushBuffer(immediate) {
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

        function restoreAndDispatch() {
            target.style.visibility = '';
            target.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (immediate) {
            restoreAndDispatch();
            return;
        }

        // rAF 中恢复可见并触发 input
        rafTarget = target;
        rafId = requestAnimationFrame(function () {
            rafId = null;
            rafTarget = null;
            restoreAndDispatch();
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
    var batchTarget = null;

    function flushPendingInput() {
        clearTimeout(batchTimer);
        batchTimer = null;
        var target = batchTarget;
        batchTarget = null;
        if (!target) {
            return;
        }
        lastValueLength = target.value.length;
        target.dispatchEvent(new Event('input', { bubbles: true }));
    }

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
        batchTarget = target;
        clearTimeout(batchTimer);
        batchTimer = setTimeout(flushPendingInput, 250);
    }

    document.addEventListener('beforeinput', onBeforeInputCapture, true);
    document.addEventListener('input', onInputCapture, true);

    function destroy() {
        /* 关闭功能时先同步落盘等待中的粘贴，避免开关操作丢字。 */
        if (batching) {
            flushBuffer(true);
        }
        clearTimeout(flushTimer);
        flushPendingInput();
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
            if (rafTarget) {
                rafTarget.style.visibility = '';
                rafTarget.dispatchEvent(new Event('input', { bubbles: true }));
                rafTarget = null;
            }
        }
        if (pasteTarget) pasteTarget.style.visibility = '';
        document.removeEventListener('beforeinput', onBeforeInputCapture, true);
        document.removeEventListener('input', onInputCapture, true);
        window.__pastePerformanceFixInstalled__ = false;
    }

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

    var managerDestroyed = false;
    var panelObserver = null;
    var activePanel = null;
    var activeRuntime = null;

    function findTokenCounterPanel() {
        var display = document.getElementById('tokenized_chunks_display');
        return display ? display.closest('dialog') : null;
    }

    function nodeContainsTokenCounter(node) {
        return !!(node && node.nodeType === 1 && (
            node.matches('#tokenized_chunks_display') ||
            node.querySelector('#tokenized_chunks_display')
        ));
    }

    function stopPanelRuntime(options) {
        if (!activeRuntime) {
            activePanel = null;
            return;
        }
        var runtime = activeRuntime;
        activeRuntime = null;
        activePanel = null;
        runtime.destroy(options);
    }

    function startPanelRuntime(panel) {
        if (managerDestroyed || !panel || !panel.isConnected) {
            return;
        }
        if (activeRuntime && activePanel === panel) {
            return;
        }
        stopPanelRuntime({ keepStyle: false });
        try {
            activeRuntime = createTokenCounterPanelRuntime(panel);
            activePanel = panel;
        } catch (err) {
            activeRuntime = null;
            activePanel = null;
            console.warn('[MobileFocus] 模块 C 面板运行时初始化失败：', err);
        }
    }

    function ensurePanelRuntime() {
        if (managerDestroyed) {
            return;
        }
        var panel = findTokenCounterPanel();
        if (panel) {
            startPanelRuntime(panel);
        } else if (activeRuntime) {
            stopPanelRuntime({ keepStyle: false });
        }
    }

    function onPanelMutations(mutations) {
        var activePanelRemoved = false;
        var tokenPanelAdded = false;

        mutations.forEach(function (mutation) {
            if (mutation.type !== 'childList') {
                return;
            }
            if (activePanel && Array.prototype.some.call(mutation.removedNodes, function (node) {
                return node === activePanel ||
                    (node.nodeType === 1 && node.contains(activePanel));
            })) {
                activePanelRemoved = true;
            }
            if (Array.prototype.some.call(mutation.addedNodes, nodeContainsTokenCounter)) {
                tokenPanelAdded = true;
            }
        });

        if (activePanelRemoved) {
            stopPanelRuntime({ keepStyle: false });
        }
        if (tokenPanelAdded) {
            ensurePanelRuntime();
        }
    }

    function destroyManager() {
        if (managerDestroyed) {
            return;
        }
        managerDestroyed = true;
        if (panelObserver) {
            panelObserver.disconnect();
            panelObserver = null;
        }
        var keepStyle = !!(activePanel && activePanel.isConnected);
        stopPanelRuntime({ keepStyle: keepStyle });
        window.__tokenCounterRenderFixInstalled__ = false;
        window.__tokenCounterRenderRuntimeActive__ = false;
    }

    window.__tokenCounterRenderFixInstalled__ = true;
    window.__tokenCounterRenderRuntimeActive__ = false;

    try {
        panelObserver = new MutationObserver(onPanelMutations);
        panelObserver.observe(document.body, { childList: true });
        window.__tokenCounterRenderFixDestroy__ = destroyManager;
        ensurePanelRuntime();
        mfiLog('[MobileFocus] 模块 C Token Counter 按面板生命周期管理已就绪');
    } catch (err) {
        destroyManager();
        console.warn('[MobileFocus] 模块 C Token Counter 生命周期管理器初始化失败：', err);
    }
}

/** 仅在 Token Counter 弹窗打开期间安装的重运行时。 */
function createTokenCounterPanelRuntime(panel) {
    var runtimeActive = false;
    var runtimeDestroyed = false;

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
        var loadMoreButtonEl = null; // 当前按钮节点，销毁时移除点击监听
        var loadMoreClickHandler = null;
        var loadingMore = false;   // 是否正在渐进加载中
        var loadMoreRaf = null;    // 渐进加载的 rAF id
        var heightTimer = null;    // 分组高度测量定时器
        var btnTimer = null;       // 按钮文本最终刷新定时器

        var originalAppendChild = Node.prototype.appendChild;
        var originalInsertBefore = Node.prototype.insertBefore;
        var styleEl = null;
        var staleStyleObserver = null;

        /** 获取目标容器；引用失效时重新查找（弹窗每次打开都会新建） */
        function getDisplay() {
            if (displayEl && displayEl.isConnected) {
                return displayEl;
            }
            displayEl = panel.querySelector('#tokenized_chunks_display');
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
                if (loadMoreButtonEl && loadMoreClickHandler) {
                    loadMoreButtonEl.removeEventListener('click', loadMoreClickHandler);
                }
                loadMoreBtn = null;
                loadMoreButtonEl = null;
                loadMoreClickHandler = null;
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
                loadMoreButtonEl = btn;
                loadMoreClickHandler = function () {
                    loadMore(disp);
                };
                btn.addEventListener('click', loadMoreClickHandler);
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
            if (!runtimeActive) {
                return originalAppendChild.call(this, child);
            }
            var disp = getDisplay();
            if (this === disp) {
                return routeToGroup(disp, child);
            }
            return originalAppendChild.call(this, child);
        };

        var patchedInsertBefore = function (child, ref) {
            if (!runtimeActive) {
                return originalInsertBefore.call(this, child, ref);
            }
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
        /* 重新开启时清掉上一次关闭后等待收尾的旧样式，避免重复节点 */
        if (window.__tokenCounterStaleStyleObserver__) {
            window.__tokenCounterStaleStyleObserver__.disconnect();
            window.__tokenCounterStaleStyleObserver__ = null;
        }
        document.querySelectorAll('#mfi-tc-cv-style').forEach(function (existing) {
            existing.remove();
        });

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

        function keepStyleUntilPanelRemoved(oldStyleEl) {
            if (!oldStyleEl || !oldStyleEl.isConnected) {
                return;
            }
            if (!panel.isConnected) {
                oldStyleEl.remove();
                return;
            }

            const cleanup = function () {
                if (panel.isConnected) {
                    return;
                }
                oldStyleEl.remove();
                const observer = staleStyleObserver;
                if (staleStyleObserver) {
                    staleStyleObserver.disconnect();
                    staleStyleObserver = null;
                }
                if (window.__tokenCounterStaleStyleObserver__ === observer) {
                    window.__tokenCounterStaleStyleObserver__ = null;
                }
            };
            if (staleStyleObserver) {
                staleStyleObserver.disconnect();
            }
            staleStyleObserver = new MutationObserver(cleanup);
            window.__tokenCounterStaleStyleObserver__ = staleStyleObserver;
            staleStyleObserver.observe(document.body, { childList: true });
        }

        function destroy(options) {
            if (runtimeDestroyed) {
                return;
            }
            runtimeDestroyed = true;
            runtimeActive = false;

            clearTimeout(heightTimer);
            clearTimeout(btnTimer);
            if (loadMoreRaf !== null) {
                cancelAnimationFrame(loadMoreRaf);
                loadMoreRaf = null;
            }
            if (loadMoreButtonEl && loadMoreClickHandler) {
                loadMoreButtonEl.removeEventListener('click', loadMoreClickHandler);
            }
            if (Node.prototype.appendChild === patchedAppendChild) {
                Node.prototype.appendChild = originalAppendChild;
            }
            if (Node.prototype.insertBefore === patchedInsertBefore) {
                Node.prototype.insertBefore = originalInsertBefore;
            }
            if (styleEl && styleEl.parentNode) {
                const disp = displayEl && displayEl.isConnected ? displayEl : null;
                const hasOptimizedContent = !!(disp
                    && disp.querySelector('.tc-cv-group, .tc-cv-load-more'));
                if (options && options.keepStyle && panel.isConnected && hasOptimizedContent) {
                    /* 已打开的大文本面板保留到关闭/下次渲染，避免切换开关时现场重建数万节点。 */
                    keepStyleUntilPanelRemoved(styleEl);
                } else {
                    styleEl.remove();
                }
            }
            styleEl = null;
            displayEl = null;
            currentGroup = null;
            pendingChunks = [];
            loadMoreBtn = null;
            loadMoreButtonEl = null;
            loadMoreClickHandler = null;
            window.__tokenCounterRenderRuntimeActive__ = false;
        }

        runtimeActive = true;
        window.__tokenCounterRenderRuntimeActive__ = true;
        mfiLog('[MobileFocus] 模块 C Token Counter 渲染优化就绪');
        return { destroy: destroy };
    } catch (err) {
        // fail-open：任何异常都不影响插件其它模块与 ST 本身
        runtimeActive = false;
        clearTimeout(heightTimer);
        clearTimeout(btnTimer);
        if (loadMoreRaf !== null) {
            cancelAnimationFrame(loadMoreRaf);
            loadMoreRaf = null;
        }
        if (typeof originalAppendChild === 'function'
            && Node.prototype.appendChild === patchedAppendChild) {
            Node.prototype.appendChild = originalAppendChild;
        }
        if (typeof originalInsertBefore === 'function'
            && Node.prototype.insertBefore === patchedInsertBefore) {
            Node.prototype.insertBefore = originalInsertBefore;
        }
        if (styleEl && styleEl.parentNode) {
            styleEl.remove();
        }
        window.__tokenCounterRenderRuntimeActive__ = false;
        console.warn('[MobileFocus] 模块 C Token Counter 渲染优化初始化失败：', err);
        throw err;
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

    window.__nativeHasInvalidationFixDestroy__ = destroy;
    mfiLog('[MobileFocus] 模块 D ST 原生 :has 样式失效修复就绪');
}

// ============================================================
// 模块 I: ST 抽屉展开动画优化（桌面/移动通用）
// ============================================================
// ST 原生动画逐帧改变 .drawer-content 的 height，面板内容越多，
// 每一帧需要重新计算的范围越大。这里让面板在点击时立即获得最终布局，
// 只在同一个元素上用 clip-path 自上而下揭示；关闭时类名移除即瞬时收起。
// 背景、边框、滚动内容和控件共用这一条动画，避免抽屉与内容不同步。
// 不再继承 ST 的 hide-scroll 动画：展开高度已经是最终高度，首帧可以直接
// 决定是否需要滚动条，避免先无滚动条显示、动画结束再出现造成布局跳动。
// 预设条目编辑弹窗同样先完成表单、正文和底栏布局，再整体裁切揭示。
// 角色管理眼睛按钮直接切换头像、名字和标签区，也先完成最终布局，
// 再用小抽屉同款约 150ms 裁切揭示，避免下方角色描述逐帧移动。

function initDrawerAnimationOptimization() {
    if (window.__drawerAnimationOptimizationInstalled__) {
        return;
    }
    window.__drawerAnimationOptimizationInstalled__ = true;

    var jq = window.jQuery;
    var originalSlideToggle = jq && jq.fn ? jq.fn.slideToggle : null;
    var originalSlideDown = jq && jq.fn ? jq.fn.slideDown : null;
    var inlineDrawerPatches = [];
    var inlineDrawerPatchesByEvent = new WeakMap();
    var avatarBlockOriginalStyles = new WeakMap();
    var DRAWER_SELECTOR = '#top-settings-holder .drawer-content';
    var PROMPT_POPUP_SELECTOR = '#completion_prompt_manager_popup';
    var AVATAR_BLOCK_SELECTOR = '#avatar-and-name-block';
    var AVATAR_REVEAL_CLASS = 'mfi-avatar-block-reveal';
    var INLINE_REVEAL_CLASS = 'mfi-inline-drawer-reveal';
    var DORMANT_OPEN_CLASS = 'mfi-drawer-reveal-dormant';
    var STYLE_ID = 'mfi-drawer-animation-style';
    var moduleActive = false;
    var dormantOpenElements = new Set();
    var dormantOpenObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            var element = mutation.target;
            if (!element.classList.contains('openDrawer')) {
                element.classList.remove(DORMANT_OPEN_CLASS);
                dormantOpenElements.delete(element);
            }
        });
        if (dormantOpenElements.size === 0) {
            dormantOpenObserver.disconnect();
        }
    });

    /* 功能启用时，已经打开的抽屉保持原状；等它关闭后，再次打开才播放新动画。 */
    document.querySelectorAll(DRAWER_SELECTOR + '.openDrawer, ' + PROMPT_POPUP_SELECTOR + '.openDrawer')
        .forEach(function (element) {
            element.classList.add(DORMANT_OPEN_CLASS);
            dormantOpenElements.add(element);
            dormantOpenObserver.observe(element, {
                attributes: true,
                attributeFilter: ['class'],
            });
        });

    var styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = [
        DRAWER_SELECTOR + ',',
        PROMPT_POPUP_SELECTOR + ' {',
        '    transition: none !important;',
        '}',
        DRAWER_SELECTOR + '.openDrawer:not(.' + DORMANT_OPEN_CLASS + '),',
        PROMPT_POPUP_SELECTOR + '.openDrawer:not(.' + DORMANT_OPEN_CLASS + ') {',
        '    animation-name: mfi-drawer-reveal !important;',
        '    animation-duration: calc(var(--animation-duration-2x, 250ms) * 0.8) !important;',
        '    animation-timing-function: ease-in-out !important;',
        '    animation-fill-mode: none !important;',
        '}',
        '@keyframes mfi-drawer-reveal {',
        '    from { clip-path: inset(0 0 100% 0); }',
        '    to { clip-path: inset(0); }',
        '}',
        '.inline-drawer-content.' + INLINE_REVEAL_CLASS + ' {',
        '    animation: mfi-inline-drawer-reveal calc(var(--animation-duration-2x, 250ms) * 0.6) ease-out;',
        '}',
        AVATAR_BLOCK_SELECTOR + '.' + AVATAR_REVEAL_CLASS + ' {',
        '    animation: mfi-inline-drawer-reveal calc(var(--animation-duration-2x, 250ms) * 0.6) ease-out;',
        '}',
        '@keyframes mfi-inline-drawer-reveal {',
        '    from { clip-path: inset(0 0 100% 0); }',
        '    to { clip-path: inset(0); }',
        '}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(styleEl);

    /* ST 在切换顶层抽屉时会先关闭旧抽屉，再固定等待半段动画时长。
       当前模块已让关闭瞬时完成，因此点击捕获阶段先收掉旧抽屉，让 ST
       跳过空等并立即开始新抽屉的同一套揭示动画。 */
    function onDrawerToggleClick(event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }
        var toggle = target.closest('#top-settings-holder .drawer-toggle');
        if (!toggle || !toggle.parentElement) {
            return;
        }
        var targetDrawer = toggle.parentElement.querySelector(':scope > .drawer-content');
        if (!targetDrawer || targetDrawer.classList.contains('openDrawer')) {
            return;
        }
        document.querySelectorAll('#top-settings-holder .drawer-content.openDrawer:not(.pinnedOpen)')
            .forEach(function (drawer) {
                if (drawer !== targetDrawer) {
                    drawer.classList.remove('openDrawer');
                    drawer.classList.add('closedDrawer');
                }
            });
    }
    document.addEventListener('click', onDrawerToggleClick, true);

    /* 预设编辑弹窗由 ST 调用 jQuery slideDown 逐帧改变高度。这里保留
       打开和关闭 API，只把打开动作改为立即完成，再由同一个裁切动画揭示，
       让表单底栏和滚动容器从首帧起就处于最终状态。 */
    function wrappedPromptSlideDown() {
        if (!moduleActive) {
            return originalSlideDown.apply(this, arguments);
        }
        if (this[0] && this[0].matches && this[0].matches(PROMPT_POPUP_SELECTOR)) {
            this.stop(true, true).show().addClass('openDrawer');
            return this;
        }
        return originalSlideDown.apply(this, arguments);
    }

    if (originalSlideDown) {
        jq.fn.slideDown = wrappedPromptSlideDown;
    }

    /* ST 的小抽屉由宿主调用 jQuery slideToggle 逐帧修改高度。这里保留
       原生点击处理和 inline-drawer-toggle 事件，仅在宿主启动动画的瞬间，
       对当前点击的小抽屉直接写入最终显示状态，避免浏览器原生滚动条
       跟着高度动画逐帧变化。 */
    function findInlinePatch(contentEl) {
        for (var index = inlineDrawerPatches.length - 1; index >= 0; index--) {
            var patch = inlineDrawerPatches[index];
            if (patch.active && patch.contentEl === contentEl) {
                return patch;
            }
        }
        return null;
    }

    function removeInlinePatch(patch) {
        if (!patch || !patch.active) {
            return;
        }
        patch.active = false;
        if (patch.fallbackTimer !== null) {
            clearTimeout(patch.fallbackTimer);
            patch.fallbackTimer = null;
        }
        var index = inlineDrawerPatches.indexOf(patch);
        if (index !== -1) {
            inlineDrawerPatches.splice(index, 1);
        }
    }

    function applyInlinePatch(patch) {
        patch.contentEl.classList.remove(INLINE_REVEAL_CLASS);
        patch.contentEl.setAttribute('style', patch.originalStyle);
        patch.contentEl.style.display = patch.wasOpen ? 'none' : 'block';
        if (!patch.wasOpen) {
            patch.contentEl.classList.add(INLINE_REVEAL_CLASS);
        }
    }

    function applyAvatarBlockToggle(element) {
        var wasOpen = getComputedStyle(element).display !== 'none';
        if (!avatarBlockOriginalStyles.has(element)) {
            avatarBlockOriginalStyles.set(element, element.getAttribute('style') || '');
        }

        element.classList.remove(AVATAR_REVEAL_CLASS);
        element.setAttribute('style', avatarBlockOriginalStyles.get(element));
        if (wasOpen) {
            element.style.display = 'none';
            return;
        }

        element.style.display = 'flex';
        element.classList.add(AVATAR_REVEAL_CLASS);
    }

    function wrappedInlineSlideToggle() {
        if (!moduleActive) {
            return originalSlideToggle.apply(this, arguments);
        }
        var target = this[0];
        if (target && target.matches && target.matches(AVATAR_BLOCK_SELECTOR)) {
            this.stop(true, true);
            applyAvatarBlockToggle(target);
            return this;
        }
        var patch = findInlinePatch(this[0]);
        if (patch) {
            applyInlinePatch(patch);
            return this;
        }
        return originalSlideToggle.apply(this, arguments);
    }

    function onInlineDrawerClickCapture(event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function'
            || target.classList.contains('text_pole')) {
            return;
        }
        var toggle = target.closest('.inline-drawer-toggle');
        var drawer = toggle ? toggle.closest('.inline-drawer') : null;
        var contentEl = drawer
            ? drawer.querySelector(':scope > .inline-drawer-content')
            : null;
        if (!contentEl) {
            return;
        }

        var patch = {
            active: true,
            contentEl: contentEl,
            originalStyle: contentEl.getAttribute('style') || '',
            wasOpen: getComputedStyle(contentEl).display !== 'none',
            fallbackTimer: null,
        };
        inlineDrawerPatches.push(patch);
        inlineDrawerPatchesByEvent.set(event, patch);

        /* 捕获阶段之后如果事件被其他代码截断，窗口冒泡监听不会触发；
           使用下一轮任务兜底清理，确保宿主仍能在本次事件派发中调用动画。 */
        patch.fallbackTimer = setTimeout(function () {
            patch.fallbackTimer = null;
            removeInlinePatch(patch);
        }, 0);
    }

    function onInlineDrawerClickBubble(event) {
        var patch = inlineDrawerPatchesByEvent.get(event);
        if (!patch) {
            return;
        }
        inlineDrawerPatchesByEvent.delete(event);
        removeInlinePatch(patch);
    }

    if (originalSlideToggle) {
        jq.fn.slideToggle = wrappedInlineSlideToggle;
        window.addEventListener('click', onInlineDrawerClickCapture, true);
        window.addEventListener('click', onInlineDrawerClickBubble, false);
    }

    function destroy() {
        moduleActive = false;
        dormantOpenObserver.disconnect();
        dormantOpenElements.clear();
        document.removeEventListener('click', onDrawerToggleClick, true);
        window.removeEventListener('click', onInlineDrawerClickCapture, true);
        window.removeEventListener('click', onInlineDrawerClickBubble, false);
        inlineDrawerPatches.forEach(function (patch) {
            patch.active = false;
            if (patch.fallbackTimer !== null) {
                clearTimeout(patch.fallbackTimer);
                patch.fallbackTimer = null;
            }
        });
        inlineDrawerPatches.length = 0;
        if (originalSlideToggle && jq.fn.slideToggle === wrappedInlineSlideToggle) {
            jq.fn.slideToggle = originalSlideToggle;
        }
        if (originalSlideDown && jq.fn.slideDown === wrappedPromptSlideDown) {
            jq.fn.slideDown = originalSlideDown;
        }
        document.querySelectorAll('.inline-drawer-content.' + INLINE_REVEAL_CLASS)
            .forEach(function (contentEl) {
                contentEl.classList.remove(INLINE_REVEAL_CLASS);
            });
        document.querySelectorAll(AVATAR_BLOCK_SELECTOR + '.' + AVATAR_REVEAL_CLASS)
            .forEach(function (element) {
                element.classList.remove(AVATAR_REVEAL_CLASS);
            });
        document.querySelectorAll('.' + DORMANT_OPEN_CLASS).forEach(function (element) {
            element.classList.remove(DORMANT_OPEN_CLASS);
        });
        styleEl.remove();
        window.__drawerAnimationOptimizationInstalled__ = false;
    }

    moduleActive = true;
    window.__drawerAnimationOptimizationDestroy__ = destroy;
    mfiLog('[MobileFocus] 模块 I 面板展开动画优化就绪');
}

// ============================================================
// 模块 J: 收藏快捷头像缓存（桌面/移动通用）
// ============================================================
// ST 每次打开角色管理都会调用 favsToHotswap()，扫描全部角色和群，
// 再清空 #right-nav-panel 中的快捷头像容器并逐个重建。这里缓存当前
// 收藏列表签名；签名未变时，只在本次打开动作期间暂时摘掉 .hotswap 类，
// 让 ST 找不到目标容器，随后在面板打开后恢复原有节点。
// 收藏、角色、群或影响排序的数据变化时仍放行 ST 原生重建，避免旧头像。

function initHotswapCacheOptimization() {
    if (window.__hotswapCacheOptimizationInstalled__) {
        return;
    }

    var panel = document.getElementById('right-nav-panel');
    var container = panel
        ? panel.querySelector(':scope > #CharListButtonAndHotSwaps .hotswap')
        : null;
    if (!panel || !container) {
        mfiLog('[MobileFocus] 模块 J 跳过：角色管理快捷头像容器尚未就绪');
        return;
    }

    var SUPPRESSION_FALLBACK_MS = 800;
    var cachedSignature = null;
    var cacheReady = false;
    var snapshotTimer = null;
    var suppressionTimer = null;
    var suppressedContainer = null;
    var destroyed = false;
    var eventBindings = [];
    var context = getStContext();
    var eventSource = context && context.eventSource;
    var eventTypes = context && (context.eventTypes || context.event_types);

    window.__hotswapCacheOptimizationInstalled__ = true;

    function isFavorite(entity) {
        return !!entity && (entity.fav === true || entity.fav === 'true');
    }

    function stringifySortValue(value) {
        if (value === undefined || value === null) {
            return '';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }
        return String(value);
    }

    function buildHotswapSignature() {
        var currentContext = getStContext();
        if (!currentContext) {
            return null;
        }

        var characters = Array.isArray(currentContext.characters)
            ? currentContext.characters
            : [];
        var groups = Array.isArray(currentContext.groups)
            ? currentContext.groups
            : [];
        var powerUser = currentContext.powerUser || {};
        var sortSelect = document.getElementById('character_sort_order');
        var selectedSort = sortSelect && sortSelect.selectedOptions
            ? sortSelect.selectedOptions[0]
            : null;
        var selectedField = selectedSort
            ? selectedSort.getAttribute('data-field') || ''
            : '';
        var selectedOrder = selectedSort
            ? selectedSort.getAttribute('data-order') || ''
            : '';
        var selectedRule = selectedSort
            ? selectedSort.getAttribute('data-rule') || ''
            : '';
        var effectiveOrder = selectedOrder || String(powerUser.sort_order || '');

        /* 随机排序每次重建都会改变顺序，不做缓存判断，保持 ST 原行为。 */
        if (effectiveOrder === 'random') {
            return null;
        }

        var sortField = selectedField || String(powerUser.sort_field || '');
        var searchValue = document.getElementById('character_search_bar')?.value || '';
        var parts = [
            'sort',
            selectedField,
            selectedOrder,
            selectedRule,
            String(powerUser.sort_field || ''),
            String(powerUser.sort_order || ''),
            String(powerUser.sort_rule || ''),
        ];
        if (selectedField === 'search' || sortField === 'search') {
            parts.push('search', searchValue);
        }

        characters.forEach(function (character, index) {
            if (!isFavorite(character)) {
                return;
            }
            parts.push(JSON.stringify([
                'character',
                index,
                character.avatar || '',
                character.name || '',
                character.fav,
                sortField ? stringifySortValue(character[sortField]) : '',
            ]));
        });

        groups.forEach(function (group) {
            if (!isFavorite(group)) {
                return;
            }
            var members = Array.isArray(group.members)
                ? group.members.map(function (member) {
                    if (typeof member === 'string') {
                        return member;
                    }
                    return member && (member.avatar || member.id) || '';
                }).join(',')
                : '';
            parts.push(JSON.stringify([
                'group',
                group.id === undefined ? '' : group.id,
                group.avatar || '',
                group.name || '',
                group.fav,
                members,
                sortField ? stringifySortValue(group[sortField]) : '',
            ]));
        });

        return parts.join('\u001f');
    }

    function takeSnapshot() {
        var signature = buildHotswapSignature();
        if (signature === null) {
            cacheReady = false;
            cachedSignature = null;
            return;
        }
        cachedSignature = signature;
        cacheReady = true;
    }

    function scheduleSnapshot() {
        if (snapshotTimer !== null) {
            clearTimeout(snapshotTimer);
        }
        snapshotTimer = setTimeout(function () {
            snapshotTimer = null;
            takeSnapshot();
        }, 0);
    }

    function markHotswapDirty() {
        cacheReady = false;
    }

    function restoreHotswapClass() {
        if (suppressionTimer !== null) {
            clearTimeout(suppressionTimer);
            suppressionTimer = null;
        }
        if (suppressedContainer && suppressedContainer.isConnected) {
            suppressedContainer.classList.add('hotswap');
        }
        suppressedContainer = null;
    }

    function suppressCurrentOpenRebuild() {
        if (destroyed || suppressedContainer || panel.classList.contains('openDrawer')) {
            return;
        }
        var signature = buildHotswapSignature();
        if (signature === null || !cacheReady || signature !== cachedSignature) {
            return;
        }

        suppressedContainer = container;
        container.classList.remove('hotswap');
        suppressionTimer = setTimeout(function () {
            suppressionTimer = null;
            restoreHotswapClass();
        }, SUPPRESSION_FALLBACK_MS);
    }

    function onDocumentClickCapture(event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var isDirectToggle = !!target.closest('#rightNavHolder .drawer-toggle');
        var opener = target.closest('.drawer-opener');
        var isOpener = !!opener && opener.getAttribute('data-target') === 'rightNavHolder';
        if (isDirectToggle || isOpener) {
            suppressCurrentOpenRebuild();
        }
    }

    var hotswapObserver = new MutationObserver(scheduleSnapshot);
    hotswapObserver.observe(container, { childList: true });

    /* 宿主先切换 openDrawer 类，再同步调用 favsToHotswap。
       类名变化回调在本次点击任务结束后执行，因此在此时恢复正式容器
       既能跳过重建，也不会让面板以缺少样式的状态绘制。 */
    var panelObserver = new MutationObserver(function () {
        if (suppressedContainer && panel.classList.contains('openDrawer')) {
            restoreHotswapClass();
        }
    });
    panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });

    if (eventSource && typeof eventSource.on === 'function') {
        ['CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_DUPLICATED',
            'CHARACTER_RENAMED', 'GROUP_UPDATED'].forEach(function (eventName) {
            var eventType = eventTypes && eventTypes[eventName];
            if (!eventType) {
                return;
            }
            eventSource.on(eventType, markHotswapDirty);
            eventBindings.push(eventType);
        });
    }

    document.addEventListener('click', onDocumentClickCapture, true);
    /* 初始页面已有内容也可能早于本模块安装，不能假设仍与当前数据一致。
       首次打开先放行 ST 正常刷新，后续由子列表重建完成后的快照接管。 */

    function destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;
        restoreHotswapClass();
        if (snapshotTimer !== null) {
            clearTimeout(snapshotTimer);
            snapshotTimer = null;
        }
        hotswapObserver.disconnect();
        panelObserver.disconnect();
        document.removeEventListener('click', onDocumentClickCapture, true);
        if (eventSource && typeof eventSource.removeListener === 'function') {
            eventBindings.forEach(function (eventType) {
                eventSource.removeListener(eventType, markHotswapDirty);
            });
        }
        eventBindings.length = 0;
        window.__hotswapCacheOptimizationInstalled__ = false;
    }

    window.__hotswapCacheOptimizationDestroy__ = destroy;
    mfiLog('[MobileFocus] 模块 J 收藏快捷头像缓存就绪');
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
// 方案：焦点决定键盘归属于谁，窗口尺寸决定为什么界面变小。
//       宽度/外框变化视为 ST 自身进入分屏或浮窗，解除冻结并重建基线；
//       页面失焦且宽度稳定、仅高度骤减时，才按外部键盘冻结主布局。
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
    var WIDTH_CHANGE_TOLERANCE = 32;
    var OUTER_BOUNDS_TOLERANCE = 8;
    var BASELINE_SETTLE_MS = 300;
    var INITIAL_BASELINE_MS = 300;

    var baseline = null;
    var baselinePending = false;
    var frozen = false;
    var styleEl = null;
    var baselineTimer = null;
    var initialBaselineTimer = null;
    var resizeFrame = 0;
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

        var outerW = Number(window.outerWidth);
        var outerH = Number(window.outerHeight);
        var outerWValid = Number.isFinite(outerW) && outerW > 0;
        var outerHValid = Number.isFinite(outerH) && outerH > 0;

        return {
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            bodyH: body.getBoundingClientRect().height,
            sheldH: sheld.getBoundingClientRect().height,
            chatH: chat.getBoundingClientRect().height,
            orientation: screen.orientation ? screen.orientation.type : '',
            screenW: screen.width,
            screenH: screen.height,
            screenX: Number(window.screenX) || 0,
            screenY: Number(window.screenY) || 0,
            outerW: outerWValid ? outerW : window.innerWidth,
            outerH: outerHValid ? outerH : window.innerHeight,
            /* 旧版 Android Chrome 会让外框尺寸等于内容视口；此时只把内宽作为窗口模式信号。 */
            outerBoundsReliable: outerWValid && outerHValid && (
                Math.abs(outerW - window.innerWidth) > 2 ||
                Math.abs(outerH - window.innerHeight) > 2
            ),
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
            '    max-height: none !important;',
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
        if (destroyed) {
            return;
        }

        mfiDebug('[MobileFocus] 模块 E 重建基线：', reason, {
            hadBaseline: !!baseline,
            baselinePending: baselinePending,
        });
        clearTimeout(baselineTimer);
        releaseFreeze(reason);
        baselinePending = true;
        baseline = null;
        baselineTimer = setTimeout(function () {
            baselineTimer = null;
            if (destroyed) {
                return;
            }
            baselinePending = false;
            setBaseline();
            mfiDebug('[MobileFocus] 模块 E 基线已更新：', reason);
        }, BASELINE_SETTLE_MS);
    }

    function hasWindowGeometryChange(measured) {
        if (!baseline) {
            return false;
        }

        var widthChanged =
            Math.abs(measured.viewportW - baseline.viewportW) >= WIDTH_CHANGE_TOLERANCE;
        var outerBoundsChanged = baseline.outerBoundsReliable &&
            measured.outerBoundsReliable && (
                Math.abs(measured.outerW - baseline.outerW) >= OUTER_BOUNDS_TOLERANCE ||
                Math.abs(measured.outerH - baseline.outerH) >= OUTER_BOUNDS_TOLERANCE ||
                Math.abs(measured.screenX - baseline.screenX) >= OUTER_BOUNDS_TOLERANCE ||
                Math.abs(measured.screenY - baseline.screenY) >= OUTER_BOUNDS_TOLERANCE
            );

        return widthChanged || outerBoundsChanged;
    }

    function evaluateViewport(reason) {
        if (destroyed) {
            return;
        }

        var measured = measureLayout();
        if (!measured) {
            return;
        }

        if (baselinePending) {
            scheduleBaselineReset(reason + ':settling');
            return;
        }

        if (!baseline) {
            scheduleBaselineReset(reason + ':initial');
            return;
        }

        if (hasWindowGeometryChange(measured)) {
            mfiDebug('[MobileFocus] 模块 E 窗口模式变化：', reason, {
                before: {
                    width: baseline.viewportW,
                    height: baseline.viewportH,
                    outerWidth: baseline.outerW,
                    outerHeight: baseline.outerH,
                    screenX: baseline.screenX,
                    screenY: baseline.screenY,
                    orientation: baseline.orientation,
                },
                after: {
                    width: measured.viewportW,
                    height: measured.viewportH,
                    outerWidth: measured.outerW,
                    outerHeight: measured.outerH,
                    screenX: measured.screenX,
                    screenY: measured.screenY,
                    orientation: measured.orientation,
                },
            });
            scheduleBaselineReset(reason + ':window-mode');
            return;
        }

        var shrink = baseline.viewportH - measured.viewportH;
        var pageHasFocus = document.hasFocus();

        // ST 当前持有系统焦点时，键盘属于 ST；任何冻结都立即解除。
        if (pageHasFocus) {
            releaseFreeze(reason + ':st-focused');
            return;
        }

        if (!frozen) {
            if (shrink >= MIN_KEYBOARD_SHRINK) {
                applyFreeze(reason + ':shrink=' + Math.round(shrink));
            } else if (Math.abs(shrink) < RESTORE_TOLERANCE) {
                // 浏览器地址栏收展等小幅变化时延迟更新基线，避免误判。
                scheduleBaselineReset(reason + ':stable');
            } else if (shrink < 0) {
                scheduleBaselineReset(reason + ':grown');
            }
            return;
        }

        if (measured.viewportH >= baseline.viewportH - RESTORE_TOLERANCE) {
            releaseFreeze(reason + ':restored');
            scheduleBaselineReset(reason + ':restored-baseline');
        }
    }

    function onResize() {
        if (resizeFrame || destroyed) {
            return;
        }
        resizeFrame = requestAnimationFrame(function () {
            resizeFrame = 0;
            evaluateViewport('resize');
        });
    }

    function onOrientationChange() {
        var measured = measureLayout();
        if (!baseline || !measured) {
            return;
        }

        var orientationChanged = baseline.orientation &&
            measured.orientation &&
            baseline.orientation !== measured.orientation;
        var widthChanged =
            Math.abs(measured.viewportW - baseline.viewportW) >= WIDTH_CHANGE_TOLERANCE;

        /* Android 在普通高度变化时也可能派发 orientationchange，需核对真实方向。 */
        if (orientationChanged && widthChanged) {
            scheduleBaselineReset('orientationchange');
        }
    }

    function onWindowFocus() {
        releaseFreeze('window-focus');
        onResize();
    }

    function onUserInteraction() {
        if (document.hasFocus()) {
            releaseFreeze('user-interaction');
            onResize();
        }
    }

    function onEditableInteraction() {
        releaseFreeze('editable-interaction');
    }

    function destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;

        clearTimeout(baselineTimer);
        clearTimeout(initialBaselineTimer);
        if (resizeFrame) {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = 0;
        }
        releaseFreeze('destroy');

        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onOrientationChange);
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
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
        /* 兼容旧版残留变量；当前冻结样式不再写 #chat 固定高度。 */
        root.style.removeProperty('--mfi-external-kb-chat-h');

        baseline = null;
        baselinePending = false;
        window.__externalKeyboardViewportFixInstalled__ = false;
    }

    function onEditableEvent(event) {
        if (isEditable(event.target)) {
            onEditableInteraction();
        }
    }

    function onVisibilityChange() {
        if (document.visibilityState !== 'visible') {
            return;
        }
        if (document.hasFocus()) {
            releaseFreeze('visibility-visible');
        }
        onResize();
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onOrientationChange, { passive: true });
    window.addEventListener('focus', onWindowFocus, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
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
        if (!setBaseline()) {
            scheduleBaselineReset('initial-no-baseline');
        }
    }, INITIAL_BASELINE_MS);

    window.__externalKeyboardViewportFixDestroy__ = destroy;
    window.__externalKeyboardViewportFixInstalled__ = true;
    mfiLog('[MobileFocus] 模块 E 外部小窗键盘布局冻结就绪');
}

// ============================================================
// 模块 H: 非主界面输入时固定聊天背景（仅移动端）
// ============================================================
/*
   世界书、角色、设置和弹窗输入框位于 #sheld 外。ST 自己的虚拟键盘
   仍会按 interactive-widget=resizes-content 缩小布局视口，导致背后的
   聊天主区域一起变矮。本模块只在这种「ST 有焦点 + 活动输入框在聊天
   主区域外」的场景冻结聊天主区域，上层界面继续按自己的视口规则调整。
   主输入框和外部小窗键盘分别保持原有行为，不与模块 E 共享状态。
 */

function initInnerUiKeyboardLayoutFix() {
    if (window.__innerUiKeyboardLayoutFixInstalled__) {
        return;
    }

    if (!isMobile()) {
        mfiLog('[MobileFocus] 模块 H 跳过：仅移动端启用');
        return;
    }

    var MIN_KEYBOARD_SHRINK = 120;
    var RESTORE_TOLERANCE = 12;
    var WIDTH_CHANGE_TOLERANCE = 32;
    var OUTER_BOUNDS_TOLERANCE = 8;
    var BASELINE_SETTLE_MS = 300;
    var INITIAL_BASELINE_MS = 300;
    var NON_TEXT_INPUT_TYPES = {
        button: true,
        checkbox: true,
        color: true,
        file: true,
        hidden: true,
        image: true,
        radio: true,
        range: true,
        reset: true,
        submit: true,
    };

    var baseline = null;
    var baselinePending = false;
    var frozen = false;
    var styleEl = null;
    var baselineTimer = null;
    var initialBaselineTimer = null;
    var resizeFrame = 0;
    var ownerCheckFrame = 0;
    var keyboardOwner = null;
    var destroyed = false;

    function isEditable(element) {
        if (!element) {
            return false;
        }
        if (element.tagName === 'TEXTAREA') {
            return true;
        }
        if (element.tagName === 'INPUT') {
            var type = String(element.type || 'text').toLowerCase();
            return !NON_TEXT_INPUT_TYPES[type];
        }
        return element.isContentEditable === true;
    }

    function getMainShell() {
        return document.getElementById('sheld');
    }

    /* 只认聊天主区域外的可编辑元素，不枚举世界书、角色或弹窗选择器。 */
    function isOutsideMainEditable(element) {
        var sheld = getMainShell();
        return !!(
            element &&
            element.isConnected &&
            isEditable(element) &&
            sheld &&
            !sheld.contains(element)
        );
    }

    function measureLayout() {
        var body = document.body;
        var sheld = getMainShell();
        var chat = document.getElementById('chat');

        if (!body || !sheld || !chat) {
            return null;
        }

        var outerW = Number(window.outerWidth);
        var outerH = Number(window.outerHeight);
        var outerWValid = Number.isFinite(outerW) && outerW > 0;
        var outerHValid = Number.isFinite(outerH) && outerH > 0;

        return {
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            bodyH: body.getBoundingClientRect().height,
            sheldH: sheld.getBoundingClientRect().height,
            chatH: chat.getBoundingClientRect().height,
            orientation: screen.orientation ? screen.orientation.type : '',
            screenX: Number(window.screenX) || 0,
            screenY: Number(window.screenY) || 0,
            outerW: outerWValid ? outerW : window.innerWidth,
            outerH: outerHValid ? outerH : window.innerHeight,
            outerBoundsReliable: outerWValid && outerHValid && (
                Math.abs(outerW - window.innerWidth) > 2 ||
                Math.abs(outerH - window.innerHeight) > 2
            ),
        };
    }

    function ensureStyle() {
        if (styleEl) {
            return;
        }

        styleEl = document.createElement('style');
        styleEl.id = 'mfi-inner-ui-kb-freeze-style';
        styleEl.textContent = [
            'html.mfi-inner-ui-kb-freeze body {',
            '    height: var(--mfi-inner-ui-kb-body-h) !important;',
            '}',
            'html.mfi-inner-ui-kb-freeze #sheld {',
            '    height: var(--mfi-inner-ui-kb-sheld-h) !important;',
            '    max-height: var(--mfi-inner-ui-kb-sheld-h) !important;',
            '}',
            'html.mfi-inner-ui-kb-freeze #chat {',
            '    max-height: none !important;',
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
        root.style.setProperty('--mfi-inner-ui-kb-body-h', baseline.bodyH + 'px');
        root.style.setProperty('--mfi-inner-ui-kb-sheld-h', baseline.sheldH + 'px');
        root.classList.add('mfi-inner-ui-kb-freeze');
        frozen = true;

        mfiDebug('[MobileFocus] 模块 H 非主界面键盘布局冻结：', reason);
    }

    function releaseFreeze(reason) {
        if (!frozen) {
            return;
        }

        document.documentElement.classList.remove('mfi-inner-ui-kb-freeze');
        frozen = false;

        mfiDebug('[MobileFocus] 模块 H 非主界面键盘布局恢复：', reason);
    }

    function scheduleBaselineReset(reason) {
        if (destroyed) {
            return;
        }

        releaseFreeze(reason);
        baselinePending = true;
        baseline = null;
        clearTimeout(baselineTimer);
        baselineTimer = setTimeout(function () {
            baselineTimer = null;
            if (destroyed) {
                return;
            }
            baselinePending = false;
            setBaseline();
        }, BASELINE_SETTLE_MS);
    }

    function hasWindowGeometryChange(measured) {
        if (!baseline) {
            return false;
        }

        var widthChanged =
            Math.abs(measured.viewportW - baseline.viewportW) >= WIDTH_CHANGE_TOLERANCE;
        var outerBoundsChanged = baseline.outerBoundsReliable &&
            measured.outerBoundsReliable && (
                Math.abs(measured.outerW - baseline.outerW) >= OUTER_BOUNDS_TOLERANCE ||
                Math.abs(measured.outerH - baseline.outerH) >= OUTER_BOUNDS_TOLERANCE ||
                Math.abs(measured.screenX - baseline.screenX) >= OUTER_BOUNDS_TOLERANCE ||
                Math.abs(measured.screenY - baseline.screenY) >= OUTER_BOUNDS_TOLERANCE
            );

        return widthChanged || outerBoundsChanged;
    }

    function resolveKeyboardOwner() {
        if (isOutsideMainEditable(document.activeElement)) {
            keyboardOwner = document.activeElement;
            return keyboardOwner;
        }
        if (!isOutsideMainEditable(keyboardOwner)) {
            keyboardOwner = null;
        }
        return keyboardOwner;
    }

    function evaluateViewport(reason) {
        if (destroyed) {
            return;
        }

        var measured = measureLayout();
        if (!measured) {
            return;
        }

        /* 页面失焦属于模块 E 的外部小窗场景，本模块主动退出。 */
        if (!document.hasFocus()) {
            releaseFreeze(reason + ':page-blurred');
            return;
        }

        if (baselinePending) {
            scheduleBaselineReset(reason + ':settling');
            return;
        }
        if (!baseline) {
            scheduleBaselineReset(reason + ':initial');
            return;
        }
        if (hasWindowGeometryChange(measured)) {
            scheduleBaselineReset(reason + ':window-mode');
            return;
        }

        var shrink = baseline.viewportH - measured.viewportH;
        var owner = resolveKeyboardOwner();

        if (measured.viewportH >= baseline.viewportH - RESTORE_TOLERANCE) {
            releaseFreeze(reason + ':restored');
            scheduleBaselineReset(reason + ':restored-baseline');
            return;
        }

        if (shrink >= MIN_KEYBOARD_SHRINK) {
            if (owner) {
                applyFreeze(reason + ':inner-ui-shrink=' + Math.round(shrink));
            } else {
                releaseFreeze(reason + ':main-or-no-owner');
            }
        } else if (Math.abs(shrink) < RESTORE_TOLERANCE) {
            scheduleBaselineReset(reason + ':stable');
        } else if (shrink < 0) {
            scheduleBaselineReset(reason + ':grown');
        }
    }

    function onResize() {
        if (resizeFrame || destroyed) {
            return;
        }
        resizeFrame = requestAnimationFrame(function () {
            resizeFrame = 0;
            evaluateViewport('resize');
        });
    }

    function onPointerDown(event) {
        var target = event.target;
        var sheld = getMainShell();
        if (sheld && target instanceof Element && sheld.contains(target)) {
            keyboardOwner = null;
            releaseFreeze('main-interaction');
            return;
        }
        if (isOutsideMainEditable(target)) {
            keyboardOwner = target;
        }
    }

    function onFocusIn(event) {
        var target = event.target;
        if (isOutsideMainEditable(target)) {
            keyboardOwner = target;
            return;
        }

        var sheld = getMainShell();
        if (sheld && target instanceof Element && sheld.contains(target)) {
            keyboardOwner = null;
            releaseFreeze('main-focus');
        }
    }

    function onFocusOut(event) {
        if (event.target !== keyboardOwner || ownerCheckFrame) {
            return;
        }
        ownerCheckFrame = requestAnimationFrame(function () {
            ownerCheckFrame = 0;
            if (keyboardOwner && !keyboardOwner.isConnected) {
                keyboardOwner = null;
                releaseFreeze('owner-removed');
            }
        });
    }

    function onWindowFocus() {
        onResize();
    }

    function onWindowBlur() {
        releaseFreeze('window-blur');
    }

    function onOrientationChange() {
        var measured = measureLayout();
        if (!baseline || !measured) {
            onResize();
            return;
        }

        var orientationChanged = baseline.orientation &&
            measured.orientation &&
            baseline.orientation !== measured.orientation;
        var widthChanged =
            Math.abs(measured.viewportW - baseline.viewportW) >= WIDTH_CHANGE_TOLERANCE;
        if (orientationChanged && widthChanged) {
            scheduleBaselineReset('orientationchange');
        }
        onResize();
    }

    function onVisibilityChange() {
        if (document.visibilityState !== 'visible') {
            releaseFreeze('page-hidden');
            return;
        }
        onResize();
    }

    function destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;

        clearTimeout(baselineTimer);
        clearTimeout(initialBaselineTimer);
        if (resizeFrame) {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = 0;
        }
        if (ownerCheckFrame) {
            cancelAnimationFrame(ownerCheckFrame);
            ownerCheckFrame = 0;
        }
        releaseFreeze('destroy');

        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onOrientationChange);
        window.removeEventListener('focus', onWindowFocus);
        window.removeEventListener('blur', onWindowBlur);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('touchstart', onPointerDown, true);
        document.removeEventListener('focusin', onFocusIn, true);
        document.removeEventListener('focusout', onFocusOut, true);

        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', onResize);
        }

        if (styleEl && styleEl.parentNode) {
            styleEl.parentNode.removeChild(styleEl);
        }
        styleEl = null;

        var root = document.documentElement;
        root.classList.remove('mfi-inner-ui-kb-freeze');
        root.style.removeProperty('--mfi-inner-ui-kb-body-h');
        root.style.removeProperty('--mfi-inner-ui-kb-sheld-h');

        baseline = null;
        baselinePending = false;
        keyboardOwner = null;
        window.__innerUiKeyboardLayoutFixInstalled__ = false;
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onOrientationChange, { passive: true });
    window.addEventListener('focus', onWindowFocus, { passive: true });
    window.addEventListener('blur', onWindowBlur, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
    document.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    document.addEventListener('touchstart', onPointerDown, { passive: true, capture: true });
    document.addEventListener('focusin', onFocusIn, { passive: true, capture: true });
    document.addEventListener('focusout', onFocusOut, { passive: true, capture: true });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onResize, { passive: true });
    }

    initialBaselineTimer = setTimeout(function () {
        initialBaselineTimer = null;
        if (destroyed) {
            return;
        }
        if (!setBaseline()) {
            scheduleBaselineReset('initial-no-baseline');
        }
    }, INITIAL_BASELINE_MS);

    window.__innerUiKeyboardLayoutFixDestroy__ = destroy;
    window.__innerUiKeyboardLayoutFixInstalled__ = true;
    mfiLog('[MobileFocus] 模块 H 非主界面键盘布局冻结就绪');
}

// ============================================================
// 模块 F: 离开页面前原生确认（桌面/移动通用）
// ============================================================

var MFI_EXIT_CONFIRM_MESSAGE = '确认离开当前页面？';

function initExitConfirmGuard() {
    if (window.__exitConfirmGuardInstalled__) {
        return;
    }

    window.__exitConfirmGuardInstalled__ = true;
    let destroyed = false;
    let closeWatcher = null;
    let closeWatcherRearmTimer = null;
    let closeWatcherResetTimer = null;
    let bypassBeforeUnload = false;
    let exitRequested = false;

    function onBeforeUnload(event) {
        /* 已通过独立应用确认框确认离开，不再重复弹出浏览器离开提示。 */
        if (bypassBeforeUnload) {
            return;
        }
        event.preventDefault();
        event.returnValue = true;
    }

    function stopCloseWatcher() {
        if (closeWatcher) {
            try {
                closeWatcher.destroy();
            } catch (error) {
                /* 页面正在关闭时监看器可能已被浏览器回收。 */
            }
            closeWatcher = null;
        }
        window.__exitConfirmCloseWatcherActive__ = false;
    }

    function onCloseRequest(event) {
        if (destroyed || exitRequested) {
            return;
        }
        if (!event.cancelable) {
            return;
        }

        event.preventDefault();
        let confirmed = false;
        try {
            confirmed = window.confirm(MFI_EXIT_CONFIRM_MESSAGE);
        } catch (error) {
            confirmed = false;
        }

        if (!confirmed) {
            /* 原生确认框关闭后重新建立监听，避免连续返回被浏览器防滥用规则跳过。 */
            scheduleCloseWatcherRearm();
            return;
        }

        exitRequested = true;
        bypassBeforeUnload = true;
        stopCloseWatcher();

        try {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.close();
            }
        } catch (error) {
            console.warn('[MobileFocus] 模块 F 独立应用退出失败：', error);
        }
        recoverIfApplicationStaysOpen();
    }

    function installCloseWatcher() {
        if (destroyed
            || closeWatcher
            || !isMobile()
            || !isStandaloneAppMode()
            || typeof window.CloseWatcher !== 'function') {
            return;
        }

        try {
            closeWatcher = new window.CloseWatcher();
            closeWatcher.addEventListener('cancel', onCloseRequest);
            window.__exitConfirmCloseWatcherActive__ = true;
        } catch (error) {
            closeWatcher = null;
            window.__exitConfirmCloseWatcherActive__ = false;
            console.warn('[MobileFocus] 模块 F 独立应用返回确认初始化失败：', error);
        }
    }

    function scheduleCloseWatcherRearm() {
        clearTimeout(closeWatcherRearmTimer);
        closeWatcherRearmTimer = setTimeout(function () {
            closeWatcherRearmTimer = null;
            if (destroyed || exitRequested) {
                return;
            }
            stopCloseWatcher();
            installCloseWatcher();
        }, 0);
    }

    function recoverIfApplicationStaysOpen() {
        clearTimeout(closeWatcherResetTimer);
        closeWatcherResetTimer = setTimeout(function () {
            closeWatcherResetTimer = null;
            if (destroyed) {
                return;
            }
            /* 同文档后退或关闭被浏览器拒绝时，恢复监听，不让功能停在半失效状态。 */
            bypassBeforeUnload = false;
            exitRequested = false;
            installCloseWatcher();
        }, 1200);
    }

    function destroy() {
        destroyed = true;
        clearTimeout(closeWatcherRearmTimer);
        clearTimeout(closeWatcherResetTimer);
        closeWatcherRearmTimer = null;
        closeWatcherResetTimer = null;
        stopCloseWatcher();
        bypassBeforeUnload = false;
        exitRequested = false;
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.__exitConfirmGuardInstalled__ = false;
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    installCloseWatcher();
    window.__exitConfirmGuardDestroy__ = destroy;
    mfiLog('[MobileFocus] 模块 F 离开页面前原生确认就绪');
}

// ============================================================
// 模块 G: 重新生成与备选生成确认（仅移动端）
// ============================================================

/** 判断当前消息继续右滑时，ST 是否会真正发起新生成。 */
function mfiWillRightSwipeGenerate(respectAvailability) {
    const context = getStContext();
    const chat = context?.chat;
    if (!Array.isArray(chat) || chat.length === 0) {
        return false;
    }
    if (respectAvailability
        && context.swipe
        && typeof context.swipe.isAllowed === 'function'
        && !context.swipe.isAllowed()) {
        return false;
    }

    const messageId = chat.length - 1;
    const message = chat[messageId];
    if (!message) {
        return false;
    }

    const currentSwipeId = Number(message.swipe_id ?? 0);
    const swipeCount = Array.isArray(message.swipes)
        ? message.swipes.length
        : 1;
    if (!Number.isFinite(currentSwipeId) || currentSwipeId < 0 || swipeCount <= 0) {
        return false;
    }
    /* 后面仍有候选时只是切换已有内容，不产生请求。 */
    if (currentSwipeId + 1 < swipeCount) {
        return false;
    }
    /* 生成中的临时槽位不应再次触发确认。 */
    if (currentSwipeId >= swipeCount) {
        return false;
    }

    let overswipeBehavior = '';
    if (typeof message.extra?.overswipe_behavior === 'string') {
        overswipeBehavior = message.extra.overswipe_behavior;
    } else if (message.extra?.swipeable === false || message.extra?.isSmallSys) {
        overswipeBehavior = 'none';
    } else if (messageId === 0 && !context.chatMetadata?.tainted) {
        overswipeBehavior = 'pristine_greeting';
    } else if (!message.is_user && !message.is_system) {
        overswipeBehavior = 'regenerate';
    } else {
        overswipeBehavior = 'loop';
    }

    return overswipeBehavior === 'regenerate';
}

/** 识别文本中会触发重新生成或新备选生成的斜线命令。 */
function mfiGetGenerationActionFromText(text) {
    const source = String(text ?? '').trim();
    if (!source.startsWith('/')) {
        return '';
    }

    const commandSegments = source.split(/\s*\|\s*/);
    for (const segment of commandSegments) {
        const commandMatch = /^\/([^\s|]+)/.exec(segment.trim());
        if (!commandMatch) {
            continue;
        }
        const commandName = commandMatch[1].toLowerCase();
        if (commandName === 'regenerate' || commandName === 'regen') {
            return 'regenerate';
        }
        if (commandName === 'swipe') {
            const directionMatch = /\bdirection\s*=\s*(?:"(left|right)"|'(left|right)'|(left|right))(?=\s|$)/i.exec(segment);
            const direction = (
                directionMatch?.[1]
                || directionMatch?.[2]
                || directionMatch?.[3]
                || 'right'
            ).toLowerCase();
            if (direction === 'right' && mfiWillRightSwipeGenerate(false)) {
                return 'swipe';
            }
        }
    }
    return '';
}

/** 文本是否通过 ST 自带的 /run 或 /qr 命令继续执行快捷回复。 */
function mfiHasQuickReplyInvocation(text) {
    return String(text ?? '')
        .trim()
        .split(/\s*\|\s*/)
        .some(function (segment) {
            return /^\/(?:run|qr)(?:\s|$)/i.test(segment.trim());
        });
}

/** 与 ST 快捷回复执行前相同的文本拼接规则，避免把普通消息误判为斜线命令。 */
function mfiGetQuickReplyCommandText(set, qr, options) {
    if (!set || set.disableSend) {
        return '';
    }
    const finalMessage = String(options?.message ?? qr?.message ?? '');
    const textarea = document.getElementById('send_textarea');
    let input = textarea instanceof HTMLTextAreaElement ? textarea.value : '';
    if (!options?.isAutoExecute
        && !options?.isEditor
        && !options?.isRun
        && set.injectInput
        && input.length > 0) {
        input = set.placeBeforeInput
            ? `${finalMessage} ${input}`
            : `${input} ${finalMessage}`;
    } else {
        input = `${finalMessage} `;
    }
    return input;
}

/** 判断元素当前是否可见，用于沿用 ST 自身的手势入口条件。 */
function mfiIsVisibleElement(element) {
    if (!(element instanceof Element) || element.getClientRects().length === 0) {
        return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

/** 生成中时不再显示确认；原流程会自行忽略或等待。 */
function mfiIsGenerationInProgress() {
    const stopButton = document.getElementById('mes_stop');
    return !!stopButton && mfiIsVisibleElement(stopButton);
}

/** 键盘方向键沿用了 ST 的触发条件，避免和输入框、浮层、编辑态冲突。 */
function mfiCanUseKeyboardSwipe() {
    const context = getStContext();
    if (!context) {
        return false;
    }
    if (context.Popup?.util?.isPopupOpen?.()) {
        return false;
    }
    if (!context.swipe?.isAllowed?.()) {
        return false;
    }
    if (document.body.classList.contains('nGY2_body_scrollbar')) {
        return false;
    }
    if (document.getElementById('send_textarea')?.value !== '') {
        return false;
    }
    if (mfiIsVisibleElement(document.getElementById('character_popup'))) {
        return false;
    }
    if (mfiIsVisibleElement(document.getElementById('shadow_select_chat_popup'))) {
        return false;
    }
    const active = document.activeElement;
    const isEditing = active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || active?.isContentEditable;
    return !isEditing && !(active instanceof HTMLVideoElement);
}

/** 将快捷回复执行入口与用户点击关联，避免第三方插件直接调用时被接管。 */
function mfiMarkQuickReplyUserIntent(event) {
    const target = event.target instanceof Element ? event.target : null;
    const quickReplyButton = target?.closest('.qr--button');
    const contextMenuItem = target?.closest('.ctx-menu .ctx-item');
    if (!quickReplyButton && !contextMenuItem) {
        return false;
    }
    if (target.closest('.qr--button-expander')) {
        return false;
    }
    if (quickReplyButton && event.ctrlKey) {
        return false;
    }
    mfiQuickReplyUserIntentUntil = performance.now() + 1000;
    return true;
}

/** 安装 ST 自带快捷回复的窄入口包装，只处理用户本次主动执行。 */
function mfiInstallQuickReplyGuard() {
    const epoch = ++mfiQuickReplyGuardEpoch;
    mfiQuickReplyGuardActive = true;

    import('/scripts/extensions/quick-reply/src/QuickReplySet.js')
        .then(function (module) {
            if (!mfiQuickReplyGuardActive || epoch !== mfiQuickReplyGuardEpoch) {
                return;
            }
            const prototype = module.QuickReplySet?.prototype;
            if (!prototype || typeof prototype.executeWithOptions !== 'function') {
                return;
            }

            mfiQuickReplySetPrototype = prototype;
            const original = prototype.executeWithOptions;
            if (original === mfiQuickReplyGuardWrappedExecuteWithOptions) {
                return;
            }

            const wrapped = async function (qr, options = {}) {
                if (!mfiQuickReplyGuardActive) {
                    return original.call(this, qr, options);
                }
                if (options.isAutoExecute || options.isEditor || performance.now() > mfiQuickReplyUserIntentUntil) {
                    return original.call(this, qr, options);
                }

                const commandText = mfiGetQuickReplyCommandText(this, qr, options);
                const action = mfiGetGenerationActionFromText(commandText);
                if (!action) {
                    return original.call(this, qr, options);
                }

                mfiQuickReplyUserIntentUntil = 0;
                const confirmed = mfiGenerationConfirmRequest
                    ? await mfiGenerationConfirmRequest(action)
                    : false;
                if (!confirmed || !mfiQuickReplyGuardActive) {
                    return '';
                }
                return original.call(this, qr, options);
            };

            mfiQuickReplyGuardOriginalExecuteWithOptions = original;
            mfiQuickReplyGuardWrappedExecuteWithOptions = wrapped;
            prototype.executeWithOptions = wrapped;
        })
        .catch(function (error) {
            console.warn('[MobileFocus] 模块 G 快捷回复确认接入失败：', error);
        });
}

/** 移除快捷回复包装；只恢复自己安装的那一层。 */
function mfiUninstallQuickReplyGuard() {
    mfiQuickReplyGuardActive = false;
    mfiQuickReplyGuardEpoch += 1;
    mfiQuickReplyUserIntentUntil = 0;

    if (mfiQuickReplySetPrototype
        && mfiQuickReplyGuardWrappedExecuteWithOptions
        && mfiQuickReplySetPrototype.executeWithOptions === mfiQuickReplyGuardWrappedExecuteWithOptions) {
        mfiQuickReplySetPrototype.executeWithOptions = mfiQuickReplyGuardOriginalExecuteWithOptions;
    }
    mfiQuickReplySetPrototype = null;
    mfiQuickReplyGuardOriginalExecuteWithOptions = null;
    mfiQuickReplyGuardWrappedExecuteWithOptions = null;
}

function initGenerationConfirmGuard() {
    if (window.__generationConfirmGuardInstalled__) {
        return;
    }

    window.__generationConfirmGuardInstalled__ = true;
    let destroyed = false;
    let pending = false;
    let activePopup = null;
    let lastTouchAt = 0;
    let lastTouchTarget = null;

    function stopEvent(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function requestConfirmation(action) {
        if (destroyed || pending) {
            return Promise.resolve(false);
        }
        pending = true;
        const text = action === 'regenerate'
            ? '确认重新生成此回复？'
            : '确认生成备选回复？';
        const okText = action === 'regenerate' ? '重新生成' : '生成备选';
        const context = getStContext();

        return new Promise(function (resolve) {
            let popupResult = null;
            if (context?.Popup
                && context.POPUP_TYPE
                && context.POPUP_RESULT) {
                try {
                    activePopup = new context.Popup(text, context.POPUP_TYPE.CONFIRM, '', {
                        okButton: okText,
                        cancelButton: '取消',
                        defaultResult: context.POPUP_RESULT.NEGATIVE,
                    });
                    activePopup.show().then(function (result) {
                        popupResult = result;
                        resolve(!destroyed && result === context.POPUP_RESULT.AFFIRMATIVE);
                    }).catch(function () {
                        resolve(false);
                    });
                    return;
                } catch (error) {
                    console.warn('[MobileFocus] 模块 G ST 确认弹窗创建失败，改用浏览器确认：', error);
                }
            }

            try {
                popupResult = window.confirm(text);
            } catch (error) {
                popupResult = false;
            }
            resolve(!destroyed && popupResult === true);
        }).finally(function () {
            pending = false;
            activePopup = null;
        });
    }

    async function confirmAndReplay(event, action, element) {
        stopEvent(event);
        const confirmed = await requestConfirmation(action);
        if (!confirmed || destroyed || !(element instanceof HTMLElement)) {
            return;
        }
        window.setTimeout(function () {
            if (!destroyed) {
                element.click();
            }
        }, 0);
    }

    function onClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || !event.isTrusted) {
            return;
        }

        mfiMarkQuickReplyUserIntent(event);

        const sendButton = target.closest('#send_but');
        if (sendButton) {
            const text = document.getElementById('send_textarea')?.value ?? '';
            const action = mfiGetGenerationActionFromText(text);
            if (action && !mfiIsGenerationInProgress()) {
                void confirmAndReplay(event, action, sendButton);
                return;
            }
            if (mfiHasQuickReplyInvocation(text)) {
                mfiQuickReplyUserIntentUntil = performance.now() + 2000;
            }
        }

        const regenerateButton = target.closest('#option_regenerate');
        if (regenerateButton && !mfiIsGenerationInProgress()) {
            void confirmAndReplay(event, 'regenerate', regenerateButton);
            return;
        }

        const rightSwipeButton = target.closest('.last_mes .swipe_right');
        if (rightSwipeButton && mfiWillRightSwipeGenerate(true)) {
            void confirmAndReplay(event, 'swipe', rightSwipeButton);
        }
    }

    function onKeyDown(event) {
        if (!event.isTrusted) {
            return;
        }

        const sendTextarea = document.getElementById('send_textarea');
        if (event.key === 'Enter'
            && !event.isComposing
            && !event.shiftKey
            && !event.ctrlKey
            && !event.altKey
            && !event.metaKey
            && document.activeElement === sendTextarea) {
            const context = getStContext();
            let sendOnEnter = true;
            try {
                sendOnEnter = context?.shouldSendOnEnter?.() !== false;
            } catch (error) {
                /* 使用默认发送行为 */
            }
            if (sendOnEnter) {
                const text = sendTextarea?.value ?? '';
                const action = mfiGetGenerationActionFromText(text);
                const sendButton = document.getElementById('send_but');
                if (action && sendButton && !mfiIsGenerationInProgress()) {
                    void confirmAndReplay(event, action, sendButton);
                    return;
                }
                if (mfiHasQuickReplyInvocation(text)) {
                    mfiQuickReplyUserIntentUntil = performance.now() + 2000;
                }
            }
        }

        if (event.key !== 'ArrowRight'
            || event.repeat
            || event.shiftKey
            || event.ctrlKey
            || event.altKey
            || event.metaKey) {
            return;
        }
        if (!mfiCanUseKeyboardSwipe() || !mfiWillRightSwipeGenerate(true)) {
            return;
        }
        const rightSwipeButton = document.querySelector('.last_mes .swipe_right');
        if (rightSwipeButton) {
            void confirmAndReplay(event, 'swipe', rightSwipeButton);
        }
    }

    function onTouchStart(event) {
        if (!event.isTrusted) {
            return;
        }
        lastTouchAt = performance.now();
        lastTouchTarget = event.target;
    }

    function onSwipedLeft(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target
            || lastTouchTarget !== event.target
            || performance.now() - lastTouchAt > 1500) {
            return;
        }

        const context = getStContext();
        if (context?.powerUserSettings?.gestures === false
            || context?.Popup?.util?.isPopupOpen?.()) {
            return;
        }
        if (!target.closest('#sheld')
            || !target.closest('.last_mes')
            || document.getElementById('curEditTextarea')
            || !mfiWillRightSwipeGenerate(true)) {
            return;
        }

        const rightSwipeButton = target.closest('.last_mes')?.querySelector('.swipe_right');
        if (mfiIsVisibleElement(rightSwipeButton)) {
            void confirmAndReplay(event, 'swipe', rightSwipeButton);
        }
    }

    function destroy() {
        if (destroyed) {
            return;
        }
        destroyed = true;
        mfiGenerationConfirmRequest = null;
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('touchstart', onTouchStart, true);
        document.removeEventListener('swiped-left', onSwipedLeft, true);
        mfiUninstallQuickReplyGuard();
        if (activePopup && typeof activePopup.completeCancelled === 'function') {
            activePopup.completeCancelled().catch(function () {
                /* 页面切换或弹窗已关闭 */
            });
        }
        window.__generationConfirmGuardInstalled__ = false;
    }

    mfiGenerationConfirmRequest = requestConfirmation;
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('touchstart', onTouchStart, true);
    document.addEventListener('swiped-left', onSwipedLeft, true);
    mfiInstallQuickReplyGuard();

    window.__generationConfirmGuardDestroy__ = destroy;
    mfiLog('[MobileFocus] 模块 G 重新生成与备选生成确认就绪');
}

// ============================================================
// 扩展入口
// ============================================================

function isFeatureRuntimeInstalled(definition) {
    return !!window[definition.installedFlag];
}

function shouldRunFeature(definition) {
    if (!mfiSettingsLoaded || !mfiSettings || mfiSettings.masterEnabled === false) {
        return false;
    }
    const platform = getCurrentPlatform();
    if (!definition.platforms.includes(platform)) {
        return false;
    }
    const featureSettings = mfiSettings.features[definition.id];
    return !!featureSettings && featureSettings[platform] !== false;
}

function startFeatureRuntime(definition) {
    if (isFeatureRuntimeInstalled(definition) || typeof definition.init !== 'function') {
        return;
    }
    definition.init();
}

function stopFeatureRuntime(definition) {
    if (!isFeatureRuntimeInstalled(definition)) {
        return;
    }
    const destroy = window[definition.destroyName];
    if (typeof destroy === 'function') {
        destroy();
    }
}

function syncFeatureRuntime(definition) {
    if (shouldRunFeature(definition)) {
        startFeatureRuntime(definition);
    } else {
        stopFeatureRuntime(definition);
    }
}

function syncAllFeatureRuntimes() {
    MFI_FEATURE_DEFINITIONS.forEach(syncFeatureRuntime);
}

function stopAllRuntimeModules() {
    /* 逆序停止，先撤销依赖页面状态的模块，再由前置模块恢复自己修改过的行为。 */
    MFI_FEATURE_DEFINITIONS.slice().reverse().forEach(stopFeatureRuntime);
}

/** 页面离开只在整页重载、关闭、导航或进入后退缓存时触发，不响应设置面板开合。 */
function bindPageLifecycle() {
    if (pageLifecycleBound) {
        return;
    }
    pageLifecycleBound = true;
    window.addEventListener('pagehide', function () {
        if (mfiSettingsInitTimer) {
            clearTimeout(mfiSettingsInitTimer);
            mfiSettingsInitTimer = null;
        }
        stopSettingsPanelInjection();
        stopAllRuntimeModules();
    });
    window.addEventListener('pageshow', function (event) {
        if (!event.persisted) {
            return;
        }
        if (!mfiPluginInitialized) {
            schedulePluginInitializationRetry();
        } else if (mfiSettingsLoaded) {
            scheduleSettingsPanelInjection();
            syncAllFeatureRuntimes();
        }
    });
}

/** 直接启动全部模块，保留给单独模块测试使用。 */
function startAllModules() {
    initMobileFocusInterceptor();
    initPastePerformanceFix();
    initTokenCounterRenderFix();
    initNativeHasInvalidationFix();
    initDrawerAnimationOptimization();
    initHotswapCacheOptimization();
    initExternalKeyboardViewportFix();
    initInnerUiKeyboardLayoutFix();
    initExitConfirmGuard();
    initGenerationConfirmGuard();
    mfiLogLoaded();
}

function schedulePluginInitializationRetry() {
    if (mfiSettingsInitTimer) {
        return;
    }
    mfiSettingsInitTimer = setTimeout(function () {
        mfiSettingsInitTimer = null;
        initializePlugin();
    }, 100);
}

/** 正式入口：先读取设置，再按当前设备启动允许运行的功能。 */
function initializePlugin() {
    if (mfiPluginInitialized) {
        return;
    }
    if (!loadMfiSettings()) {
        mfiSettingsInitAttempts += 1;
        if (mfiSettingsInitAttempts < 50) {
            schedulePluginInitializationRetry();
            return;
        }
        /* ST 上下文长期不可用时保持插件静默，不擅自改动页面。 */
        return;
    }

    mfiPluginInitialized = true;
    bindPageLifecycle();
    scheduleSettingsPanelInjection();
    syncAllFeatureRuntimes();
    mfiLogLoaded();
}

function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializePlugin);
    } else {
        initializePlugin();
    }
}

/** ST clean hook：只删除本插件自己的配置。 */
function cleanExtensionData() {
    const context = getStContext();
    if (!context || !context.extensionSettings) {
        return;
    }
    delete context.extensionSettings[MFI_SETTINGS_KEY];
    if (typeof context.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    }
}

export { cleanExtensionData };

/* 测试和页面内诊断使用；正式运行逻辑仍由 initializePlugin 统一调度。 */
window.initMobileFocusInterceptor = initMobileFocusInterceptor;
window.initPastePerformanceFix = initPastePerformanceFix;
window.initTokenCounterRenderFix = initTokenCounterRenderFix;
window.initNativeHasInvalidationFix = initNativeHasInvalidationFix;
window.initDrawerAnimationOptimization = initDrawerAnimationOptimization;
window.initHotswapCacheOptimization = initHotswapCacheOptimization;
window.initExternalKeyboardViewportFix = initExternalKeyboardViewportFix;
window.initInnerUiKeyboardLayoutFix = initInnerUiKeyboardLayoutFix;
window.initExitConfirmGuard = initExitConfirmGuard;
window.initGenerationConfirmGuard = initGenerationConfirmGuard;
window.startAllModules = startAllModules;
window.initializePlugin = initializePlugin;
window.stopAllRuntimeModules = stopAllRuntimeModules;
window.__MFI_TEST_API__ = {
    initializePlugin,
    startAllModules,
    stopAllRuntimeModules,
    syncAllFeatureRuntimes,
    getCurrentPlatform,
    isStandaloneAppMode,
    getGenerationActionFromText: mfiGetGenerationActionFromText,
    willRightSwipeGenerate: mfiWillRightSwipeGenerate,
    isQuickReplyGuardInstalled: function () {
        return !!mfiQuickReplySetPrototype;
    },
    getSettings: function () {
        return mfiSettings ? JSON.parse(JSON.stringify(mfiSettings)) : null;
    },
    loadMfiSettings,
    saveMfiSettings,
    cleanExtensionData,
};
window.__MFI_MODULE_LOADED__ = true;

if (typeof window !== 'undefined' && !window.ST_EXTENSION) {
    init();
}
