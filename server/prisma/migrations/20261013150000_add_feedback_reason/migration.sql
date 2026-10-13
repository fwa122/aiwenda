-- v0.9.39 问答反馈闭环：messages 表扩展点踩原因与备注
ALTER TABLE "messages" ADD COLUMN "feedback_reason" VARCHAR(64);
ALTER TABLE "messages" ADD COLUMN "feedback_note" VARCHAR(255);
