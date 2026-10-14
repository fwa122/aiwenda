<template>
  <div class="page-container">
    <div class="page-inner" style="max-width: 1000px">
      <header class="page-head">
        <div>
          <h1 class="page-title">系统设置</h1>
          <p class="page-desc">配置全局模型、检索与安全策略，管理密钥与成员</p>
        </div>
      </header>

      <el-tabs v-model="activeTab" class="settings-tabs">
        <!-- 模型参数 -->
        <el-tab-pane label="模型参数" name="model">
          <el-form v-loading="loading" :model="settings.model" label-width="120px" class="setting-form">
            <el-form-item label="当前模型">
              <div class="readonly-model">
                <el-tag v-if="runtimeModel" type="success" effect="light">{{ runtimeModel }}</el-tag>
                <el-tag v-else type="info" effect="light">未连接 AI 服务</el-tag>
                <span class="form-hint">由服务端配置（设置页 API Key 优先，其次 ai-service/.env），暂不支持切换</span>
              </div>
            </el-form-item>
            <el-form-item label="LLM API Key">
              <div class="key-presence-row">
                <el-tag
                  v-for="p in API_KEY_PROVIDERS"
                  :key="p.key"
                  size="small"
                  :type="keyStatusType(p.key)"
                  effect="light"
                >
                  {{ p.label }} · {{ keyStatusText(p.key) }}
                </el-tag>
              </div>
            </el-form-item>
            <!-- API Key 管理（admin）：保存后写入 DB 即时生效，无需重启服务 -->
            <template v-if="isAdmin">
              <el-divider content-position="left">API Key 管理</el-divider>
              <el-form-item v-for="p in API_KEY_PROVIDERS" :key="p.key" :label="p.label">
                <div class="api-key-row">
                  <el-input
                    v-model="apiKeyInputs[p.key]"
                    type="password"
                    show-password
                    clearable
                    :placeholder="apiKeyPlaceholder(p.key)"
                    style="flex: 1"
                  />
                  <el-button
                    :loading="keyVerifying === p.key"
                    :disabled="!apiKeyInputs[p.key]"
                    @click="handleVerifyKey(p.key)"
                  >验证</el-button>
                  <el-button
                    v-if="apiKeyState[p.key]?.configured"
                    :disabled="keySaving"
                    @click="handleClearKey(p.key)"
                  >清除</el-button>
                </div>
                <div class="form-tip">{{ p.hint }}</div>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="keySaving" @click="saveApiKeys">保存 API Key</el-button>
                <span class="form-hint">保存后全链路（问答/嵌入/精排/OCR）即时生效，无需重启服务</span>
              </el-form-item>
            </template>
            <!-- 模型接入说明：与 llmModels / API_KEY_PROVIDERS 数据联动，新增渠道或模型后本表自动同步 -->
            <el-divider content-position="left">模型接入说明</el-divider>
            <el-form-item label=" ">
              <div class="model-guide">
                <p class="form-tip">
                  对话模型在聊天页右上角下拉选择；渠道 Key 在上方「API Key 管理」配置，未配置时回落服务端
                  .env。嵌入 / Rerank / OCR 为独立渠道（智谱、千问），由服务端 .env 配置。后续新增渠道或模型会同步更新本表。
                </p>
                <el-table :data="modelGuide" size="small" border>
                  <el-table-column label="渠道" width="170">
                    <template #default="{ row }">
                      <div class="guide-provider">{{ row.name }}</div>
                      <div class="guide-env">{{ row.envKey }}</div>
                    </template>
                  </el-table-column>
                  <el-table-column label="可接入模型" min-width="280">
                    <template #default="{ row }">
                      <el-tag
                        v-for="m in row.models"
                        :key="m"
                        size="small"
                        effect="plain"
                        class="guide-model-tag"
                      >{{ m }}</el-tag>
                      <span v-if="!row.models.length" class="text-muted">—</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="用途说明" min-width="220" prop="desc" />
                </el-table>
              </div>
            </el-form-item>
            <el-form-item label="温度 Temperature">
              <el-slider v-model="settings.model.temperature" :min="0" :max="1" :step="0.1" style="width: 320px" />
              <span class="form-hint">{{ settings.model.temperature.toFixed(1) }} · 越小越严谨</span>
            </el-form-item>
            <el-form-item label="Top P">
              <el-slider v-model="settings.model.topP" :min="0" :max="1" :step="0.05" style="width: 320px" />
              <span class="form-hint">{{ settings.model.topP.toFixed(2) }}</span>
            </el-form-item>
            <el-form-item label="最大输出">
              <el-input-number v-model="settings.model.maxTokens" :min="256" :max="8192" :step="256" />
              <span class="form-hint">tokens</span>
            </el-form-item>
            <el-form-item label="上下文轮数">
              <el-input-number v-model="settings.model.contextRounds" :min="1" :max="10" />
              <span class="form-hint">携带的历史对话轮数（1~10，默认 5）</span>
            </el-form-item>
            <el-form-item label="开关">
              <el-checkbox v-model="settings.model.enableStream" disabled>流式输出（当前版本固定开启）</el-checkbox>
              <el-checkbox v-model="settings.model.enableCitation">强制引用来源</el-checkbox>
            </el-form-item>
            <el-form-item label="系统提示词">
              <el-input
                v-model="settings.model.systemPrompt"
                type="textarea"
                :rows="5"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="兜底话术">
              <el-input v-model="settings.model.fallbackReply" style="width: 100%" />
              <div class="form-tip">未命中知识库时返回该内容，避免模型编造</div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveSettings">保存配置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 检索参数 -->
        <el-tab-pane label="检索参数" name="retrieval">
          <el-form v-loading="loading" :model="settings.retrieval" label-width="120px" class="setting-form">
            <el-form-item label="默认 Top K">
              <el-input-number v-model="settings.retrieval.topK" :min="1" :max="20" />
              <span class="form-hint">新建知识库的默认值</span>
            </el-form-item>
            <el-form-item label="相似度阈值">
              <el-slider v-model="settings.retrieval.threshold" :min="0" :max="1" :step="0.01" style="width: 320px" />
              <span class="form-hint">{{ settings.retrieval.threshold.toFixed(2) }}</span>
            </el-form-item>
            <el-form-item label="混合检索">
              <el-switch v-model="settings.retrieval.hybrid" disabled />
              <span class="form-hint">向量 + BM25 双路召回（后续版本支持，当前仅向量召回）</span>
            </el-form-item>
            <el-form-item label="向量权重">
              <el-slider
                v-model="settings.retrieval.vectorWeight"
                :min="0"
                :max="1"
                :step="0.05"
                :disabled="!settings.retrieval.hybrid"
                style="width: 320px"
              />
              <span class="form-hint">{{ settings.retrieval.vectorWeight.toFixed(2) }}</span>
            </el-form-item>
            <el-form-item label="Rerank 精排">
              <el-switch v-model="settings.retrieval.rerank" disabled />
              <span class="form-hint">粗召回后精排重排（后续版本支持）</span>
            </el-form-item>
            <el-form-item v-if="settings.retrieval.rerank" label="精排模型">
              <el-select v-model="settings.retrieval.rerankModel" style="width: 320px">
                <el-option label="bge-reranker-large" value="bge-reranker-large" />
                <el-option label="bge-reranker-base" value="bge-reranker-base" />
              </el-select>
            </el-form-item>

            <!-- 答案语义缓存（v0.9.40）：同库组合下语义相近问题直接复用答案 -->
            <el-divider content-position="left">答案语义缓存</el-divider>
            <el-form-item label="语义缓存">
              <el-switch v-model="settings.cache.enableSemanticCache" />
              <span class="form-hint">
                同库组合下语义相近的问题直接复用答案，命中毫秒级响应；多轮对话与附件问答不启用
              </span>
            </el-form-item>
            <el-form-item v-if="settings.cache.enableSemanticCache" label="命中阈值">
              <el-slider
                v-model="settings.cache.cacheThreshold"
                :min="0.05"
                :max="0.3"
                :step="0.01"
                style="width: 320px"
              />
              <span class="form-hint">
                cosine 距离 ≤ {{ Number(settings.cache.cacheThreshold).toFixed(2) }}（越小越严格，0.12 ≈ 相似度 0.88）
              </span>
            </el-form-item>
            <el-form-item v-if="settings.cache.enableSemanticCache" label="缓存天数">
              <el-input-number v-model="settings.cache.cacheTtlDays" :min="1" :max="30" />
              <span class="form-hint">缓存条目保留天数；知识库文档变更时自动失效</span>
            </el-form-item>

            <!-- 嵌入渠道与全库重嵌入（admin）：换 .env 渠道后全库向量重建 -->
            <template v-if="isAdmin">
              <el-divider content-position="left">嵌入渠道与全库重嵌入</el-divider>
              <el-form-item label="当前渠道">
                <div class="readonly-model">
                  <el-tag v-if="emb.config" type="info" effect="light">{{ embChannelLabel(emb.config) }}</el-tag>
                  <el-tag v-else type="info" effect="light">未连接 AI 服务</el-tag>
                  <span class="form-hint">由服务端（ai-service/.env）配置，重启后生效</span>
                </div>
              </el-form-item>
              <el-form-item label="向量签名">
                <div class="readonly-model">
                  <el-tag v-if="emb.signature" :type="emb.needsReembed ? 'warning' : 'success'" effect="light">
                    {{ embChannelLabel(emb.signature) }}
                  </el-tag>
                  <el-tag v-else type="danger" effect="light">未知（建议重建一次）</el-tag>
                  <el-tag v-if="emb.needsReembed && emb.phase === 'idle'" type="warning" effect="light">
                    渠道已变更，需全库重建
                  </el-tag>
                </div>
              </el-form-item>
              <el-form-item v-if="emb.phase && emb.phase !== 'idle'" label="重建进度">
                <div class="reembed-progress">
                  <el-progress
                    :percentage="embProgressPct"
                    :status="emb.phase === 'partial_failed' ? 'exception' : emb.phase === 'finalizing' ? 'success' : undefined"
                  />
                  <div class="form-hint">
                    <template v-if="emb.phase === 'running'">
                      文档 {{ emb.progress.doneDocs }}/{{ emb.progress.totalDocs }} · 切片 {{ emb.progress.doneChunks }}/{{ emb.progress.totalChunks }}（问答与检索暂停中）
                    </template>
                    <template v-else-if="emb.phase === 'finalizing'">正在收尾（重建向量索引）…</template>
                    <template v-else-if="emb.phase === 'partial_failed'">
                      部分文档失败（{{ emb.progress.failedDocs }} 个）{{ emb.progress.errorMsg ? '：' + emb.progress.errorMsg : '' }}，可重新点击「开始重嵌入」仅重试失败文档
                    </template>
                  </div>
                </div>
              </el-form-item>
              <el-form-item label=" ">
                <el-button
                  type="warning"
                  plain
                  :loading="embStarting"
                  :disabled="emb.phase === 'running' || emb.phase === 'finalizing' || !emb.loaded"
                  @click="startReembed"
                >
                  开始全库重嵌入
                </el-button>
                <span class="form-hint">更换嵌入渠道（.env）后必须重建，否则新旧向量混检导致检索失效</span>
              </el-form-item>
            </template>

            <el-divider content-position="left">存储与解析</el-divider>
            <el-form-item label="向量库">
              <el-select v-model="settings.storage.vectorStore" style="width: 320px">
                <el-option v-for="v in vectorStores" :key="v.value" :label="v.label" :value="v.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="Embedding">
              <el-select v-model="settings.storage.embeddingModel" style="width: 320px">
                <el-option v-for="m in embeddingModels" :key="m.value" :label="m.label" :value="m.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="单文件上限">
              <el-input-number v-model="settings.storage.maxFileSize" :min="10" :max="500" :step="10" />
              <span class="form-hint">MB</span>
            </el-form-item>
            <el-form-item label="OCR">
              <el-switch v-model="settings.storage.ocrEnabled" />
              <span class="form-hint">扫描版 PDF 自动启用 OCR</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveSettings">保存配置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 安全与审计 -->
        <el-tab-pane label="安全与审计" name="security">
          <el-card shadow="never" class="sub-card">
            <template #header><span class="card-title">账号信息</span></template>
            <el-form :model="profileForm" label-width="100px" class="setting-form">
              <el-form-item label="昵称">
                <el-input v-model="profileForm.nickname" style="width: 280px" />
              </el-form-item>
              <el-form-item label="邮箱">
                <el-input v-model="profileForm.email" style="width: 280px" />
              </el-form-item>
              <el-form-item label="手机号">
                <el-input v-model="profileForm.phone" style="width: 280px" />
              </el-form-item>
              <el-form-item label="所属部门">
                <el-input v-model="profileForm.department" style="width: 280px" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="savingProfile" @click="saveProfile">保存资料</el-button>
              </el-form-item>
            </el-form>
          </el-card>

          <el-card shadow="never" class="sub-card">
            <template #header><span class="card-title">修改密码</span></template>
            <el-form :model="pwdForm" label-width="100px" class="setting-form">
              <el-form-item label="原密码">
                <el-input v-model="pwdForm.oldPassword" type="password" show-password style="width: 280px" />
              </el-form-item>
              <el-form-item label="新密码">
                <el-input v-model="pwdForm.newPassword" type="password" show-password style="width: 280px" />
              </el-form-item>
              <el-form-item label="确认密码">
                <el-input v-model="pwdForm.confirmPassword" type="password" show-password style="width: 280px" />
              </el-form-item>
              <el-form-item>
                <el-button :loading="savingPwd" @click="savePassword">修改密码</el-button>
              </el-form-item>
            </el-form>
          </el-card>

          <el-card v-loading="loading" shadow="never" class="sub-card">
            <template #header><span class="card-title">安全策略</span></template>
            <el-form :model="settings.security" label-width="120px" class="setting-form">
              <el-form-item label="审计日志">
                <el-switch v-model="settings.security.enableAuditLog" />
              </el-form-item>
              <el-form-item label="日志留存">
                <el-input-number v-model="settings.security.auditRetentionDays" :min="30" :max="730" :step="30" />
                <span class="form-hint">天</span>
              </el-form-item>
              <el-form-item label="敏感词过滤">
                <el-switch v-model="settings.security.enableSensitiveFilter" />
                <span class="form-hint">开启后拦截命中敏感词的用户提问</span>
              </el-form-item>
              <el-form-item label="会话超时">
                <el-input-number v-model="settings.security.sessionTimeout" :min="15" :max="1440" :step="15" />
                <span class="form-hint">分钟</span>
              </el-form-item>
              <el-form-item label="IP 白名单">
                <el-input
                  v-model="settings.security.ipWhitelist"
                  type="textarea"
                  :rows="2"
                  placeholder="支持精确 IP 与 IPv4 CIDR（如 192.168.1.0/24），逗号分隔，留空表示不限制"
                  style="width: 100%"
                />
                <span class="form-hint">全站生效，保存后约 30 秒内生效；本机 127.0.0.1 恒放行</span>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="saving" @click="saveSettings">保存配置</el-button>
              </el-form-item>
            </el-form>
          </el-card>
        </el-tab-pane>

        <!-- API 密钥 -->
        <el-tab-pane label="API 密钥" name="keys">
          <div class="tab-bar">
            <p class="text-muted">密钥用于服务端调用问答接口，请妥善保管，不要在前端代码中明文暴露。</p>
            <el-button type="primary" @click="openKeyDialog">
              <el-icon><Plus /></el-icon>新建密钥
            </el-button>
          </div>

          <el-table v-loading="keyLoading" :data="apiKeys" style="width: 100%">
            <el-table-column label="名称" min-width="160" prop="name" />
            <el-table-column label="密钥" min-width="200">
              <template #default="{ row }">
                <span class="mono">{{ row.key }}</span>
              </template>
            </el-table-column>
            <el-table-column label="授权范围" min-width="140">
              <template #default="{ row }">
                <span v-if="row.scope.length">{{ row.scope.length }} 个知识库</span>
                <span v-else class="text-muted">未授权</span>
              </template>
            </el-table-column>
            <el-table-column label="今日用量" width="160">
              <template #default="{ row }">
                {{ formatNumber(row.usedToday) }} / {{ formatNumber(row.quotaPerDay) }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small" effect="light">
                  {{ row.status === 'active' ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="最近调用" width="160" prop="lastUsedAt" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="handleDeleteKey(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 用户管理 -->
        <el-tab-pane label="用户管理" name="users">
          <div class="tab-bar">
            <el-input v-model="userKeyword" placeholder="搜索用户名 / 昵称 / 邮箱" clearable style="width: 240px">
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button type="primary" @click="openUserDialog()">
              <el-icon><Plus /></el-icon>新建用户
            </el-button>
          </div>

          <el-table v-loading="userLoading" :data="users" style="width: 100%">
            <el-table-column label="用户" min-width="180">
              <template #default="{ row }">
                <div class="user-cell">
                  <div class="u-avatar">{{ row.nickname.slice(0, 1) }}</div>
                  <div>
                    <div class="u-name">{{ row.nickname }}</div>
                    <div class="u-sub text-muted">@{{ row.username }}</div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="角色" width="110">
              <template #default="{ row }">
                <el-tag :type="row.role === 'admin' ? 'danger' : row.role === 'editor' ? 'primary' : 'info'" size="small" effect="light">
                  {{ row.roleName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="部门" width="130" prop="department" />
            <el-table-column label="邮箱" min-width="180" prop="email" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small" effect="light">
                  {{ row.status === 'active' ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="最近登录" width="160" prop="lastLoginAt" />
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openUserDialog(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="handleDeleteUser(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 操作日志 -->
        <el-tab-pane label="操作日志" name="logs">
          <el-table v-loading="logLoading" :data="logs" style="width: 100%">
            <el-table-column label="时间" width="170" prop="createdAt" />
            <el-table-column label="操作人" width="100" prop="user" />
            <el-table-column label="操作" width="140" prop="action" />
            <el-table-column label="对象" min-width="220" prop="target" />
            <el-table-column label="IP" width="130" prop="ip" />
            <el-table-column label="结果" width="160">
              <template #default="{ row }">
                <el-tag :type="row.result === '成功' ? 'success' : 'danger'" size="small" effect="light">
                  {{ row.result }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 新建密钥 -->
    <el-dialog v-model="keyDialog" title="新建 API 密钥" width="460px">
      <el-form :model="keyForm" label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="keyForm.name" placeholder="例如：生产环境-官网助手" />
        </el-form-item>
        <el-form-item label="授权知识库">
          <el-select v-model="keyForm.scope" multiple style="width: 100%">
            <el-option v-for="kb in kbOptions" :key="kb.id" :label="kb.name" :value="kb.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="每日限额">
          <el-input-number v-model="keyForm.quotaPerDay" :min="100" :step="100" />
          <span class="form-hint">次 / 天</span>
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker v-model="keyForm.expiredAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="keyDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateKey">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新建/编辑用户 -->
    <el-dialog v-model="userDialog" :title="userForm.id ? '编辑用户' : '新建用户'" width="460px">
      <el-form :model="userForm" label-width="90px">
        <el-form-item label="用户名" required>
          <el-input v-model="userForm.username" :disabled="!!userForm.id" placeholder="登录账号" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="userForm.nickname" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="userForm.email" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="userForm.role" style="width: 100%">
            <el-option label="超级管理员" value="admin" />
            <el-option label="知识库编辑" value="editor" />
            <el-option label="只读访客" value="viewer" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="userForm.department" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="userForm.status">
            <el-radio value="active">启用</el-radio>
            <el-radio value="disabled">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSaveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { getRuntimeModel } from '@/api/chat'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore, useKnowledgeStore } from '@/store'
import {
  getSystemSettings,
  updateSystemSettings,
  verifyApiKey,
  getEmbeddingState,
  triggerReembed,
  changePassword,
  getApiKeys,
  createApiKey,
  deleteApiKey,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getOperationLogs
} from '@/api/user'
import { llmModels, embeddingModels, vectorStores, llmProviderMeta } from '@/mock/knowledge'
import { formatNumber } from '@/utils/format'
import { clone } from '@/utils/format'

const userStore = useUserStore()
const knowledgeStore = useKnowledgeStore()

const activeTab = ref('model')
const loading = ref(false)
const saving = ref(false)
const runtimeModel = ref('')
/** 各渠道 key 在场状态（来自 AI 服务 health，不含 key 本身）：{configured, source} */
const keyPresence = ref(null)

/** 读取 AI 服务当前真实生效的模型（只读展示）与 key 在场状态 */
async function loadRuntimeModel() {
  try {
    const res = await getRuntimeModel()
    runtimeModel.value = res?.model || ''
    keyPresence.value = res?.keyPresence || null
  } catch {
    runtimeModel.value = ''
    keyPresence.value = null
  }
}

/* ---------------- 设置 ---------------- */
const settings = reactive({
  model: {
    provider: 'qwen',
    model: 'qwen2.5-72b-instruct',
    temperature: 0.3,
    topP: 0.85,
    maxTokens: 2048,
    contextRounds: 5,
    systemPrompt: '',
    enableStream: true,
    enableCitation: true,
    fallbackReply: ''
  },
  retrieval: {
    topK: 5,
    threshold: 0.28,
    rerank: true,
    rerankModel: 'bge-reranker-large',
    hybrid: true,
    vectorWeight: 0.7
  },
  security: {
    enableAuditLog: true,
    auditRetentionDays: 180,
    enableSensitiveFilter: true,
    ipWhitelist: '',
    sessionTimeout: 120
  },
  storage: {
    vectorStore: 'milvus',
    vectorDim: 1024,
    embeddingModel: 'bge-large-zh-v1.5',
    maxFileSize: 100,
    ocrEnabled: true
  },
  cache: {
    enableSemanticCache: true,
    cacheThreshold: 0.12,
    cacheTtlDays: 7
  }
})

async function loadSettings() {
  loading.value = true
  try {
    const data = await getSystemSettings()
    // apiKeys 为脱敏形态（configured/tail/source），单独存放，避免随 clone(settings) 回传污染保存请求
    const { apiKeys, ...rest } = clone(data) || {}
    Object.assign(settings, rest)
    Object.assign(apiKeyState, apiKeys || {})
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  saving.value = true
  try {
    await updateSystemSettings(clone(settings))
    ElMessage.success('配置已保存')
  } finally {
    saving.value = false
  }
}

/* ---------------- LLM API Key 管理（admin） ---------------- */
const API_KEY_PROVIDERS = [
  { key: 'zhipu', label: '智谱', hint: 'GLM 对话 / embedding / rerank / OCR（OpenAI 兼容）' },
  { key: 'qianwen', label: '通义千问', hint: 'qwen/deepseek 对话 / qwen embedding（DashScope）' },
  { key: 'moonshot', label: 'Kimi', hint: 'kimi/moonshot 对话（Moonshot 开放平台）' },
  { key: 'minimax', label: 'MiniMax', hint: 'MiniMax-M2.x 对话（MiniMax 开放平台，OpenAI 兼容）' }
]

/** 模型接入说明表：渠道元信息 + llmModels 注册表聚合（新增渠道/模型自动同步到该表） */
const modelGuide = computed(() =>
  API_KEY_PROVIDERS.map((p) => ({
    key: p.key,
    name: llmProviderMeta[p.key]?.name || p.label,
    envKey: llmProviderMeta[p.key]?.envKey || '',
    desc: p.hint,
    models: llmModels.filter((m) => m.provider === p.key).map((m) => m.value)
  }))
)

/** 脱敏状态（GET /settings 返回）：{configured, tail, source} */
const apiKeyState = reactive({ zhipu: null, qianwen: null, moonshot: null, minimax: null })
/** 新输入的 key（仅保存时提交，不回显明文） */
const apiKeyInputs = reactive({ zhipu: '', qianwen: '', moonshot: '', minimax: '' })
const keySaving = ref(false)
const keyVerifying = ref('')

function keyStatusText(p) {
  if (apiKeyState[p]?.configured) return `已配置（尾号 ${apiKeyState[p].tail}）`
  if (keyPresence.value?.[p]?.configured) return '.env 默认'
  return '未配置'
}

function keyStatusType(p) {
  if (apiKeyState[p]?.configured || keyPresence.value?.[p]?.configured) return 'success'
  return 'danger'
}

function apiKeyPlaceholder(p) {
  if (apiKeyState[p]?.configured) return `输入新值可更换（当前尾号 ${apiKeyState[p].tail}）`
  if (keyPresence.value?.[p]?.configured) return '未在设置页配置 · 使用服务端 .env 默认 key'
  return '未配置 · 请粘贴 API Key'
}

/** 保存：仅提交有输入的渠道；后端语义为「非空覆盖」，未提及渠道保持原值 */
async function saveApiKeys() {
  const payload = {}
  for (const p of API_KEY_PROVIDERS) {
    if (apiKeyInputs[p.key] !== '') payload[p.key] = apiKeyInputs[p.key]
  }
  if (!Object.keys(payload).length) {
    ElMessage.info('请先输入要配置的 API Key')
    return
  }
  keySaving.value = true
  try {
    await updateSystemSettings({ apiKeys: payload })
    ElMessage.success('API Key 已保存并即时生效')
    apiKeyInputs.zhipu = ''
    apiKeyInputs.qianwen = ''
    apiKeyInputs.moonshot = ''
    apiKeyInputs.minimax = ''
    await Promise.all([loadSettings(), loadRuntimeModel()])
  } finally {
    keySaving.value = false
  }
}

/** 清除：空串语义=删除该渠道配置，回落 .env 默认（若 .env 也未配置则相关功能不可用） */
async function handleClearKey(p) {
  try {
    await ElMessageBox.confirm(
      '清除后该渠道将回落服务端 .env 默认 key；若 .env 未配置，对应功能将不可用。确定清除？',
      '清除 API Key',
      { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  keySaving.value = true
  try {
    await updateSystemSettings({ apiKeys: { [p]: '' } })
    ElMessage.success('已清除，回落 .env 默认值')
    await Promise.all([loadSettings(), loadRuntimeModel()])
  } finally {
    keySaving.value = false
  }
}

/** 验证：优先验证输入框中的新值（保存前预检），输入为空时验证当前生效值 */
async function handleVerifyKey(p) {
  keyVerifying.value = p
  try {
    const res = await verifyApiKey({ provider: p, key: apiKeyInputs[p] || undefined })
    if (res?.valid) {
      ElMessage.success(`${API_KEY_PROVIDERS.find((x) => x.key === p)?.label || p} Key 验证通过`)
    } else {
      ElMessage.error(`验证失败：${res?.message || '未知错误'}`)
    }
  } catch (e) {
    ElMessage.error(`验证失败：${e?.message || '服务不可用'}`)
  } finally {
    keyVerifying.value = ''
  }
}

/* ---------------- 嵌入渠道与全库重嵌入（admin） ---------------- */
const isAdmin = computed(() => userStore.profile?.role === 'admin')
const emb = reactive({
  loaded: false,
  config: null,
  signature: null,
  needsReembed: false,
  phase: 'idle',
  progress: null,
  preview: { docCount: 0, chunkCount: 0, estimatedTokens: 0 }
})
const embStarting = ref(false)
let embTimer = null

const PROVIDER_LABELS = { zhipu: '智谱', qianwen: '通义千问', mock: '模拟' }

function embChannelLabel(ch) {
  if (!ch) return ''
  const name = PROVIDER_LABELS[ch.provider] || ch.provider
  return `${name} · ${ch.model} · ${ch.dimensions} 维`
}

const embProgressPct = computed(() => {
  const p = emb.progress
  if (!p) return 0
  if (emb.phase === 'finalizing') return 100
  const docs = p.totalDocs > 0 ? Math.round(((p.doneDocs + p.failedDocs) / p.totalDocs) * 100) : 0
  return Math.min(100, docs)
})

async function loadEmbeddingState() {
  try {
    const data = await getEmbeddingState()
    Object.assign(emb, data, { loaded: true })
  } catch {
    emb.loaded = false
  }
  scheduleEmbPoll()
}

/** 运行中每 3s 轮询进度，空闲即停 */
function scheduleEmbPoll() {
  if (embTimer) clearTimeout(embTimer)
  embTimer = null
  if (emb.loaded && emb.phase && emb.phase !== 'idle') {
    embTimer = setTimeout(loadEmbeddingState, 3000)
  }
}

async function startReembed() {
  const p = emb.preview || {}
  const dimChanged = emb.signature && emb.config && emb.signature.dimensions !== emb.config.dimensions
  const tokens = p.estimatedTokens || 0
  // 成本预估：中文 ≈ 2 字符/token；按 0.5 元/百万 tokens 示例折算，实际以渠道定价为准
  const cost = ((tokens / 1e6) * 0.5).toFixed(2)
  const lines = [
    `将重嵌入 ${p.docCount ?? '-'} 个文档 / ${p.chunkCount ?? '-'} 个切片，预估约 ${tokens.toLocaleString()} tokens`,
    `成本参考：按 0.5 元 / 百万 tokens 约合 ${cost} 元（实际以渠道定价为准）`,
    '重嵌入期间问答与检索将暂停，完成后自动恢复'
  ]
  if (dimChanged) {
    lines.push('检测到向量维度变更：旧向量将被清空且不可逆，请务必备份确认')
  }
  try {
    await ElMessageBox.confirm(lines.join('<br/>'), '全库重嵌入确认', {
      type: 'warning',
      confirmButtonText: '开始重建',
      cancelButtonText: '取消',
      dangerouslyUseHTMLString: true
    })
  } catch {
    return
  }
  embStarting.value = true
  try {
    await triggerReembed()
    ElMessage.success('全库重嵌入已启动')
  } finally {
    embStarting.value = false
  }
  loadEmbeddingState()
}

/* ---------------- 个人资料与密码 ---------------- */
const profileForm = reactive({ nickname: '', email: '', phone: '', department: '' })
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const savingProfile = ref(false)
const savingPwd = ref(false)

watch(
  () => userStore.profile,
  (p) => {
    if (p) Object.assign(profileForm, {
      nickname: p.nickname || '',
      email: p.email || '',
      phone: p.phone || '',
      department: p.department || ''
    })
  },
  { immediate: true }
)

async function saveProfile() {
  savingProfile.value = true
  try {
    await userStore.updateProfile({ ...profileForm })
    ElMessage.success('资料已更新')
  } finally {
    savingProfile.value = false
  }
}

async function savePassword() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) {
    ElMessage.warning('请填写原密码与新密码')
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  savingPwd.value = true
  try {
    await changePassword({
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword
    })
    ElMessage.success('密码已修改')
    Object.assign(pwdForm, { oldPassword: '', newPassword: '', confirmPassword: '' })
  } finally {
    savingPwd.value = false
  }
}

/* ---------------- API 密钥 ---------------- */
const apiKeys = ref([])
const keyLoading = ref(false)
const keyDialog = ref(false)
const keyForm = reactive({ name: '', scope: [], quotaPerDay: 1000, expiredAt: '' })
const kbOptions = computed(() => knowledgeStore.options)

async function loadKeys() {
  keyLoading.value = true
  try {
    apiKeys.value = await getApiKeys()
  } finally {
    keyLoading.value = false
  }
}

function openKeyDialog() {
  Object.assign(keyForm, { name: '', scope: [], quotaPerDay: 1000, expiredAt: '2027-12-31 23:59:59' })
  keyDialog.value = true
}

async function handleCreateKey() {
  if (!keyForm.name.trim()) {
    ElMessage.warning('请输入密钥名称')
    return
  }
  await createApiKey({ ...keyForm })
  ElMessage.success('密钥创建成功')
  keyDialog.value = false
  await loadKeys()
}

async function handleDeleteKey(row) {
  try {
    await ElMessageBox.confirm(`确定删除密钥「${row.name}」吗？使用该密钥的服务将立即失效。`, '删除密钥', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    await deleteApiKey(row.id)
    ElMessage.success('已删除')
    await loadKeys()
  } catch (e) {
    /* 取消 */
  }
}

/* ---------------- 用户管理 ---------------- */
const users = ref([])
const userLoading = ref(false)
const userKeyword = ref('')
const userDialog = ref(false)
const userForm = reactive({
  id: '',
  username: '',
  nickname: '',
  email: '',
  role: 'viewer',
  department: '',
  status: 'active'
})

let userTimer = null
async function loadUsers() {
  userLoading.value = true
  try {
    const res = await getUsers({ keyword: userKeyword.value })
    users.value = res.list
  } finally {
    userLoading.value = false
  }
}

watch(userKeyword, () => {
  clearTimeout(userTimer)
  userTimer = setTimeout(loadUsers, 300)
})

function openUserDialog(row) {
  Object.assign(userForm, {
    id: row?.id || '',
    username: row?.username || '',
    nickname: row?.nickname || '',
    email: row?.email || '',
    role: row?.role || 'viewer',
    department: row?.department || '',
    status: row?.status || 'active'
  })
  userDialog.value = true
}

async function handleSaveUser() {
  if (!userForm.username.trim()) {
    ElMessage.warning('请输入用户名')
    return
  }
  if (userForm.id) {
    await updateUser(userForm.id, { ...userForm })
  } else {
    await createUser({ ...userForm })
  }
  ElMessage.success('保存成功')
  userDialog.value = false
  await loadUsers()
}

async function handleDeleteUser(row) {
  try {
    await ElMessageBox.confirm(`确定删除用户「${row.nickname}」吗？`, '删除用户', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    await deleteUser(row.id)
    ElMessage.success('已删除')
    await loadUsers()
  } catch (e) {
    /* 取消 */
  }
}

/* ---------------- 操作日志 ---------------- */
const logs = ref([])
const logLoading = ref(false)

async function loadLogs() {
  logLoading.value = true
  try {
    const res = await getOperationLogs({ pageSize: 20 })
    logs.value = res.list
  } finally {
    logLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    loadSettings(),
    loadRuntimeModel(),
    knowledgeStore.fetchOptions(),
    loadKeys(),
    loadUsers(),
    loadLogs()
  ])
  if (!userStore.profile) await userStore.fetchProfile()
  // admin 专属：嵌入渠道状态（依赖 profile.role 判定，故在 fetchProfile 之后）
  if (isAdmin.value) await loadEmbeddingState()
})

onUnmounted(() => {
  if (embTimer) clearTimeout(embTimer)
})
</script>

<style scoped>
.reembed-progress {
  width: 420px;
}

.reembed-progress .el-progress {
  margin-bottom: 4px;
}

.page-head {
  margin-bottom: 18px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
}

.page-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--c-text-3);
}

.settings-tabs {
  padding: 4px 20px 24px;
  background: var(--c-bg);
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
}

.setting-form {
  max-width: 760px;
  padding-top: 8px;
}

.form-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--c-text-4);
}

.readonly-model {
  display: flex;
  align-items: center;
  gap: 10px;
}

.key-presence-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.api-key-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.form-tip {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--c-text-4);
}

.model-guide {
  width: 100%;
}

.guide-provider {
  font-weight: 600;
}

.guide-env {
  font-size: 11.5px;
  font-family: ui-monospace, monospace;
  color: var(--c-text-4);
}

.guide-model-tag {
  margin: 2px 6px 2px 0;
}

.sub-card {
  margin-bottom: 14px;
  border: 1px solid var(--c-border-soft);
  border-radius: var(--radius);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
}

.tab-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  font-size: 13px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.u-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 50%;
}

.u-name {
  font-size: 13.5px;
  font-weight: 500;
}

.u-sub {
  font-size: 11.5px;
}
</style>
