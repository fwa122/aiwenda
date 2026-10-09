import { describe, expect, it } from 'vitest';
import { buildHistoryWithBudget } from './chat.service';

const row = (role: string, content: string) => ({ role, content });

describe('buildHistoryWithBudget（历史上下文字符预算裁剪）', () => {
  it('空历史返回空数组', () => {
    expect(buildHistoryWithBudget([], 4000, 1200)).toEqual([]);
  });

  it('预算充足时全部装入且保持时间正序（传入为 desc 数组）', () => {
    const rows = [row('user', '最新问题'), row('assistant', '最新回答'), row('user', '较早问题')];
    const out = buildHistoryWithBudget(rows, 4000, 1200);
    expect(out.map((m) => m.content)).toEqual(['较早问题', '最新回答', '最新问题']);
  });

  it('单条超长截断并加省略号', () => {
    const out = buildHistoryWithBudget([row('assistant', 'x'.repeat(1500))], 4000, 1200);
    expect(out[0].content).toBe('x'.repeat(1200) + '…');
  });

  it('预算耗尽时优先保留最新消息，装不下的更旧消息整体放弃', () => {
    // desc 数组：rows[0] 最新。四条各 1500 → 截断为 1201；
    // 最新 3 条 = 3603 ≤ 4000 装入，最旧 1201 > 剩余 397 → 放弃
    const rows = [
      row('user', 'u'.repeat(1500)), // 最新
      row('assistant', 'a'.repeat(1500)),
      row('assistant', 'b'.repeat(1500)),
      row('user', 'c'.repeat(1500)), // 最旧
    ];
    const out = buildHistoryWithBudget(rows, 4000, 1200);
    expect(out.map((m) => m.content)).toEqual([
      'b'.repeat(1200) + '…',
      'a'.repeat(1200) + '…',
      'u'.repeat(1200) + '…',
    ]);
  });

  it('非最新消息装不下时整体放弃，不会被截断塞入', () => {
    const rows = [row('user', 'u'.repeat(600)), row('assistant', 'a'.repeat(2000))];
    const out = buildHistoryWithBudget(rows, 1000, 5000);
    expect(out).toEqual([row('user', 'u'.repeat(600))]);
  });

  it('最新一条自身超预算时截断装入保底，保证至少一轮上下文', () => {
    // 单条上限 5000 不触发截断，靠总预算 1000 触发保底分支
    const out = buildHistoryWithBudget([row('user', 'u'.repeat(2000))], 1000, 5000);
    expect(out).toEqual([row('user', 'u'.repeat(1000) + '…')]);
  });

  it('组合场景：单条截断后逐条装入，装不下的更旧消息放弃', () => {
    // 三条各 1500 → 截断为 1201；预算 3000：最新 + 次新 = 2402 装入，第三条 > 剩余 598 放弃
    const rows = [
      row('user', 'u'.repeat(1500)),
      row('assistant', 'a'.repeat(1500)),
      row('user', 'o'.repeat(1500)),
    ];
    const out = buildHistoryWithBudget(rows, 3000, 1200);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe('a'.repeat(1200) + '…');
    expect(out[1].content).toBe('u'.repeat(1200) + '…');
  });
});
