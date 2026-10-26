-- 邮箱找回密码前置：users.email 唯一化。
-- NULL 不参与唯一约束（邮箱本就可空）；存量重复邮箱保留 id 最小（最早注册）行，其余置 NULL。
UPDATE "users" SET "email" = NULL
WHERE "email" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id") FROM "users" WHERE "email" IS NOT NULL GROUP BY "email"
  );

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
