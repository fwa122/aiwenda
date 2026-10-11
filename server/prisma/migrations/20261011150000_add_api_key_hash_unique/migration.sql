-- API 密钥认证闭环：keyHash 唯一索引，认证按等值查找（此前无索引且未标唯一）
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
