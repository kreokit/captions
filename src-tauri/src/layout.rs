//! Caption line layout: how a segment's words are broken into lines and on-screen pages.
//!
//! The same algorithm lives in src/lib/layout.ts for the preview; both are tested against
//! fixtures/layout-cases.json so preview and exports always break lines identically.
//! Keep the two in sync.

use crate::model::{Segment, Word};

/// One caption screen: up to `max_lines` lines of word indices into the layout's words.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub start_ms: u64,
    pub end_ms: u64,
    pub lines: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    /// The segment's words, or one word spanning the segment if it has no word timings.
    pub words: Vec<Word>,
    pub pages: Vec<Page>,
}

/// Greedy line breaking: a word joins the current line if the line (words plus single
/// spaces) stays within `max_chars` characters; a longer word gets a line of its own.
/// Lines are grouped into pages of `max_lines`. The first page starts with the segment,
/// later pages with their first word, and each page lasts until the next one starts (the
/// last until the segment ends).
pub fn layout(segment: &Segment, max_chars: u32, max_lines: u32) -> Layout {
    let words = if !segment.words.is_empty() {
        segment.words.clone()
    } else if !segment.text.trim().is_empty() {
        vec![Word {
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            text: segment.text.trim().to_string(),
        }]
    } else {
        Vec::new()
    };
    let max_chars = max_chars.max(1) as usize;
    let max_lines = max_lines.max(1) as usize;

    let mut lines: Vec<Vec<usize>> = Vec::new();
    let mut line_len = 0;
    for (i, word) in words.iter().enumerate() {
        let len = word.text.chars().count();
        match lines.last_mut() {
            Some(line) if line_len + 1 + len <= max_chars => {
                line.push(i);
                line_len += 1 + len;
            }
            _ => {
                lines.push(vec![i]);
                line_len = len;
            }
        }
    }

    let chunks: Vec<Vec<Vec<usize>>> = lines.chunks(max_lines).map(<[_]>::to_vec).collect();
    let starts: Vec<u64> = chunks
        .iter()
        .enumerate()
        .map(|(p, page)| {
            if p == 0 {
                segment.start_ms
            } else {
                words[page[0][0]].start_ms
            }
        })
        .collect();
    let pages = chunks
        .into_iter()
        .enumerate()
        .map(|(p, lines)| Page {
            start_ms: starts[p],
            end_ms: starts.get(p + 1).copied().unwrap_or(segment.end_ms),
            lines,
        })
        .collect();
    Layout { words, pages }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Cases {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        max_chars: u32,
        max_lines: u32,
        segment: CaseSegment,
        pages: Vec<CasePage>,
    }

    #[derive(Deserialize)]
    struct CaseSegment {
        start_ms: u64,
        end_ms: u64,
        text: String,
        words: Vec<Word>,
    }

    #[derive(Deserialize, Debug, PartialEq)]
    struct CasePage {
        start_ms: u64,
        end_ms: u64,
        lines: Vec<Vec<String>>,
    }

    #[test]
    fn matches_shared_cases() {
        let cases: Cases =
            serde_json::from_str(include_str!("../../fixtures/layout-cases.json")).unwrap();
        for case in cases.cases {
            let segment = Segment {
                id: 0,
                start_ms: case.segment.start_ms,
                end_ms: case.segment.end_ms,
                text: case.segment.text,
                words: case.segment.words,
            };
            let result = layout(&segment, case.max_chars, case.max_lines);
            let pages: Vec<CasePage> = result
                .pages
                .iter()
                .map(|p| CasePage {
                    start_ms: p.start_ms,
                    end_ms: p.end_ms,
                    lines: p
                        .lines
                        .iter()
                        .map(|l| l.iter().map(|&i| result.words[i].text.clone()).collect())
                        .collect(),
                })
                .collect();
            assert_eq!(pages, case.pages, "case: {}", case.name);
        }
    }
}
