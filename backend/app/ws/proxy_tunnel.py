from __future__ import annotations

import asyncio
import base64
import os
import socket
import ssl
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote, urlsplit

from socksio.socks4 import SOCKS4ARequest, SOCKS4Command, SOCKS4Reply, SOCKS4ReplyCode, SOCKS4Request
from socksio.socks5 import (
    SOCKS5AuthMethod,
    SOCKS5AuthMethodsRequest,
    SOCKS5Command,
    SOCKS5CommandRequest,
    SOCKS5Connection,
    SOCKS5ReplyCode,
    SOCKS5UsernamePasswordRequest,
)


PROXY_ENV_KEYS = (
    "BINANCE_WS_PROXY",
    "ALL_PROXY",
    "all_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
)


@dataclass(frozen=True)
class ProxyConfig:
    scheme: str
    host: str
    port: int
    username: str | None = None
    password: str | None = None

    @property
    def display(self) -> str:
        auth = ""
        if self.username:
            auth = f"{self.username}@"
        return f"{self.scheme}://{auth}{self.host}:{self.port}"


def resolve_proxy_config() -> ProxyConfig | None:
    for key in PROXY_ENV_KEYS:
        raw = os.getenv(key)
        if not raw:
            continue
        return _parse_proxy_url(raw)
    return None


async def build_ws_connect_kwargs(url: str) -> dict[str, Any]:
    proxy = resolve_proxy_config()
    if proxy is None:
        return {}

    ws_url = urlsplit(url)
    host = ws_url.hostname
    if not host:
        raise ValueError(f"Invalid WebSocket URL: {url}")

    port = ws_url.port or (443 if ws_url.scheme == "wss" else 80)

    sock = await asyncio.to_thread(_open_proxy_tunnel, proxy, host, port)

    return {"sock": sock, "ssl": ssl.create_default_context() if ws_url.scheme == "wss" else None}


def _parse_proxy_url(proxy_url: str) -> ProxyConfig:
    parsed = urlsplit(proxy_url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "socks4", "socks4a", "socks5", "socks5h"}:
        raise ValueError(f"Unsupported Binance WS proxy scheme: {parsed.scheme}")
    if not parsed.hostname or not parsed.port:
        raise ValueError(f"Proxy URL must include host and port: {proxy_url}")
    return ProxyConfig(
        scheme=scheme,
        host=parsed.hostname,
        port=parsed.port,
        username=unquote(parsed.username) if parsed.username else None,
        password=unquote(parsed.password) if parsed.password else None,
    )


def _open_proxy_tunnel(proxy: ProxyConfig, target_host: str, target_port: int) -> socket.socket:
    sock = socket.create_connection((proxy.host, proxy.port), timeout=10.0)
    sock.settimeout(10.0)
    try:
        if proxy.scheme in {"socks5", "socks5h"}:
            _negotiate_socks5(sock, proxy, target_host, target_port)
        elif proxy.scheme in {"socks4", "socks4a"}:
            _negotiate_socks4(sock, proxy, target_host, target_port)
        elif proxy.scheme == "http":
            _negotiate_http_connect(sock, proxy, target_host, target_port)
        else:
            raise ValueError(f"Unsupported Binance WS proxy scheme: {proxy.scheme}")
        sock.settimeout(None)
        sock.setblocking(False)
        return sock
    except Exception:
        sock.close()
        raise


