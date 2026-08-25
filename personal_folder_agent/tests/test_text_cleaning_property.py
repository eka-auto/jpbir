"""Property-based tests for text cleaning (clean_text).

Validates Requirement 2.1: text cleaning removes Unicode control characters
U+0000-U+001F (except tab U+0009, LF U+000A, CR U+000D), normalizes line
endings to LF, collapses runs of horizontal whitespace to single spaces, and
strips leading/trailing whitespace.

Properties under test:
1. No forbidden control characters remain in the output.
2. The multiset of non-whitespace, non-forbidden characters is preserved.
3. Cleaning is idempotent: clean_text(clean_text(x)) == clean_text(x).
4. Empty input yields empty output.
"""

from hypothesis import given, settings, strategies as st

from personal_folder_agent.components.text_processor import clean_text

# Forbidden control characters: U+0000-U+0008, U+000B-U+000C, U+000E-U+001F
# (i.e. everything in U+0000-U+001F except tab, LF, CR).
FORBIDDEN = frozenset(chr(c) for c in range(0x20) if c not in (0x09, 0x0A, 0x0D))


def _preserved_chars(s: str) -> str:
    """Characters cleaning must leave untouched, as a sorted string.

    Whitespace (space, tab, LF, CR, and any other Unicode whitespace) is
    excluded because it may be collapsed, normalized, or stripped. Forbidden
    control characters are excluded because they are removed outright.
    """
    return "".join(sorted(c for c in s if c not in FORBIDDEN and not c.isspace()))


# Arbitrary strings mixing control characters, ASCII printable text, broader
# Unicode, and explicit whitespace to stress normalization.
_any_char = st.one_of(
    st.characters(min_codepoint=0x00, max_codepoint=0x1F),  # control chars
    st.characters(min_codepoint=0x20, max_codepoint=0x7E),  # ASCII printable
    st.characters(
        min_codepoint=0x80,
        max_codepoint=0x2FFF,
        blacklist_categories=("Cs",),  # exclude surrogates
    ),
    st.sampled_from([" ", "\t", "\n", "\r"]),  # boost whitespace frequency
)

_text = st.text(alphabet=_any_char, max_size=200)


@given(_text)
@settings(max_examples=200, deadline=None)
def test_no_forbidden_control_characters_remain(text):
    result = clean_text(text)
    assert all(c not in FORBIDDEN for c in result)


@given(_text)
@settings(max_examples=200, deadline=None)
def test_non_whitespace_characters_preserved(text):
    result = clean_text(text)
    assert _preserved_chars(result) == _preserved_chars(text)


@given(_text)
@settings(max_examples=200, deadline=None)
def test_cleaning_is_idempotent(text):
    once = clean_text(text)
    twice = clean_text(once)
    assert twice == once


def test_empty_input_returns_empty_string():
    assert clean_text("") == ""
