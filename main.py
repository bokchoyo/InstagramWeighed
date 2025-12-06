"""CLI helper to summarize Instagram inbox exports.

This script mirrors the offline browser experience defined in index.html but runs from
Python for quick command-line summaries. Point it at the ``messages/inbox`` directory and
provide your display name (exactly as it appears as ``sender_name`` in the export).
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timedelta
from typing import Iterable, List, Optional, Set, Tuple


def is_reel_message(msg: dict) -> bool:
    """Detect if a message shares a reel via ``reel_share`` or a reel link/text."""
    if "reel_share" in msg:
        return True

    share = msg.get("share")
    if isinstance(share, dict):
        link = (share.get("link") or "").lower()
        if "instagram.com" in link and ("/reel/" in link or "/reels/" in link):
            return True

        share_text = (share.get("share_text") or "").lower()
        if "reel" in share_text:
            return True

    return False


def compute_longest_streak(date_set: Set[datetime.date]) -> Tuple[int, Optional[datetime.date], Optional[datetime.date]]:
    """
    Compute the longest streak of consecutive days contained in ``date_set``.

    Returns:
        length, start_date, end_date
    """
    if not date_set:
        return 0, None, None

    dates = sorted(date_set)
    longest = current = 1
    longest_start = current_start = dates[0]
    longest_end = dates[0]

    for idx in range(1, len(dates)):
        if dates[idx] == dates[idx - 1] + timedelta(days=1):
            current += 1
        else:
            current = 1
            current_start = dates[idx]

        if current > longest:
            longest = current
            longest_start = current_start
            longest_end = dates[idx]

    if longest == 1:
        longest_end = longest_start

    return longest, longest_start, longest_end


def clean_folder_name(folder_name: str) -> str:
    """Remove trailing Instagram numeric ID from folder name (``liyunye_1324560555606998`` → ``liyunye``)."""
    return re.sub(r"_\d+$", "", folder_name)


def format_date_range(start_date: Optional[datetime.date], end_date: Optional[datetime.date]) -> str:
    if start_date is None or end_date is None:
        return "N/A"
    if start_date == end_date:
        return start_date.isoformat()
    return f"{start_date.isoformat()} → {end_date.isoformat()}"


def count_messages_in_thread(thread_path: str, self_name: str) -> Tuple[int, int, int, int, Optional[datetime.date], Optional[datetime.date], int, int]:
    """
    Inspect all ``message*.json`` files in a thread directory and return summary metrics.

    Returns:
        total, sent, received, longest_streak, streak_start, streak_end, reels_sent, reels_received
    """
    total = sent = received = reels_sent = reels_received = 0
    sent_dates: Set[datetime.date] = set()

    for filename in os.listdir(thread_path):
        lower = filename.lower()
        if not lower.endswith(".json") or not (lower.startswith("message") or lower.startswith("messages")):
            continue

        file_path = os.path.join(thread_path, filename)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"Warning: could not read {file_path}: {exc}")
            continue

        messages = data.get("messages", [])
        for msg in messages:
            total += 1
            sender = msg.get("sender_name", "")
            ts_ms = msg.get("timestamp_ms")

            if sender == self_name:
                sent += 1
                if ts_ms is not None:
                    dt = datetime.fromtimestamp(ts_ms / 1000.0)
                    sent_dates.add(dt.date())
            elif sender:
                received += 1

            if is_reel_message(msg):
                if sender == self_name:
                    reels_sent += 1
                elif sender:
                    reels_received += 1

    longest_streak, streak_start, streak_end = compute_longest_streak(sent_dates)
    return total, sent, received, longest_streak, streak_start, streak_end, reels_sent, reels_received


def summarize_inbox(base_dir: str, self_name: str) -> List[dict]:
    results: List[dict] = []
    for entry in os.listdir(base_dir):
        thread_dir = os.path.join(base_dir, entry)
        if not os.path.isdir(thread_dir):
            continue

        summary = count_messages_in_thread(thread_dir, self_name)
        total = summary[0]
        if total == 0:
            continue

        (
            _total,
            sent,
            received,
            longest_streak,
            streak_start,
            streak_end,
            reels_sent,
            reels_received,
        ) = summary

        results.append(
            {
                "thread_name": entry,
                "total": total,
                "sent": sent,
                "received": received,
                "streak": longest_streak,
                "streak_start": streak_start,
                "streak_end": streak_end,
                "reels_sent": reels_sent,
                "reels_received": reels_received,
                "reels_total": reels_sent + reels_received,
            }
        )

    results.sort(key=lambda x: x["total"], reverse=True)
    return results


def print_summary(results: List[dict], self_name: str, top_n: int = 20) -> None:
    overall_total = sum(r["total"] for r in results)
    overall_sent = sum(r["sent"] for r in results)
    overall_received = sum(r["received"] for r in results)

    for i, r in enumerate(results):
        display_name = clean_folder_name(r["thread_name"])
        date_range_str = format_date_range(r["streak_start"], r["streak_end"])
        print(
            f"{i}. {display_name}: total={r['total']}, sent={r['sent']}, "
            f"received={r['received']}, longest_streak_days={r['streak']}, "
            f"streak_range={date_range_str}, reels_sent={r['reels_sent']}, "
            f"reels_received={r['reels_received']}, reels_total={r['reels_total']}"
        )

    print("\n=== OVERALL TOTALS ===")
    print(f"Total messages: {overall_total}")
    print(f"Total sent by {self_name}: {overall_sent}")
    print(f"Total received: {overall_received}")

    streak_threads = [r for r in results if r["streak"] > 0]
    streak_threads.sort(key=lambda x: x["streak"], reverse=True)
    print("\n=== TOP STREAKS ===")
    for r in streak_threads[:top_n]:
        display_name = clean_folder_name(r["thread_name"])
        date_range_str = format_date_range(r["streak_start"], r["streak_end"])
        print(
            f"{display_name}: longest_streak_days={r['streak']}, "
            f"streak_range={date_range_str}, sent={r['sent']}, total={r['total']}"
        )

    reels_threads = [r for r in results if r["reels_total"] > 0]
    reels_threads.sort(key=lambda x: x["reels_total"], reverse=True)
    print("\n=== TOP REELS THREADS ===")
    for r in reels_threads[:top_n]:
        display_name = clean_folder_name(r["thread_name"])
        print(
            f"{display_name}: reels_total={r['reels_total']}, "
            f"reels_sent={r['reels_sent']}, reels_received={r['reels_received']}"
        )


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize Instagram message exports.")
    parser.add_argument("base_dir", help="Path to your messages/inbox directory")
    parser.add_argument("self_name", help="Your display name as it appears in sender_name")
    parser.add_argument("--top", type=int, default=20, help="How many streak/reel rows to show")
    return parser.parse_args(argv)


def main(argv: Optional[Iterable[str]] = None) -> None:
    args = parse_args(argv)
    results = summarize_inbox(args.base_dir, args.self_name)
    if not results:
        print("No messages found. Double-check the directory path.")
        return
    print_summary(results, args.self_name, top_n=args.top)


if __name__ == "__main__":
    main()