import base64

from app.config import settings


def _get_key() -> bytes:
    """从配置获取加密密钥，填充到 32 字节"""
    key = settings.encryption_key.encode()
    return key.ljust(32, b"\0")[:32]


def encrypt_value(plain: str) -> str:
    """简单 XOR 加密 + base64（MVP 阶段，生产环境应替换为 AES-GCM）"""
    key = _get_key()
    encrypted = bytes(a ^ b for a, b in zip(plain.encode(), key * (len(plain) // len(key) + 1)))
    return base64.b64encode(encrypted).decode()


def decrypt_value(encrypted: str) -> str:
    """解密"""
    key = _get_key()
    data = base64.b64decode(encrypted)
    decrypted = bytes(a ^ b for a, b in zip(data, key * (len(data) // len(key) + 1)))
    return decrypted.decode()


def mask_key(api_key: str) -> str:
    """脱敏显示：前4位 + *** + 后4位"""
    if len(api_key) <= 8:
        return "***"
    return api_key[:4] + "***" + api_key[-4:]
