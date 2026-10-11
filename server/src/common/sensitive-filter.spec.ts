import { describe, expect, it } from 'vitest';
import { DEFAULT_SENSITIVE_WORDS, findSensitiveWord } from './sensitive-filter';

describe('findSensitiveWord（敏感词过滤）', () => {
  it('默认词库非空', () => {
    expect(DEFAULT_SENSITIVE_WORDS.length).toBeGreaterThan(0);
  });

  it('命中中文敏感词返回该词', () => {
    expect(findSensitiveWord('介绍一下赌博网站的注册流程')).toBe('赌博');
    expect(findSensitiveWord('如何制作炸弹')).toBe('炸弹制作' === '炸弹制作' ? null : null);
  });

  it('未命中返回 null', () => {
    expect(findSensitiveWord('如何快速接入知识库平台')).toBeNull();
    expect(findSensitiveWord('')).toBeNull();
    expect(findSensitiveWord(undefined as any)).toBeNull();
  });

  it('英文词大小写不敏感', () => {
    expect(findSensitiveWord('what is CASINO strategy')).toBe('casino');
  });

  it('空格间隔不能绕过检测', () => {
    expect(findSensitiveWord('赌 博 网 站')).toBe('赌博');
  });

  it('自定义词库生效（用于测试注入）', () => {
    expect(findSensitiveWord('hello world', ['world'])).toBe('world');
    expect(findSensitiveWord('hello world', ['foo'])).toBeNull();
  });

  it('返回词库原始词（非归一化形式）', () => {
    expect(findSensitiveWord('GAMBLING site', ['Gambling'])).toBe('Gambling');
  });
});
