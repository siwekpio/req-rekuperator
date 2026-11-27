# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Strict IPv4 LAN target validation for read-only REQNET HTTP requests.

Only RFC1918 unicast address ranges are eligible. Do not use
IPv4Address.is_private as it also includes non-LAN special addresses.
No hostname resolution or outgoing connections are performed here.
"""
from __future__ import annotations

from ipaddress import IPv4Address, IPv4Network

_RFC1918_NETWORKS = (
    IPv4Network("10.0.0.0/8"),
    IPv4Network("172.16.0.0/12"),
    IPv4Network("192.168.0.0/16"),
)


def is_allowed_lan_ipv4(host: str) -> bool:
    """Return True only for a plain IPv4 address in one of the RFC1918 blocks.

    This intentionally rejects IPv6, DNS names, URLs, loopback, link-local,
    unspecified, multicast, public and documentation/benchmark ranges.
    """
    if not isinstance(host, str) or not host:
        return False
    try:
        address = IPv4Address(host)
    except (ValueError, TypeError):
        return False
    return any(address in network for network in _RFC1918_NETWORKS)