def _negotiate_socks5(sock: socket.socket, proxy: ProxyConfig, target_host: str, target_port: int) -> None:
    conn = SOCKS5Connection()
    methods = [SOCKS5AuthMethod.NO_AUTH_REQUIRED]
    if proxy.username is not None:
        methods.append(SOCKS5AuthMethod.USERNAME_PASSWORD)
    conn.send(SOCKS5AuthMethodsRequest(methods))
    sock.sendall(conn.data_to_send())

    auth_reply = conn.receive_data(_recv_exact(sock, 2))
    if auth_reply.method == SOCKS5AuthMethod.NO_ACCEPTABLE_METHODS:
        raise RuntimeError(f"SOCKS5 proxy rejected authentication methods: {proxy.display}")

    if auth_reply.method == SOCKS5AuthMethod.USERNAME_PASSWORD:
        if proxy.username is None or proxy.password is None:
            raise RuntimeError(f"SOCKS5 proxy requires username/password: {proxy.display}")
        conn.send(
            SOCKS5UsernamePasswordRequest(
                username=proxy.username.encode("utf-8"),
                password=proxy.password.encode("utf-8"),
            )
        )
        sock.sendall(conn.data_to_send())
        auth_result = conn.receive_data(_recv_exact(sock, 2))
        if not auth_result.success:
            raise RuntimeError(f"SOCKS5 proxy authentication failed: {proxy.display}")

    conn.send(SOCKS5CommandRequest.from_address(SOCKS5Command.CONNECT, (target_host, target_port)))
    sock.sendall(conn.data_to_send())
    reply = conn.receive_data(_recv_socks5_reply(sock))
    if reply.reply_code != SOCKS5ReplyCode.SUCCEEDED:
        raise RuntimeError(f"SOCKS5 proxy connect failed: {reply.reply_code.name}")


def _negotiate_socks4(sock: socket.socket, proxy: ProxyConfig, target_host: str, target_port: int) -> None:
    user_id = (proxy.username or "").encode("utf-8")
    if proxy.scheme == "socks4a":
        request = SOCKS4ARequest.from_address(SOCKS4Command.CONNECT, (target_host, target_port), user_id=user_id)
    else:
        request = SOCKS4Request.from_address(SOCKS4Command.CONNECT, (target_host, target_port), user_id=user_id)
    sock.sendall(request.dumps(user_id=user_id))

    reply = SOCKS4Reply.loads(_recv_exact(sock, 8))
    if reply.reply_code != SOCKS4ReplyCode.REQUEST_GRANTED:
        raise RuntimeError(f"SOCKS4 proxy connect failed: {reply.reply_code.name}")


def _negotiate_http_connect(sock: socket.socket, proxy: ProxyConfig, target_host: str, target_port: int) -> None:
    headers = [
        f"CONNECT {target_host}:{target_port} HTTP/1.1",
        f"Host: {target_host}:{target_port}",
    ]
    if proxy.username is not None:
        password = proxy.password or ""
        credentials = f"{proxy.username}:{password}".encode("utf-8")
        headers.append(f"Proxy-Authorization: Basic {base64.b64encode(credentials).decode('ascii')}")
    headers.append("")
    headers.append("")
    sock.sendall("\r\n".join(headers).encode("utf-8"))

    response = _recv_until(sock, b"\r\n\r\n")
    status_line = response.split(b"\r\n", 1)[0].decode("iso-8859-1", errors="replace")
    parts = status_line.split(" ", 2)
    if len(parts) < 2 or not parts[1].isdigit():
        raise RuntimeError(f"Malformed HTTP proxy response: {status_line}")
    if int(parts[1]) != 200:
        raise RuntimeError(f"HTTP proxy CONNECT failed: {status_line}")


def _recv_socks5_reply(sock: socket.socket) -> bytes:
    head = _recv_exact(sock, 4)
    atyp = head[3]
    if atyp == 0x01:
        tail = _recv_exact(sock, 4 + 2)
    elif atyp == 0x03:
        length = _recv_exact(sock, 1)
        tail = length + _recv_exact(sock, length[0] + 2)
    elif atyp == 0x04:
        tail = _recv_exact(sock, 16 + 2)
    else:
        raise RuntimeError(f"Unsupported SOCKS5 address type: {atyp}")
    return head + tail


def _recv_exact(sock: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = sock.recv(size - len(chunks))
        if not chunk:
            raise RuntimeError("Proxy connection closed during handshake")
        chunks.extend(chunk)
    return bytes(chunks)


def _recv_until(sock: socket.socket, marker: bytes) -> bytes:
    chunks = bytearray()
    while marker not in chunks:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("Proxy connection closed before handshake completed")
        chunks.extend(chunk)
    return bytes(chunks)
