// 使用 jQuery 的 ready 函数确保在执行代码前，页面的所有 DOM 元素都已经加载完毕。
// async 关键字允许我们在函数内部使用 await 来处理异步操作，例如加载文件或等待AI响应。
jQuery(async () => {
    // ===================================================================================
    // 1. 初始化和常量定义
    // ===================================================================================

    const extensionName = "real-time-status-bar";
    const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
    let isGenerating = false;
    let lastProcessedMessageId = -1; // 跟踪最后处理过的AI消息ID
let currentChatFileIdentifier = 'unknown_chat_init'; // 跟踪当前聊天文件

let SYSTEM_PROMPT = ''; // 将在init()中从外部文件加载
let DEFAULT_STATUS_PROMPT = ''; // 新增：用于存储默认的状态栏要求

const defaultSettings = {
        enabled: true, // 默认启用插件
        statusBarRequirements: "示例：\n请为角色创建一个状态栏，包含以下部分：\n- **核心状态**: 显示生命值（HP）和法力值（MP）。\n- **情绪**: 用一个词描述当前情绪。\n- **装备**: 列出当前装备的武器和护甲。\n- **关键物品**: 显示背包中最重要的三件物品。\n设计风格要求简洁、带有赛博朋克感，主色调为青色和品红色。",
        readWorldBook: true, // 默认读取世界书
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
    function generateUniqueId() {
        return `rt-status-bar-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * 安全地转义HTML特殊字符。
     * @param {string} unsafe - 需要转义的字符串。
     * @returns {string} 转义后的安全字符串。
     */
    const escapeHtml = (unsafe) => {
        if (unsafe === null || typeof unsafe === 'undefined') return '';
        return String(unsafe)
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/'/g, '&#039;');
    };

    /**
     * 使用唯一ID找到并替换占位符的内容。
     * @param {string} uniqueId - 占位符的唯一ID。
     * @param {string} replacementHtml - 用于替换的HTML内容。
     */
    function replacePlaceholder(uniqueId, replacementHtml) {
        const placeholderSpan = $(`#${uniqueId}`);
        if (placeholderSpan.length) {
            // 直接用AI返回的完整HTML替换占位符的整个外部HTML
            // 这能更好地确保浏览器正确处理包含 <script> 标签的注入内容
            placeholderSpan.replaceWith(replacementHtml);
            console.log(`[${extensionName}] 成功替换占位符 #${uniqueId}`);
        } else {
            console.warn(`[${extensionName}] 未找到用于替换的占位符 #${uniqueId}`);
        }
    }

    /**
     * 根据AI源选择，显示或隐藏自定义API设置区域
     */
    function toggleCustomApiSettings() {
        if ($('#rt-status-bar-ai-source').val() === 'custom') {
            $('#rt-status-bar-custom-api-settings').removeClass('hidden');
        } else {
            $('#rt-status-bar-custom-api-settings').addClass('hidden');
        }
    }


    /**
     * 从自定义API端点获取并填充模型列表
     */
    async function fetchApiModels() {
        const apiUrl = $('#rt-status-bar-api-url').val().trim();
        const apiKey = $('#rt-status-bar-api-key').val().trim();
        const $modelSelect = $('#rt-status-bar-api-model');
        const $fetchButton = $('#rt-status-bar-fetch-models');

        if (!apiUrl) {
            toastr.warning("请输入API基础URL。");
            return;
        }

        // 禁用按钮并显示加载状态
        $fetchButton.prop('disabled', true).addClass('fa-spin');
        toastr.info("正在从API加载模型列表...");

        try {
            // 采用 AutoCardUpdaterExtension 中更健壮的URL构建逻辑
            let modelsUrl = apiUrl;
            if (!modelsUrl.endsWith('/')) {
                modelsUrl += '/';
            }
            if (modelsUrl.includes('generativelanguage.googleapis.com')) {
                if (!modelsUrl.endsWith('models')) modelsUrl += 'models';
            } else if (modelsUrl.endsWith('/v1/')) {
                modelsUrl += 'models';
            } else if (!modelsUrl.endsWith('models')) {
                modelsUrl += 'v1/models';
            }

            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const response = await fetch(modelsUrl, { method: 'GET', headers });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`获取模型列表失败: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            const models = data.data || data; // 兼容不同API的返回格式

            if (!Array.isArray(models) || models.length === 0) {
                throw new Error("API返回的模型列表为空或格式不正确。");
            }

            const currentlySelected = settings.apiModel;
            $modelSelect.empty(); // 清空现有选项

            models.forEach(model => {
                const modelId = model.id;
                if (modelId) {
                    const option = new Option(modelId, modelId, false, modelId === currentlySelected);
                    $modelSelect.append(option);
                }
            });

            toastr.success(`成功加载了 ${models.length} 个模型。`);
            // 触发一次保存，以防选择的模型发生了变化
            saveSettings(false);

        } catch (error) {
            console.error(`[${extensionName}] 获取模型列表时出错:`, error);
            toastr.error(`加载模型失败: ${error.message}`);
            $modelSelect.empty().append(new Option("加载失败，请检查URL/密钥并重试", ""));
        } finally {
            // 恢复按钮状态
            $fetchButton.prop('disabled', false).removeClass('fa-spin');
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
        settings = Object.assign({}, defaultSettings, SillyTavern.getContext().extensionSettings[extensionName]);

        // 更新设置页面的UI元素
        $('#rt-status-bar-enabled').prop('checked', settings.enabled);
        // 核心修改：如果用户保存的提示词为空，则加载默认提示词
        if (settings.statusBarRequirements && settings.statusBarRequirements.trim() !== '') {
            $('#rt-status-bar-requirements').val(settings.statusBarRequirements);
        } else {
            $('#rt-status-bar-requirements').val(DEFAULT_STATUS_PROMPT);
        }
        $('#rt-status-bar-read-worldbook').prop('checked', settings.readWorldBook);
        $('#rt-status-bar-ai-source').val(settings.aiSource);
        $('#rt-status-bar-api-url').val(settings.apiUrl);
        $('#rt-status-bar-api-key').val(settings.apiKey);
        
        // 优化模型加载：如果已保存模型，先显示它作为占位符
        const $modelSelect = $('#rt-status-bar-api-model');
        if (settings.apiModel) {
            $modelSelect.empty().append(new Option(`${settings.apiModel} (已保存)`, settings.apiModel));
            $modelSelect.val(settings.apiModel);
        } else {
            $modelSelect.empty().append(new Option("请先加载模型", ""));
        }


        // 根据AI源显示/隐藏自定义API设置
        toggleCustomApiSettings();

        // 从localStorage加载并显示上一次生成的预览
        const lastHtml = localStorage.getItem(`${extensionName}_last_html`) || "尚未生成任何内容。";
        $('#rt-status-bar-preview').html(lastHtml);
    }

    /**
     * 保存插件设置。
     * 将UI元素的状态保存到 SillyTavern 的全局设置对象中。
     */
    function saveSettings(showToast = false) {
        settings.enabled = $('#rt-status-bar-enabled').is(':checked');
        settings.statusBarRequirements = $('#rt-status-bar-requirements').val();
        settings.readWorldBook = $('#rt-status-bar-read-worldbook').is(':checked');
        settings.aiSource = $('#rt-status-bar-ai-source').val();
        settings.apiUrl = $('#rt-status-bar-api-url').val();
        settings.apiKey = $('#rt-status-bar-api-key').val();
        settings.apiModel = $('#rt-status-bar-api-model').val();

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
        if (!finalUrl.endsWith('/')) {
            finalUrl += '/';
        }

        // 针对不同API服务类型，构建最终的聊天补全端点URL
        if (finalUrl.includes('generativelanguage.googleapis.com')) {
            // 谷歌AI的特殊处理
            if (!finalUrl.endsWith('chat/completions')) {
                 finalUrl += 'chat/completions';
            }
        } else if (finalUrl.endsWith('/v1/')) {
            // 标准OpenAI兼容API
            finalUrl += 'chat/completions';
        } else if (!finalUrl.includes('/chat/completions')) {
            // 其他情况，尝试补全 /v1/chat/completions
            finalUrl += 'v1/chat/completions';
        }

        const headers = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const body = JSON.stringify({
            model: apiModel,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
        });

        console.log(`[${extensionName}] 正在调用自定义API...`, { url: finalUrl, model: apiModel });
        const response = await fetch(finalUrl, {
            method: 'POST',
            headers: headers,
            body: body,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`自定义API请求失败: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    }


    /**
     * 插件的核心处理函数。
     * @param {object} messageToProcess - 由轮询机制确定的、需要处理的那条AI消息。
     */
    async function handleNewMessage(messageToProcess) {
        // 检查插件是否启用
        if (!settings.enabled) {
            if (!window.rtStatusBarDisabledLogged) {
                console.log(`[${extensionName}] 插件当前为禁用状态，跳过处理。`);
                window.rtStatusBarDisabledLogged = true;
            }
            return;
        }
        window.rtStatusBarDisabledLogged = false;

        // 防止并发执行
        if (isGenerating) {
            console.log(`[${extensionName}] 正在生成中，跳过本次触发。`);
            return;
        }

        isGenerating = true;
        const uniqueId = generateUniqueId();

        try {
            // 1. 注入占位符
            await TavernHelper.createChatMessages(
                [{ role: 'system', message: `<span id="${uniqueId}">⏳ <i>Beilu 正在构建状态界面...</i></span>`, is_hidden: false }],
                { refresh: 'affected' }
            );
            console.log(`[${extensionName}] 已注入占位符: #${uniqueId}`);

            // 2. 动态构建Prompt
            let contextParts = [];

            // 2.1 添加用户自定义要求
            contextParts.push(`**用户具体要求:**\n${settings.statusBarRequirements}`);

            // 2.2 (可选) 添加世界书信息
            if (settings.readWorldBook) {
                try {
                    console.log(`[${extensionName}] 开始获取激活的世界书条目...`);
                    const lorebookSettings = TavernHelper.getLorebookSettings();
                    const charLorebook = TavernHelper.getCurrentCharPrimaryLorebook();
                    const chatLorebook = await TavernHelper.getChatLorebook();

                    const activeLorebookNames = new Set([
                        ...(lorebookSettings.selected_global_lorebooks || []),
                        charLorebook,
                        chatLorebook,
                    ].filter(Boolean)); // 使用Set自动去重并过滤掉null/undefined

                    console.log(`[${extensionName}] 激活的世界书:`, Array.from(activeLorebookNames));

                    let allActiveEntries = [];
                    for (const bookName of activeLorebookNames) {
                        const entries = await TavernHelper.getLorebookEntries(bookName);
                        allActiveEntries.push(...entries.filter(entry => entry.enabled));
                    }
                    
                    if (allActiveEntries.length > 0) {
                        const worldBookContent = allActiveEntries.map(entry => `### ${entry.comment || entry.keys.join(', ')}\n${entry.content}`).join('\n\n');
                        contextParts.push(`**相关世界观设定:**\n${worldBookContent}`);
                        console.log(`[${extensionName}] 成功加载 ${allActiveEntries.length} 个世界书条目。`);
                    }
                } catch (err) {
                    console.error(`[${extensionName}] 获取世界书条目时出错:`, err);
                    // 即使出错也继续，不中断主流程
                }
            }

            // 2.3 添加触发消息作为上下文
            if (messageToProcess) {
                contextParts.push(`**最新对话内容:**\n${messageToProcess.name}: ${messageToProcess.message}`);
                console.log(`[${extensionName}] 已成功将触发消息 (ID: ${messageToProcess.message_id}) 添加为上下文。`);
            } else {
                console.warn(`[${extensionName}] 未能获取到触发消息，无法添加对话上下文。`);
            }

            // 2.4 组合最终的Prompt
            const finalPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${contextParts.join('\n\n---\n\n')}`;
            console.log(`[${extensionName}] 构建的最终Prompt:`, finalPrompt);


            // 3. 【AI调用核心】根据设置选择AI源
            toastr.info("正在调用AI生成状态栏...");
            let generationResult = "";

            if (settings.aiSource === 'custom') {
                generationResult = await callCustomApi(finalPrompt);
            } else {
                console.log(`[${extensionName}] 正在使用酒馆AI (generateRaw)...`);
                generationResult = await TavernHelper.generateRaw({
                    ordered_prompts: [{ role: 'user', content: finalPrompt }]
                });
            }

            console.log(`[${extensionName}] AI返回的完整原始响应:\n`, generationResult);

            // 4. 处理结果
            if (generationResult && generationResult.trim()) {
                let generatedHtml = generationResult.trim();
                // 提取被 ```html ... ``` 包裹的代码
                const match = generatedHtml.match(/```html\s*([\s\S]+?)\s*```/);
                if (match && match[1]) {
                    generatedHtml = match[1].trim();
                }

                // 5. 替换占位符并更新预览
                // AI现在生成的是完整的、自包含的HTML，直接使用即可
                replacePlaceholder(uniqueId, generatedHtml);
                // 预览时，我们只显示剥离了<script>和<style>的部分，以避免在设置页面执行脚本或应用全局样式
                const previewHtml = generatedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
                $('#rt-status-bar-preview').html(previewHtml);
                localStorage.setItem(`${extensionName}_last_html`, previewHtml);
                toastr.success("实时状态栏已更新！");

            } else {
                const errorMsg = "❌ AI未能生成有效的状态栏内容。";
                replacePlaceholder(uniqueId, errorMsg);
                toastr.warning(errorMsg);
            }
        } catch (error) {
            console.error(`[${extensionName}] 插件出错:`, error);
            const errorMsg = `❌ 生成状态栏时发生错误: ${escapeHtml(error.message)}`;
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
        if (!fileName || typeof fileName !== 'string') return 'unknown_chat_source';
        let cleanedName = fileName;
        if (fileName.includes('/') || fileName.includes('\\')) {
            const parts = fileName.split(/[\\/]/);
            cleanedName = parts[parts.length - 1];
        }
        return cleanedName.replace(/\.jsonl$/, '').replace(/\.json$/, '');
    }

    /**
     * 获取当前最新的聊天文件名标识符。
     * 借鉴自 AutoCardUpdaterExtension 的成熟方案。
     * @returns {Promise<string>} 最新的聊天文件名。
     */
    async function getLatestChatName() {
        let newChatFileIdentifier = 'unknown_chat_fallback';
        try {
            let chatNameFromCommand = null;
            if (TavernHelper && typeof TavernHelper.triggerSlash === 'function') {
                chatNameFromCommand = await TavernHelper.triggerSlash('/getchatname');
            }

            if (chatNameFromCommand && typeof chatNameFromCommand === 'string' && chatNameFromCommand.trim() && chatNameFromCommand.trim() !== 'null' && chatNameFromCommand.trim() !== 'undefined') {
                newChatFileIdentifier = cleanChatName(chatNameFromCommand.trim());
            } else {
                const contextFallback = SillyTavern.getContext ? SillyTavern.getContext() : null;
                if (contextFallback && contextFallback.chat && typeof contextFallback.chat === 'string') {
                    const chatNameFromContext = cleanChatName(contextFallback.chat);
                    if (chatNameFromContext && !chatNameFromContext.startsWith('unknown_chat')) {
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
        console.log(`[${extensionName}] 检测到聊天切换，重置状态为: "${newChatName}"`);
        currentChatFileIdentifier = newChatName || 'unknown_chat_fallback';
        // 关键：重置最后处理的消息ID，以便在新聊天中重新开始检测
        lastProcessedMessageId = -1;
    }

    /**
     * 使用轮询机制来检查新消息，并处理聊天切换。
     */
    function startPolling() {
        setInterval(async () => {
            // 如果正在生成或插件被禁用，则跳过本次检查
            if (isGenerating || !settings.enabled) {
                return;
            }

            try {
                // 步骤 1: 检查聊天是否已切换
                const latestChatName = await getLatestChatName();
                if (latestChatName && latestChatName !== currentChatFileIdentifier) {
                    await resetScriptStateForNewChat(latestChatName);
                    // 状态已重置，可以继续本次轮询的后续检查
                }

                // 步骤 2: 检查新消息
                const messages = await TavernHelper.getChatMessages(-1);
                if (!messages || messages.length === 0) {
                    return;
                }

                const lastMessage = messages[0];
                if (!lastMessage || typeof lastMessage.message_id === 'undefined') {
                    return;
                }

                // 检查条件：
                // 1. 是AI消息 (role !== 'user')
                // 2. 消息ID是新的 (lastMessage.message_id > lastProcessedMessageId)
                // 3. 消息内容足够长 (lastMessage.message.length > 300)
                if (
                    lastMessage.role !== 'user' &&
                    lastMessage.message_id > lastProcessedMessageId &&
                    (lastMessage.message || '').length > 300
                ) {
                    console.log(`[${extensionName}] 轮询检测到新的、完整的AI消息 (ID: ${lastMessage.message_id}, 长度: ${lastMessage.message.length})，触发处理。`);
                    
                    lastProcessedMessageId = lastMessage.message_id;
                    
                    await handleNewMessage(lastMessage);
                }
            } catch (error) {
                console.error(`[${extensionName}] 轮询检查时出错:`, error);
            }
        }, 1500); // 每1.5秒检查一次

        console.log(`[${extensionName}] 已启动轮询机制来检测新消息和聊天切换。`);
    }

    /**
     * 初始化函数
     * 负责加载UI、绑定事件和启动核心监听器。
     */
    async function init() {
        // 1. 加载设置界面的HTML
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);

        // 2. 并行异步加载所有必要的文本文件
        try {
            const [systemPromptData, defaultStatusPromptData] = await Promise.all([
                $.get(`${extensionFolderPath}/system_prompt.txt`),
                $.get(`${extensionFolderPath}/default_status_prompt.txt`)
            ]);
            SYSTEM_PROMPT = systemPromptData;
            DEFAULT_STATUS_PROMPT = defaultStatusPromptData;
            console.log(`[${extensionName}] 系统提示词和默认状态要求已成功加载。`);
        } catch (error) {
            console.error(`[${extensionName}] 加载外部 .txt 文件时出错:`, error);
            toastr.error("加载插件核心文件失败，功能可能不完整。");
        }
        
        // 3. 加载设置
        loadSettings();

        // 4. 绑定UI事件
        const settingsContainer = $(`.extension_settings[data-extension-name="${extensionName}"]`);
        
        settingsContainer.find('.inline-drawer-toggle').on('click', function () {
            $(this).closest('.inline-drawer').toggleClass('open');
        });
        
        // 对于即时更改的设置，静默保存
        $('#rt-status-bar-enabled').on('change', () => saveSettings(false));
        $('#rt-status-bar-requirements').on('input', () => saveSettings(false));
        $('#rt-status-bar-read-worldbook').on('change', () => saveSettings(false));
        $('#rt-status-bar-ai-source').on('change', () => {
            toggleCustomApiSettings();
            saveSettings(false);
        });

        // 对于需要明确点击的按钮，保存并显示提示
        $('#rt-status-bar-save-api').on('click', () => saveSettings(true));
        $('#rt-status-bar-fetch-models').on('click', fetchApiModels);
        
        // 新增：当用户从下拉列表选择新模型时，自动静默保存
        $('#rt-status-bar-api-model').on('change', () => saveSettings(false));

        // 5. 获取初始聊天状态并启动轮询
        const initialChatName = await getLatestChatName();
        await resetScriptStateForNewChat(initialChatName);
        startPolling();

        console.log(`[${extensionName}] 插件(v1.1.0)已成功加载并初始化。`);
    }

    init();
});
