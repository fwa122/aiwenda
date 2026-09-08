import secrets


def gen_id(prefix: str) -> str:
    """生成带前缀业务 ID，与前端/Node 格式一致：ck_xxxx"""
    return f'{prefix}_{secrets.token_hex(6)}'
