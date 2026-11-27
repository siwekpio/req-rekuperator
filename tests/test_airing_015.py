# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""0.1.5 — REQNET authoritative countdown protocol tests, no HA runtime required."""
from __future__ import annotations
import unittest
from test_protocol import P

class AiringTests(unittest.TestCase):
    def setUp(self):
        self.work=[0]*101
        self.work[0]=1
        self.work[10]=4
        self.work[11]=14
        self.work[12]=50

    def test_actual_device_sample(self):
        self.assertEqual(P.airing_remaining_seconds(self.work), 890)
        self.assertEqual(P.build_values(self.work, None)['przewietrzanie_pozostalo_sekund'],890)

    def test_boundary_countdown(self):
        self.work[11]=0
        self.work[12]=1
        self.assertEqual(P.airing_remaining_seconds(self.work),1)
        self.work[12]=0
        self.assertEqual(P.airing_remaining_seconds(self.work),0)
        self.work[11]=95
        self.work[12]=59
        self.assertEqual(P.airing_remaining_seconds(self.work),5759)

    def test_non_airing_never_uses_stale_time(self):
        self.work[10]=8
        self.assertIsNone(P.airing_remaining_seconds(self.work))
        self.assertIsNone(P.build_values(self.work,None)['przewietrzanie_pozostalo_sekund'])

    def test_invalid_remaining_is_not_a_fake_zero(self):
        for val in (-1,60,'unknown','unavailable',None,True,1.5):
            self.work[12]=val
            self.assertIsNone(P.airing_remaining_seconds(self.work), val)
        self.work[12]=10
        for val in (-1,96,'bad',None,True):
            self.work[11]=val
            self.assertIsNone(P.airing_remaining_seconds(self.work), val)
        self.assertIsNone(P.airing_remaining_seconds(None))

if __name__=='__main__':unittest.main()
