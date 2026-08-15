use pulldown_cmark::{Event, Parser};

pub fn markdown_to_plain_text(markdown: &str) -> String {
    let mut text = String::new();
    for event in Parser::new(markdown_body(markdown)) {
        match event {
            Event::Text(value) | Event::Code(value) => text.push_str(&value),
            Event::SoftBreak | Event::HardBreak => text.push('\n'),
            _ => {}
        }
    }
    text
}

fn markdown_body(markdown: &str) -> &str {
    let mut lines = markdown.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return markdown;
    };
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return markdown;
    }

    let mut offset = first.len();
    for line in lines {
        offset += line.len();
        if matches!(line.trim_end_matches(['\r', '\n']), "---" | "...") {
            return &markdown[offset..];
        }
    }
    ""
}

#[cfg(test)]
mod tests {
    use super::markdown_to_plain_text;

    #[test]
    fn extracts_text_code_and_breaks_without_frontmatter_or_markdown_syntax() {
        let markdown = "---\ntitle: 지도 검색\n---\n본문 *강조*와 `route_id`  \n다음 [링크](https://example.com)";

        let text = markdown_to_plain_text(markdown);

        assert_eq!(text, "본문 강조와 route_id\n다음 링크");
    }
}
