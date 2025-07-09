// 使用 jQuery 的 ready 函数确保在执行代码前，页面的所有 DOM 元素都已经加载完毕。
// async 关键字允许我们在函数内部使用 await 来处理异步操作，例如加载文件或等待AI响应。
jQuery(async () => {
    // ===================================================================================
    // 0. 更新器模块
    // ===================================================================================
    const Updater = {
        gitRepoOwner: "1830488003",
        gitRepoName: "real-time-status-bar",
        currentVersion: "0.0.0",
        latestVersion: "0.0.0",
        changelogContent: "",

        async fetchRawFileFromGitHub(filePath) {
            const url = `https://raw.githubusercontent.com/${this.gitRepoOwner}/${this.gitRepoName}/main/${filePath}`;
            const response = await fetch(url, { cache: "no-cache" });
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch ${filePath} from GitHub: ${response.statusText}`
                );
            }
            return response.text();
        },

        parseVersion(content) {
            try {
                return JSON.parse(content).version || "0.0.0";
            } catch (error) {
                console.error(
                    `[${extensionName}] Failed to parse version:`,
                    error
                );
                return "0.0.0";
            }
        },

        compareVersions(v1, v2) {
            const parts1 = v1.split(".").map(Number);
            const parts2 = v2.split(".").map(Number);
            for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                const p1 = parts1[i] || 0;
                const p2 = parts2[i] || 0;
                if (p1 > p2) return 1;
                if (p1 < p2) return -1;
            }
            return 0;
        },

        async performUpdate() {
            const { getRequestHeaders } = SillyTavern.getContext().common;
            const { extension_types } = SillyTavern.getContext().extensions;
            toastr.info("正在开始更新...");
            try {
                const response = await fetch("/api/extensions/update", {
                    method: "POST",
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        extensionName: extensionName,
                        global: extension_types[extensionName] === "global",
                    }),
                });
                if (!response.ok) throw new Error(await response.text());

                toastr.success("更新成功！将在3秒后刷新页面应用更改。");
                setTimeout(() => location.reload(), 3000);
            } catch (error) {
                toastr.error(`更新失败: ${error.message}`);
            }
        },

        async showUpdateConfirmDialog() {
            try {
                this.changelogContent = await this.fetchRawFileFromGitHub(
                    "CHANGELOG.md"
                );
            } catch (error) {
                this.changelogContent = `发现新版本 ${this.latestVersion}！您想现在更新吗？`;
            }
            if (
                await SillyTavern.callGenericPopup(
                    this.changelogContent,
                    "confirm",
                    {
                        okButton: "立即更新",
                        cancelButton: "稍后",
                        wide: true,
                        large: true,
                    }
                )
            ) {
                await this.performUpdate();
            }
        },

        async checkForUpdates(isManual = false) {
            const $updateButton = $("#rt-status-bar-check-for-updates");
            const $updateIndicator = $(".update-indicator");

            if (isManual) {
                $updateButton
                    .prop("disabled", true)
                    .html('<i class="fas fa-spinner fa-spin"></i> 检查中...');
            }
            try {
                const localManifestText = await (
                    await fetch(
                        `/${extensionFolderPath}/manifest.json?t=${Date.now()}`
                    )
                ).text();
                this.currentVersion = this.parseVersion(localManifestText);
                $("#rt-status-bar-current-version").text(this.currentVersion);

                const remoteManifestText = await this.fetchRawFileFromGitHub(
                    "manifest.json"
                );
                this.latestVersion = this.parseVersion(remoteManifestText);

                if (
                    this.compareVersions(
                        this.latestVersion,
                        this.currentVersion
                    ) > 0
                ) {
                    $updateIndicator.show();
                    $updateButton
                        .html(
                            `<i class="fa-solid fa-gift"></i> 发现新版 ${this.latestVersion}!`
                        )
                        .off("click")
                        .on("click", () => this.showUpdateConfirmDialog());
                    if (isManual)
                        toastr.success(
                            `发现新版本 ${this.latestVersion}！点击按钮进行更新。`
                        );
                } else {
                    $updateIndicator.hide();
                    if (isManual) toastr.info("您当前已是最新版本。");
                }
            } catch (error) {
                if (isManual) toastr.error(`检查更新失败: ${error.message}`);
            } finally {
                if (
                    isManual &&
                    this.compareVersions(
                        this.latestVersion,
                        this.currentVersion
                    ) <= 0
                ) {
                    $updateButton
                        .prop("disabled", false)
                        .html(
                            '<i class="fa-solid fa-cloud-arrow-down"></i> 检查更新'
                        );
                }
            }
        },
    };

    // ===================================================================================
    // 1. 初始化和常量定义
    // ===================================================================================

    const extensionName = "real-time-status-bar";
    const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
    let isGenerating = false;
    let lastProcessedMessageId = -1; // 跟踪最后处理过的AI消息ID
    let lastMessageForRegeneration = null; // 新增：存储用于重新生成的消息
    let currentChatFileIdentifier = "unknown_chat_init"; // 跟踪当前聊天文件

    let SYSTEM_PROMPT = ""; // 将在init()中从外部文件加载
    let DEFAULT_STATUS_PROMPT = ""; // 新增：用于存储默认的状态栏要求
    let AVATAR_PROMPT_GUIDE = ""; // 新增：用于存储头像提示词指南
    let CHOICE_PROMPT_GUIDE = ""; // 新增：用于存储选项提示词指南

    const defaultSettings = {
        enabled: true, // 默认启用插件
        statusBarRequirements:
            "示例：\n请为角色创建一个状态栏，包含以下部分：\n- **核心状态**: 显示生命值（HP）和法力值（MP）。\n- **情绪**: 用一个词描述当前情绪。\n- **装备**: 列出当前装备的武器和护甲。\n- **关键物品**: 显示背包中最重要的三件物品。\n设计风格要求简洁、带有赛博朋克感，主色调为青色和品红色。",
        readWorldBook: true, // 默认读取世界书
        generateChoices: false, // 新增：默认禁用选项生成
        useAvatar: true, // 新增：默认启用AI动态头像
        showRegenerateButton: true, // 新增：默认显示重新生成按钮
        aiSource: "tavern", // 'tavern' 或 'custom'
        apiUrl: "",
        apiKey: "",
        apiModel: "",
    };

    let settings = {};

    // ===================================================================================
    // 2. 辅助函数
    // ===================================================================================

    /**
     * 生成一个简单的唯一ID，用于占位符。
     * @returns {string} 唯一ID字符串
     */
    /**
     * 处理AI返回的原始文本，提取并清理HTML内容。
     * @param {string} generationResult - AI返回的原始字符串。
     * @returns {string} 清理后的HTML字符串。
     */
    function processAiResponse(generationResult) {
        if (!generationResult || !generationResult.trim()) {
            return "❌ AI未能生成有效的状态栏内容。";
        }
        let generatedHtml = generationResult.trim();
        // 提取被 ```html ... ``` 包裹的代码
        const match = generatedHtml.match(/```html\s*([\s\S]+?)\s*```/);
        if (match && match[1]) {
            generatedHtml = match[1].trim();
        }
        return generatedHtml;
    }

    function generateUniqueId() {
        return `rt-status-bar-${Date.now()}-${Math.random()
            .toString(36)
            .substring(2, 9)}`;
    }

    /**
     * 安全地转义HTML特殊字符。
     * @param {string} unsafe - 需要转义的字符串。
     * @returns {string} 转义后的安全字符串。
     */
    const escapeHtml = (unsafe) => {
        if (unsafe === null || typeof unsafe === "undefined") return "";
        return String(unsafe)
            .replace(/&/g, "&")
            .replace(/</g, "<")
            .replace(/>/g, ">")
            .replace(/"/g, '"')
            .replace(/'/g, "&#039;");
    };

    /**
     * 使用唯一ID找到并替换占位符的内容。
     * @param {string} uniqueId - 占位符的唯一ID。
     * @param {string} replacementHtml - 用于替换的HTML内容。
     * @param {number} messageId - 包含此状态栏的消息ID，用于删除。
     */
    function replacePlaceholder(uniqueId, replacementHtml, messageId) {
        // 新增：可折叠的日志输出AI返回的HTML
        console.groupCollapsed(`[${extensionName}] AI返回的HTML内容 (点击展开): ${replacementHtml.substring(0, 200)}...`);
        console.log(replacementHtml);
        console.groupEnd();

        const placeholderSpan = $(`#${uniqueId}`);
        if (placeholderSpan.length) {
            const containerId = `rt-container-${uniqueId}`;
            const contentWrapperId = `rt-content-${uniqueId}`;
            
            // 将AI内容包裹在一个专用的div中，方便后续替换
            const containerHtml = `
                <div id="${containerId}" class="rt-status-bar-container">
                    <div id="${contentWrapperId}">${replacementHtml}</div>
                </div>`;
            
            placeholderSpan.replaceWith(containerHtml);
            const $container = $(`#${containerId}`);

            if (settings.showRegenerateButton && $container.length) {
                const regenerateButtonHtml = `<button type="button" class="rt-status-bar-regenerate-button" title="重新生成"><i class="fas fa-sync-alt"></i></button>`;
                $container.append(regenerateButtonHtml);

                // 优化后的重新生成逻辑
                $container.find('.rt-status-bar-regenerate-button').on('click', async function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    
                    if (isGenerating) {
                        toastr.warning('正在生成中，请稍候...');
                        return;
                    }
                    if (!lastMessageForRegeneration) {
                        toastr.error('没有可用于重新生成的消息上下文。');
                        return;
                    }

                    isGenerating = true;
                    const $contentWrapper = $container.find(`#${contentWrapperId}`);

                    try {
                        // 1. 立即在原位显示加载状态
                        $contentWrapper.html(`<span>⏳ <i>Beilu 正在重新构建状态界面...</i></span>`);

                        // 2. 构建Prompt并调用AI（增加60秒超时）
                        const finalPrompt = await buildFinalPrompt(lastMessageForRegeneration);
                        let generationResult = "";
                        const aiCallPromise = settings.aiSource === 'custom'
                            ? callCustomApi(finalPrompt)
                            : TavernHelper.generateRaw({ ordered_prompts: [{ role: 'user', content: finalPrompt }] });

                        generationResult = await withTimeout(aiCallPromise, 60000); // 60秒超时
                        
                        // 3. 处理结果并替换加载状态
                        const generatedHtml = processAiResponse(generationResult);
                        $contentWrapper.html(generatedHtml);

                        if (!generatedHtml.startsWith('❌')) {
                            toastr.success("状态栏已重新生成！");
                        } else {
                            toastr.warning(generatedHtml);
                        }

                    } catch (error) {
                        console.error(`[${extensionName}] 重新生成时出错:`, error);
                        const errorMsg = `❌ 重新生成时发生错误: ${escapeHtml(error.message)}`;
                        $contentWrapper.html(errorMsg);
                        toastr.error('重新生成失败。');
                    } finally {
                        isGenerating = false;
                    }
                });
            }

            console.log(`[${extensionName}] 成功替换占位符 #${uniqueId}`);
        } else {
            console.warn(
                `[${extensionName}] 未找到用于替换的占位符 #${uniqueId}`
            );
        }
    }

    /**
     * 为一个Promise增加超时功能。
     * @param {Promise} promise - 需要被包装的Promise。
     * @param {number} ms - 超时时间（毫秒）。
     * @returns {Promise} - 包装后的Promise，会在超时后reject。
     */
    function withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`操作超时（超过 ${ms / 1000} 秒）`));
            }, ms);

            promise.then(
                (res) => {
                    clearTimeout(timeoutId);
                    resolve(res);
                },
                (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                }
            );
        });
    }

    /**
     * 根据AI源选择，显示或隐藏自定义API设置区域
     */
    function toggleCustomApiSettings() {
        if ($("#rt-status-bar-ai-source").val() === "custom") {
            $("#rt-status-bar-custom-api-settings").removeClass("hidden");
        } else {
            $("#rt-status-bar-custom-api-settings").addClass("hidden");
        }
    }

    /**
     * 从自定义API端点获取并填充模型列表
     */
    async function fetchApiModels() {
        const apiUrl = $("#rt-status-bar-api-url").val().trim();
        const apiKey = $("#rt-status-bar-api-key").val().trim();
        const $modelSelect = $("#rt-status-bar-api-model");
        const $fetchButton = $("#rt-status-bar-fetch-models");

        if (!apiUrl) {
            toastr.warning("请输入API基础URL。");
            return;
        }

        // 禁用按钮并显示加载状态
        $fetchButton.prop("disabled", true).addClass("fa-spin");
        toastr.info("正在从API加载模型列表...");

        try {
            // 采用 AutoCardUpdaterExtension 中更健壮的URL构建逻辑
            let modelsUrl = apiUrl;
            if (!modelsUrl.endsWith("/")) {
                modelsUrl += "/";
            }
            if (modelsUrl.includes("generativelanguage.googleapis.com")) {
                if (!modelsUrl.endsWith("models")) modelsUrl += "models";
            } else if (modelsUrl.endsWith("/v1/")) {
                modelsUrl += "models";
            } else if (!modelsUrl.endsWith("models")) {
                modelsUrl += "v1/models";
            }

            const headers = { "Content-Type": "application/json" };
            if (apiKey) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            const response = await fetch(modelsUrl, { method: "GET", headers });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `获取模型列表失败: ${response.status} - ${errorText}`
                );
            }

            const data = await response.json();
            const models = data.data || data; // 兼容不同API的返回格式

            if (!Array.isArray(models) || models.length === 0) {
                throw new Error("API返回的模型列表为空或格式不正确。");
            }

            const currentlySelected = settings.apiModel;
            $modelSelect.empty(); // 清空现有选项

            models.forEach((model) => {
                const modelId = model.id;
                if (modelId) {
                    const option = new Option(
                        modelId,
                        modelId,
                        false,
                        modelId === currentlySelected
                    );
                    $modelSelect.append(option);
                }
            });

            toastr.success(`成功加载了 ${models.length} 个模型。`);
            // 触发一次保存，以防选择的模型发生了变化
            saveSettings(false);
        } catch (error) {
            console.error(`[${extensionName}] 获取模型列表时出错:`, error);
            toastr.error(`加载模型失败: ${error.message}`);
            $modelSelect
                .empty()
                .append(new Option("加载失败，请检查URL/密钥并重试", ""));
        } finally {
            // 恢复按钮状态
            $fetchButton.prop("disabled", false).removeClass("fa-spin");
        }
    }

    // ===================================================================================
    // 3. 设置管理 (加载与保存)
    // ===================================================================================

    /**
     * 加载插件设置。
     * 从 SillyTavern 的全局设置对象中读取，并更新UI。
     */
    function loadSettings() {
        // 确保插件的设置对象存在
        if (!SillyTavern.getContext().extensionSettings[extensionName]) {
            SillyTavern.getContext().extensionSettings[extensionName] = {};
        }

        // 合并默认设置和已保存的设置
        settings = Object.assign(
            {},
            defaultSettings,
            SillyTavern.getContext().extensionSettings[extensionName]
        );

        // 更新设置页面的UI元素
        $("#rt-status-bar-enabled").prop("checked", settings.enabled);
        // 核心修改：如果用户保存的提示词为空，则加载默认提示词
        if (
            settings.statusBarRequirements &&
            settings.statusBarRequirements.trim() !== ""
        ) {
            $("#rt-status-bar-requirements").val(
                settings.statusBarRequirements
            );
        } else {
            $("#rt-status-bar-requirements").val(DEFAULT_STATUS_PROMPT);
        }
        $("#rt-status-bar-read-worldbook").prop(
            "checked",
            settings.readWorldBook
        );
        $("#rt-status-bar-generate-choices").prop("checked", settings.generateChoices);
        $("#rt-status-bar-use-avatar").prop("checked", settings.useAvatar); // 加载新设置
        $("#rt-status-bar-show-regenerate-button").prop("checked", settings.showRegenerateButton);
        $("#rt-status-bar-ai-source").val(settings.aiSource);
        $("#rt-status-bar-api-url").val(settings.apiUrl);
        $("#rt-status-bar-api-key").val(settings.apiKey);

        // 优化模型加载：如果已保存模型，先显示它作为占位符
        const $modelSelect = $("#rt-status-bar-api-model");
        if (settings.apiModel) {
            $modelSelect
                .empty()
                .append(
                    new Option(
                        `${settings.apiModel} (已保存)`,
                        settings.apiModel
                    )
                );
            $modelSelect.val(settings.apiModel);
        } else {
            $modelSelect.empty().append(new Option("请先加载模型", ""));
        }

        // 根据AI源显示/隐藏自定义API设置
        toggleCustomApiSettings();

        // 从localStorage加载并显示上一次生成的预览
        const lastHtml =
            localStorage.getItem(`${extensionName}_last_html`) ||
            "尚未生成任何内容。";
        $("#rt-status-bar-preview").html(lastHtml);
    }

    /**
     * 保存插件设置。
     * 将UI元素的状态保存到 SillyTavern 的全局设置对象中。
     */
    function saveSettings(showToast = false) {
        settings.enabled = $("#rt-status-bar-enabled").is(":checked");
        settings.statusBarRequirements = $("#rt-status-bar-requirements").val();
        settings.readWorldBook = $("#rt-status-bar-read-worldbook").is(
            ":checked"
        );
        settings.generateChoices = $("#rt-status-bar-generate-choices").is(":checked");
        settings.useAvatar = $("#rt-status-bar-use-avatar").is(":checked"); // 保存新设置
        settings.showRegenerateButton = $("#rt-status-bar-show-regenerate-button").is(":checked");
        settings.aiSource = $("#rt-status-bar-ai-source").val();
        settings.apiUrl = $("#rt-status-bar-api-url").val();
        settings.apiKey = $("#rt-status-bar-api-key").val();
        settings.apiModel = $("#rt-status-bar-api-model").val();

        SillyTavern.getContext().extensionSettings[extensionName] = settings;

        // 调用 SillyTavern 的函数来保存设置，这通常是防抖的，以避免频繁写入。
        SillyTavern.getContext().saveSettingsDebounced();

        if (showToast) {
            toastr.success("设置已保存！");
        }
    }

    // ===================================================================================
    // 4. 核心功能：AI调用与内容处理
    // ===================================================================================

    /**
     * 构建发送给AI的最终提示词。
     * 采用简单直接的字符串拼接方式，确保所有模块按正确顺序组合。
     * @param {object} messageToProcess - 用于上下文的消息对象。
     * @returns {Promise<string>} 构建完成的提示词字符串。
     */
    async function buildFinalPrompt(messageToProcess) {
        // 使用一个数组来收集所有提示词片段，最后用换行符连接，更清晰、高效。
        const promptParts = [];

        // 1. 核心系统指令 (始终存在)
        promptParts.push(SYSTEM_PROMPT);

        // 2. AI动态头像指南 (如果启用)
        if (settings.useAvatar && AVATAR_PROMPT_GUIDE) {
            promptParts.push(AVATAR_PROMPT_GUIDE);
        }

        // 3. 选项生成指南 (如果启用)
        if (settings.generateChoices && CHOICE_PROMPT_GUIDE) {
            promptParts.push(CHOICE_PROMPT_GUIDE);
        }

        // 4. 世界书内容 (如果启用)
        if (settings.readWorldBook) {
            try {
                const lorebookSettings = TavernHelper.getLorebookSettings();
                const charLorebook = TavernHelper.getCurrentCharPrimaryLorebook();
                const chatLorebook = await TavernHelper.getChatLorebook();
                const activeLorebookNames = new Set(
                    [
                        ...(lorebookSettings.selected_global_lorebooks || []),
                        charLorebook,
                        chatLorebook,
                    ].filter(Boolean)
                );

                if (activeLorebookNames.size > 0) {
                    let allActiveEntries = [];
                    for (const bookName of activeLorebookNames) {
                        const entries = await TavernHelper.getLorebookEntries(bookName);
                        allActiveEntries.push(...entries.filter((entry) => entry.enabled));
                    }
                    if (allActiveEntries.length > 0) {
                        const worldBookContent = allActiveEntries
                            .map((entry) => `### ${entry.comment || entry.keys.join(", ")}\n${entry.content}`)
                            .join("\n\n");
                        promptParts.push(`**相关世界观设定:**\n${worldBookContent}`);
                        console.log(`[${extensionName}] 成功加载 ${allActiveEntries.length} 个世界书条目。`);
                    }
                }
            } catch (err) {
                console.error(`[${extensionName}] 获取世界书条目时出错:`, err);
            }
        }

        // 5. 最新对话内容
        if (messageToProcess) {
            promptParts.push(`**最新对话内容:**\n${messageToProcess.name}: ${messageToProcess.message}`);
        }

        // 6. 用户具体要求
        promptParts.push(`**用户具体要求:**\n${settings.statusBarRequirements}`);

        // 将所有部分用分隔符连接成最终的字符串
        const finalPrompt = promptParts.join('\n\n---\n\n');
        
        // 新增：可折叠的日志输出
        console.groupCollapsed(`[${extensionName}] 构建的最终Prompt (点击展开): ${finalPrompt.substring(0, 200)}...`);
        console.log(finalPrompt);
        console.groupEnd();

        return finalPrompt;
    }

    /**
     * 调用自定义的OpenAI兼容API
     * @param {string} prompt - 发送给AI的完整提示词
     * @returns {Promise<string>} - AI返回的文本内容
     */
    async function callCustomApi(prompt) {
        const { apiUrl, apiKey, apiModel } = settings;

        if (!apiUrl || !apiModel) {
            throw new Error("自定义API的URL和模型名称不能为空。");
        }

        // 参考 AutoCardUpdaterExtension 的增强URL构建逻辑
        let finalUrl = apiUrl.trim();
        if (!finalUrl.endsWith("/")) {
            finalUrl += "/";
        }

        // 针对不同API服务类型，构建最终的聊天补全端点URL
        if (finalUrl.includes("generativelanguage.googleapis.com")) {
            // 谷歌AI的特殊处理
            if (!finalUrl.endsWith("chat/completions")) {
                finalUrl += "chat/completions";
            }
        } else if (finalUrl.endsWith("/v1/")) {
            // 标准OpenAI兼容API
            finalUrl += "chat/completions";
        } else if (!finalUrl.includes("/chat/completions")) {
            // 其他情况，尝试补全 /v1/chat/completions
            finalUrl += "v1/chat/completions";
        }

        const headers = {
            "Content-Type": "application/json",
        };
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const body = JSON.stringify({
            model: apiModel,
            messages: [{ role: "user", content: prompt }],
            stream: false,
        });

        console.log(`[${extensionName}] 正在调用自定义API...`, {
            url: finalUrl,
            model: apiModel,
        });
        const response = await fetch(finalUrl, {
            method: "POST",
            headers: headers,
            body: body,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
                `自定义API请求失败: ${response.status} ${response.statusText} - ${errorBody}`
            );
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    }

    /**
     * 插件的核心处理函数。
     * @param {object} messageToProcess - 由轮询机制确定的、需要处理的那条AI消息。
     */
    async function handleNewMessage(messageToProcess) {
        // 保存消息以备重新生成
        lastMessageForRegeneration = messageToProcess;

        if (!settings.enabled || isGenerating) {
            return;
        }

        isGenerating = true;
        const uniqueId = generateUniqueId();

        try {
            // 1. 注入占位符
            await TavernHelper.createChatMessages(
                [{
                    role: "system",
                    message: `<span id="${uniqueId}">⏳ <i>Beilu 正在构建状态界面...</i></span>`,
                    is_hidden: false,
                }], { refresh: "affected" }
            );
            console.log(`[${extensionName}] 已注入占位符: #${uniqueId}`);

            const newMessages = await TavernHelper.getChatMessages(-1);
            const placeholderMessageId = newMessages?.[0]?.message_id;
            if (typeof placeholderMessageId === 'undefined') {
                console.error(`[${extensionName}] 严重错误：无法获取刚创建的占位符消息ID。`);
            }

            // 2. 构建Prompt
            const finalPrompt = await buildFinalPrompt(messageToProcess);

            // 3. 调用AI（增加60秒超时）
            toastr.info("正在调用AI生成状态栏...");
            let generationResult = "";
            const aiCallPromise = settings.aiSource === 'custom'
                ? callCustomApi(finalPrompt)
                : TavernHelper.generateRaw({ ordered_prompts: [{ role: 'user', content: finalPrompt }] });

            generationResult = await withTimeout(aiCallPromise, 60000); // 60秒超时

            // 4. 处理并替换内容
            const generatedHtml = processAiResponse(generationResult);
            replacePlaceholder(uniqueId, generatedHtml, placeholderMessageId);
            if (!generatedHtml.startsWith('❌')) {
                toastr.success("实时状态栏已更新！");
            } else {
                toastr.warning(generatedHtml);
            }

        } catch (error) {
            console.error(`[${extensionName}] 插件出错:`, error);
            const errorMsg = `❌ 生成状态栏时发生错误: ${escapeHtml(
                error.message
            )}`;
            replacePlaceholder(uniqueId, errorMsg);
            toastr.error("生成实时状态栏时发生错误，请查看浏览器控制台(F12)。");
        } finally {
            isGenerating = false;
        }
    }

    // ===================================================================================
    // 5. 事件监听与初始化
    // ===================================================================================

    /**
     * 清理聊天文件名，移除路径和扩展名。
     * @param {string} fileName - 原始文件名。
     * @returns {string} 清理后的文件名。
     */
    function cleanChatName(fileName) {
        if (!fileName || typeof fileName !== "string")
            return "unknown_chat_source";
        let cleanedName = fileName;
        if (fileName.includes("/") || fileName.includes("\\")) {
            const parts = fileName.split(/[\\/]/);
            cleanedName = parts[parts.length - 1];
        }
        return cleanedName.replace(/\.jsonl$/, "").replace(/\.json$/, "");
    }

    /**
     * 获取当前最新的聊天文件名标识符。
     * 借鉴自 AutoCardUpdaterExtension 的成熟方案。
     * @returns {Promise<string>} 最新的聊天文件名。
     */
    async function getLatestChatName() {
        let newChatFileIdentifier = "unknown_chat_fallback";
        try {
            let chatNameFromCommand = null;
            if (
                TavernHelper &&
                typeof TavernHelper.triggerSlash === "function"
            ) {
                chatNameFromCommand = await TavernHelper.triggerSlash(
                    "/getchatname"
                );
            }

            if (
                chatNameFromCommand &&
                typeof chatNameFromCommand === "string" &&
                chatNameFromCommand.trim() &&
                chatNameFromCommand.trim() !== "null" &&
                chatNameFromCommand.trim() !== "undefined"
            ) {
                newChatFileIdentifier = cleanChatName(
                    chatNameFromCommand.trim()
                );
            } else {
                const contextFallback = SillyTavern.getContext
                    ? SillyTavern.getContext()
                    : null;
                if (
                    contextFallback &&
                    contextFallback.chat &&
                    typeof contextFallback.chat === "string"
                ) {
                    const chatNameFromContext = cleanChatName(
                        contextFallback.chat
                    );
                    if (
                        chatNameFromContext &&
                        !chatNameFromContext.startsWith("unknown_chat")
                    ) {
                        newChatFileIdentifier = chatNameFromContext;
                    }
                }
            }
        } catch (error) {
            console.error(`[${extensionName}] 获取聊天名称时出错:`, error);
        }
        return newChatFileIdentifier;
    }

    /**
     * 当检测到聊天切换时，重置插件的状态。
     * @param {string} newChatName - 新的聊天文件名。
     */
    async function resetScriptStateForNewChat(newChatName) {
        currentChatFileIdentifier = newChatName || "unknown_chat_fallback";
        // 关键：重置最后处理的消息ID，以便在新聊天中重新开始检测
        lastProcessedMessageId = -1;
    }

    /**
     * 使用轮询机制来检查新消息，并处理聊天切换。
     */
    function startPolling() {
        setInterval(async () => {
            if (isGenerating || !settings.enabled) {
                return;
            }

            try {
                // 1. 检查并处理聊天切换
                const latestChatName = await getLatestChatName();
                if (latestChatName && latestChatName !== currentChatFileIdentifier) {
                    await resetScriptStateForNewChat(latestChatName);
                }

                // 2. 获取最后一条消息
                const lastMessageArray = await TavernHelper.getChatMessages(-1);
                if (!lastMessageArray || lastMessageArray.length === 0) {
                    return;
                }
                const lastMessage = lastMessageArray[0];

                // 3. 检查最后一条消息是否合格
                const isNew = lastMessage.message_id > lastProcessedMessageId;
                const isAi = lastMessage.role !== 'user';
                const isNotSelf = !lastMessage.message.includes('class="rt-status-bar-container"');
                const isComplete = (lastMessage.message || "").length > 300;

                // 4. 如果所有条件都满足，则处理它
                if (isNew && isAi && isNotSelf && isComplete) {
                    // 立即更新ID，防止重复处理
                    lastProcessedMessageId = lastMessage.message_id;
                    // 调用核心函数
                    await handleNewMessage(lastMessage);
                }

            } catch (error) {
                console.error(`[${extensionName}] 轮询检查时出错:`, error);
            }
        }, 1500); // 每1.5秒检查一次
    }

    /**
     * 初始化函数
     * 负责加载UI、绑定事件和启动核心监听器。
     */
    async function init() {
        // 1. 加载设置界面的HTML
        const settingsHtml = await $.get(
            `${extensionFolderPath}/settings.html`
        );
        $("#extensions_settings2").append(settingsHtml);

        // 2. 并行异步加载所有必要的文本文件
        try {
            const [systemPromptData, defaultStatusPromptData, avatarPromptGuideData, choicePromptGuideData] =
                await Promise.all([
                    $.get(`${extensionFolderPath}/system_prompt.txt`),
                    $.get(`${extensionFolderPath}/default_status_prompt.txt`),
                    $.get(`${extensionFolderPath}/avatar_prompt_guide.txt`),
                    $.get(`${extensionFolderPath}/选项生成指南.txt`),
                ]);
            SYSTEM_PROMPT = systemPromptData;
            DEFAULT_STATUS_PROMPT = defaultStatusPromptData;
            AVATAR_PROMPT_GUIDE = avatarPromptGuideData;
            CHOICE_PROMPT_GUIDE = choicePromptGuideData;
            console.log(
                `[${extensionName}] 所有提示词模块已成功加载。`
            );
        } catch (error) {
            console.error(
                `[${extensionName}] 加载外部 .txt 文件时出错:`,
                error
            );
            toastr.error("加载插件核心文件失败，功能可能不完整。");
        }

        // 3. 加载设置
        loadSettings();

        // 4. 绑定UI事件
        const settingsContainer = $(
            `.extension_settings[data-extension-name="${extensionName}"]`
        );

        settingsContainer
            .find(".inline-drawer-toggle")
            .on("click", function () {
                $(this).closest(".inline-drawer").toggleClass("open");
            });

        // 对于即时更改的设置，静默保存
        $("#rt-status-bar-enabled").on("change", () => saveSettings(false));
        $("#rt-status-bar-requirements").on("input", () => saveSettings(false));
        $("#rt-status-bar-read-worldbook").on("change", () =>
            saveSettings(false)
        );
        $("#rt-status-bar-generate-choices").on("change", () => saveSettings(false));
        $("#rt-status-bar-use-avatar").on("change", () => saveSettings(false)); // 绑定新开关的事件
        $("#rt-status-bar-show-regenerate-button").on("change", () => saveSettings(false));
        $("#rt-status-bar-ai-source").on("change", () => {
            toggleCustomApiSettings();
            saveSettings(false);
        });

        // 对于需要明确点击的按钮，保存并显示提示
        $("#rt-status-bar-save-api").on("click", () => saveSettings(true));
        $("#rt-status-bar-fetch-models").on("click", fetchApiModels);

        // 新增：当用户从下拉列表选择新模型时，自动静默保存
        $("#rt-status-bar-api-model").on("change", () => saveSettings(false));

        // 更新器事件
        $("#rt-status-bar-check-for-updates").on("click", () =>
            Updater.checkForUpdates(true)
        );

        // 5. 获取初始聊天状态并启动轮询
        const initialChatName = await getLatestChatName();
        await resetScriptStateForNewChat(initialChatName);
        startPolling();

        // 6. 初始更新检查
        Updater.checkForUpdates(false);

        console.log(`[${extensionName}] 插件(v1.1.0)已成功加载并初始化。`);
    }

    init();
});
