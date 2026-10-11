/**
 * 敏感词过滤（settings.security.enableSensitiveFilter 开关控制，默认开启）。
 * 拦截点：用户提问（chat.streamAnswer 持久化消息前），命中即拒答。
 * 词库代码内置（不在 settings 暴露明文），覆盖政治/色情/赌博/暴恐/辱骂高频类别，
 * 后续如需可扩展为可配置词库。
 */
export const DEFAULT_SENSITIVE_WORDS: string[] = [
  // 政治
  '法轮功', '达赖', '六四事件', '文化大革命', '台独', '港独', '藏独', '疆独',
  '法西斯', '纳粹', '推翻政府', '颠覆国家',
  // 色情
  '淫秽', '色情', '援交', '卖淫', '嫖娼', '裸聊', '成人电影', ' porn',
  // 赌博
  '赌博', '赌场', '博彩', '网络赌球', '老虎机', '赌博网站', 'gambling', 'casino',
  // 暴恐
  '恐怖袭击', '炸弹制作', '爆炸物', '枪支买卖', '毒品制作', '制毒', '贩毒',
  '自杀教程', '恐怖分子', 'terrorist', 'bomb making',
  // 违规服务
  '代办证件', '假发票', '洗钱', '诈骗教程', '黑客攻击', '木马程序', '外挂制作',
  // 辱骂
  '傻逼', '婊子', '去死吧', '狗日的', '他妈的滚', 'fuck', 'bitch',
];

/** 归一化：小写 + 去全部空白（英文词大小写归一，防「a b c」空格绕过） */
function normalize(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, '');
}

/** 返回命中的第一个敏感词；未命中返回 null */
export function findSensitiveWord(
  text: string,
  words: string[] = DEFAULT_SENSITIVE_WORDS,
): string | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  for (const word of words) {
    const w = normalize(word);
    if (w && normalized.includes(w)) return word;
  }
  return null;
}
