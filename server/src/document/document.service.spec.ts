import { describe, expect, it } from 'vitest';
import { fixFilenameEncoding } from './document.service';

describe('fixFilenameEncoding（Multer latin-1 文件名乱码修复）', () => {
  it('纯 ASCII 文件名原样返回', () => {
    expect(fixFilenameEncoding('report-2026.pdf')).toBe('report-2026.pdf');
  });

  it('已正确解码的中文名（无 latin1 扩展区字符）原样返回', () => {
    expect(fixFilenameEncoding('测试文档.md')).toBe('测试文档.md');
  });

  it('latin-1 乱码还原为原始中文（Multer 按 latin1 误读 UTF-8 字节的场景）', () => {
    const mojibake = Buffer.from('许昌学院面试成绩.pdf', 'utf8').toString('latin1');
    expect(mojibake).not.toBe('许昌学院面试成绩.pdf'); // 确认构造出了乱码形态
    expect(fixFilenameEncoding(mojibake)).toBe('许昌学院面试成绩.pdf');
  });

  it('还原结果含 U+FFFD（并非 latin1 乱码）时保留原名，避免误伤', () => {
    // "Ãx" 的 latin1 字节为 C3 78，不是合法 UTF-8 序列，还原会产生替换符
    const notMojibake = 'Ãx.pdf';
    expect(fixFilenameEncoding(notMojibake)).toBe(notMojibake);
  });
});
