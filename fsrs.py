#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FSRS-6 间隔重复调度器（纯标准库，零依赖）。

公式与默认参数来自 open-spaced-repetition 官方文档：
https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm

为什么用 FSRS 而不是固定阶梯（1/2/4/7/15/30/60 天）：
  固定阶梯只有"第几次复习"一个输入，不管这道题对你有多难、
  上次隔了多久、你当时还记不记得。FSRS 用三个量描述记忆状态：
      S  Stability    稳定度：遗忘到 90% 所需天数
      D  Difficulty   难度：1-10，越大越难记
      R  Retrievability 可提取性：此刻还能想起来的概率
  每次作答按 S/D/R 和评分重算 S 和 D，再由 S 推出下次间隔。
  好处：难的知识点自动被问得更勤，简单的自动被拉长；提前/延后
  复习也会被正确折算（R 变低 → 下次 S 增长更多，但有上限）。

本实现不训练参数（个人错题量不足以拟合 21 个参数），用官方默认值。
"""
from __future__ import annotations

import math

# FSRS-6 官方默认参数（21 个）
W = (
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
    1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
)

DECAY = -W[20]                      # 遗忘曲线衰减指数
FACTOR = 0.9 ** (1.0 / DECAY) - 1.0  # 保证 R(S, S) = 0.9

RATINGS = {"again": 1, "hard": 2, "good": 3, "easy": 4}
RATING_LABELS = {1: "重来", 2: "困难", 3: "记得", 4: "简单"}

MIN_STABILITY = 0.1
MIN_INTERVAL = 1        # 天
# 错题本场景：连对 4-5 次后 FSRS 会推到一年以上，那已经没有复习意义了。
# 封顶 365 天，超过就当作"已掌握"由用户决定要不要标记。
MAX_INTERVAL = 365
DEFAULT_RETENTION = 0.9  # 目标记忆保持率


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def retrievability(elapsed_days: float, stability: float) -> float:
    """经过 elapsed_days 天后还能想起的概率 R(t, S)。"""
    if stability <= 0:
        return 0.0
    t = max(0.0, float(elapsed_days))
    return (1.0 + FACTOR * t / stability) ** DECAY


def interval_for(stability: float, retention: float = DEFAULT_RETENTION) -> int:
    """给定稳定度 S，求达到目标保持率所需的间隔天数 I(r, S)。"""
    r = _clamp(float(retention), 0.70, 0.99)
    days = stability / FACTOR * (r ** (1.0 / DECAY) - 1.0)
    return int(_clamp(round(days), MIN_INTERVAL, MAX_INTERVAL))


def init_stability(rating: int) -> float:
    """首次作答的初始稳定度 S0(G) = w[G-1]。"""
    return max(MIN_STABILITY, W[rating - 1])


def init_difficulty(rating: int) -> float:
    """首次作答的初始难度 D0(G) = w4 - e^(w5 * (G-1)) + 1。"""
    d = W[4] - math.exp(W[5] * (rating - 1)) + 1.0
    return _clamp(d, 1.0, 10.0)


def next_difficulty(difficulty: float, rating: int) -> float:
    """难度更新：线性阻尼 + 向 D0(4) 均值回归（防"难度地狱"）。"""
    delta = -W[6] * (rating - 3)
    damped = difficulty + delta * (10.0 - difficulty) / 9.0
    reverted = W[7] * init_difficulty(4) + (1.0 - W[7]) * damped
    return _clamp(reverted, 1.0, 10.0)


def next_stability_recall(difficulty: float, stability: float,
                          recall: float, rating: int) -> float:
    """答对后的稳定度 S'_r（Hard/Good/Easy）。"""
    hard_penalty = W[15] if rating == 2 else 1.0
    easy_bonus = W[16] if rating == 4 else 1.0
    growth = (
        math.exp(W[8])
        * (11.0 - difficulty)
        * (stability ** -W[9])
        * (math.exp(W[10] * (1.0 - recall)) - 1.0)
        * hard_penalty
        * easy_bonus
    )
    return max(MIN_STABILITY, stability * (1.0 + growth))


def next_stability_forget(difficulty: float, stability: float, recall: float) -> float:
    """答错后的稳定度 S'_f（遗忘后不会归零，而是大幅下降）。"""
    s = (
        W[11]
        * (difficulty ** -W[12])
        * ((stability + 1.0) ** W[13] - 1.0)
        * math.exp(W[14] * (1.0 - recall))
    )
    return max(MIN_STABILITY, s)


def next_stability_same_day(stability: float, rating: int) -> float:
    """同一天内再次复习的稳定度（FSRS-6 短时记忆公式）。"""
    increase = math.exp(W[17] * (rating - 3 + W[18])) * (stability ** -W[19])
    if rating >= 2 and increase < 1.0:
        increase = 1.0   # 官方要求：答对时稳定度不得下降
    return max(MIN_STABILITY, stability * increase)


def schedule(stability: float, difficulty: float, reps: int, lapses: int,
             rating: int, elapsed_days: float,
             retention: float = DEFAULT_RETENTION) -> dict:
    """核心入口：给定当前记忆状态与本次评分，算出新状态和下次间隔。

    参数
      stability/difficulty : 当前 S/D；新题为 0
      reps                 : 已复习次数
      lapses               : 累计遗忘次数
      rating               : 1=again 2=hard 3=good 4=easy
      elapsed_days         : 距上次复习的天数（新题忽略）
    返回
      dict(stability, difficulty, reps, lapses, interval_days, retrievability)
    """
    if rating not in (1, 2, 3, 4):
        raise ValueError("rating 必须是 1-4")

    first = reps <= 0 or stability <= 0
    if first:
        new_s = init_stability(rating)
        new_d = init_difficulty(rating)
        recall = None
    else:
        recall = retrievability(elapsed_days, stability)
        new_d = next_difficulty(difficulty, rating)
        if elapsed_days < 1.0:
            new_s = next_stability_same_day(stability, rating)
        elif rating == 1:
            new_s = next_stability_forget(new_d, stability, recall)
        else:
            new_s = next_stability_recall(new_d, stability, recall, rating)

    return {
        "stability": round(new_s, 4),
        "difficulty": round(new_d, 4),
        "reps": reps + 1,
        "lapses": lapses + (1 if rating == 1 else 0),
        "interval_days": interval_for(new_s, retention),
        "retrievability": None if recall is None else round(recall, 4),
    }


def preview(stability: float, difficulty: float, reps: int, lapses: int,
            elapsed_days: float) -> dict:
    """给前端用：四个评分各自会排到多少天后。"""
    out = {}
    for name, rating in RATINGS.items():
        result = schedule(stability, difficulty, reps, lapses, rating, elapsed_days)
        out[name] = result["interval_days"]
    return out
