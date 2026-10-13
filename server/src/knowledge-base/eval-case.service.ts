import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { genId } from '../common/id.util';
import { canReadKb, canWriteKb, SessionUser } from '../common/kb-access';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEvalCaseDto,
  ImportEvalCasesDto,
  UpdateEvalCaseDto,
} from './dto/eval-case.dto';

/** 关键词归一化：去空、截断（单条 64 字符，最多 20 条与 DTO 校验一致） */
function normalizeKeywords(keywords?: string[] | null): string[] {
  return (keywords || [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((k) => k.slice(0, 64));
}

@Injectable()
export class EvalCaseService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 读权限：能访问知识库即可查看/运行评测（与检索测试口径一致） */
  private async assertReadable(kbId: string, user: SessionUser) {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    if (!canReadKb(kb, user)) throw new ForbiddenException('无权访问该知识库');
    return kb;
  }

  /** 写权限：owner / admin（与知识库配置修改口径一致） */
  private async assertWritable(kbId: string, user: SessionUser) {
    const kb = await this.assertReadable(kbId, user);
    if (!canWriteKb(kb, user)) throw new ForbiddenException('无权操作该知识库');
    return kb;
  }

  /** 用例列表（难例排后，其余按创建顺序，保持稳定的评测序） */
  async list(kbId: string, user: SessionUser) {
    await this.assertReadable(kbId, user);
    const list = await this.prisma.evalCase.findMany({
      where: { kbId },
      orderBy: [{ isHard: 'asc' }, { createdAt: 'asc' }],
    });
    return { list, total: list.length };
  }

  async create(kbId: string, dto: CreateEvalCaseDto, user: SessionUser) {
    await this.assertWritable(kbId, user);
    const question = dto.question.trim();
    if (!question) throw new BadRequestException('问题不能为空');
    await this.assertQuestionFree(kbId, question);
    return this.prisma.evalCase.create({
      data: {
        id: genId('evc'),
        kbId,
        question,
        docNameContains: dto.docNameContains.trim(),
        keywords: normalizeKeywords(dto.keywords),
        note: dto.note,
        source: dto.source ?? 'manual',
        isHard: dto.isHard ?? false,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async update(kbId: string, caseId: string, dto: UpdateEvalCaseDto, user: SessionUser) {
    await this.assertWritable(kbId, user);
    const existed = await this.prisma.evalCase.findFirst({ where: { id: caseId, kbId } });
    if (!existed) throw new NotFoundException('评测用例不存在');
    if (dto.question !== undefined) {
      const question = dto.question.trim();
      if (!question) throw new BadRequestException('问题不能为空');
      if (question !== existed.question) await this.assertQuestionFree(kbId, question, caseId);
      dto.question = question;
    }
    return this.prisma.evalCase.update({
      where: { id: caseId },
      data: {
        ...(dto.question !== undefined ? { question: dto.question } : {}),
        ...(dto.docNameContains !== undefined
          ? { docNameContains: dto.docNameContains.trim() }
          : {}),
        ...(dto.keywords !== undefined ? { keywords: normalizeKeywords(dto.keywords) } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
        ...(dto.isHard !== undefined ? { isHard: dto.isHard } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
  }

  async remove(kbId: string, caseId: string, user: SessionUser) {
    await this.assertWritable(kbId, user);
    const existed = await this.prisma.evalCase.findFirst({ where: { id: caseId, kbId } });
    if (!existed) throw new NotFoundException('评测用例不存在');
    await this.prisma.evalCase.delete({ where: { id: caseId } });
    return { id: caseId };
  }

  /** 批量导入（内置模板 / 历史难例 JSON / 手工导出文件），按问题全等去重 */
  async import(kbId: string, dto: ImportEvalCasesDto, user: SessionUser) {
    await this.assertWritable(kbId, user);
    const existing = await this.prisma.evalCase.findMany({
      where: { kbId },
      select: { question: true },
    });
    const seen = new Set(existing.map((c) => c.question));
    const toCreate: {
      id: string;
      kbId: string;
      question: string;
      docNameContains: string;
      keywords: string[];
      note?: string;
      source: string;
      isHard: boolean;
      enabled: boolean;
    }[] = [];
    let skipped = 0;
    for (const item of dto.cases) {
      const question = item.question.trim();
      if (!question || seen.has(question)) {
        skipped += 1;
        continue;
      }
      seen.add(question);
      toCreate.push({
        id: genId('evc'),
        kbId,
        question,
        docNameContains: (item.docNameContains || '').trim().slice(0, 128),
        keywords: normalizeKeywords(item.keywords),
        note: item.note,
        source: item.source ?? 'manual',
        isHard: item.isHard ?? false,
        enabled: true,
      });
    }
    if (toCreate.length) await this.prisma.evalCase.createMany({ data: toCreate });
    return { created: toCreate.length, skipped };
  }

  /** 同库内问题查重（update 时排除自身） */
  private async assertQuestionFree(kbId: string, question: string, excludeId?: string) {
    const dup = await this.prisma.evalCase.findFirst({
      where: { kbId, question, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new BadRequestException('已存在相同问题的用例');
  }
}
