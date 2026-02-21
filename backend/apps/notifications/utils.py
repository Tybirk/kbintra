"""
Utility functions for notifications.
"""

import re


def extract_mention_ids(html: str) -> list[int]:
    """Extract user IDs from Tiptap mention spans in HTML content.

    Handles both attribute orderings:
      <span data-type="mention" data-id="42" ...>
      <span data-id="42" data-type="mention" ...>
    """
    ids = re.findall(r'data-type=["\']mention["\'][^>]*data-id=["\'](\d+)["\']', html)
    ids += re.findall(r'data-id=["\'](\d+)["\'][^>]*data-type=["\']mention["\']', html)
    return list({int(i) for i in ids})
