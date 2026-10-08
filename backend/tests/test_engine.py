"""The shared recommender engine on synthetic data: two separate tastes stay separate, dislikes push away,
creators are capped in the slate, and other editions of things you own are recognised."""
from datetime import date

import numpy as np

from app.recommender import engine
from app.recommender.media import same_as_owned


def _things():
    rng = np.random.default_rng(0)
    axes = np.eye(16, dtype=np.float32)
    def near(axis, i, who):
        v = axes[axis] + 0.15 * rng.standard_normal(16).astype(np.float32)
        return engine.Thing(i, v / np.linalg.norm(v), f"t{i}", genres=[f"g{axis}"], creators=[who], tags=[f"tag{axis}"], public=7.5, votes=500)
    loved = [near(0, i, "a") for i in range(15)] + [near(1, 100 + i, "b") for i in range(15)]  # two separate tastes
    hated = [near(2, 200 + i, "c") for i in range(15)]
    cands = [near(0, 300 + i, "a" if i < 5 else f"x{i}") for i in range(10)] + [near(1, 400 + i, f"y{i}") for i in range(10)] \
        + [near(2, 500 + i, f"z{i}") for i in range(10)]
    labels = [engine.Label(t, 0.9, True, 30 + t.id) for t in loved] + [engine.Label(t, -0.8, False, 30 + t.id) for t in hated]
    return labels, cands


def test_two_tastes_and_dislikes():
    labels, cands = _things()
    slate = engine.recommend(labels, cands, {}, everything=[lab.thing for lab in labels] + cands, creator_noun="director",
                             today=date(2026, 10, 5), keep=12, wild_n=0)
    assert slate is not None
    top = [cands[i].id for i in slate.order[:12]]
    assert any(300 <= i < 400 for i in top) and any(400 <= i < 500 for i in top)  # both tastes represented
    assert not any(i >= 500 for i in top)  # nothing like what you dislike
    assert sum(1 for i in slate.order if cands[i].creators == ["a"]) <= engine.PER_CREATOR
    assert all(0 <= p <= 1 for p in slate.prob)
    near_hated = [i for i, c in enumerate(cands) if c.id >= 500]
    assert max(slate.prob[near_hated]) < min(slate.prob[i] for i in slate.order[:3])


def test_other_editions_are_owned():
    owned = {"prideandprejudice", "thewitcher3wildhunt", "wutheringheights", "it"}
    assert same_as_owned("Pride and Prejudice", owned)
    assert same_as_owned("The Witcher 3 Wild Hunt - Complete Edition", owned)
    assert same_as_owned("La tempestosa (Wuthering Heights)", owned)
    assert not same_as_owned("Italy for Beginners", owned)
