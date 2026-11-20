use std::collections::{HashMap, HashSet};

use scraper::{ElementRef, Html, Selector};

use crate::models::{A11yCheckConfig, A11yIssue};

const WCAG_DOCS: &str = "https://www.w3.org/WAI/WCAG21/Understanding";

const VALID_ROLES: &[&str] = &[
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "button",
    "cell",
    "checkbox",
    "columnheader",
    "combobox",
    "complementary",
    "contentinfo",
    "definition",
    "dialog",
    "directory",
    "document",
    "feed",
    "figure",
    "form",
    "grid",
    "gridcell",
    "group",
    "heading",
    "img",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "marquee",
    "math",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "navigation",
    "none",
    "note",
    "option",
    "presentation",
    "progressbar",
    "radio",
    "radiogroup",
    "region",
    "row",
    "rowgroup",
    "rowheader",
    "scrollbar",
    "search",
    "searchbox",
    "separator",
    "slider",
    "spinbutton",
    "status",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem",
];

pub fn run_a11y_scan(html: &str, config: &A11yCheckConfig) -> Vec<A11yIssue> {
    let document = Html::parse_document(html);
    let mut issues = Vec::new();

    let categories: HashSet<&str> = if config.categories.is_empty() {
        HashSet::new()
    } else {
        config.categories.iter().map(|s| s.as_str()).collect()
    };
    let all = categories.is_empty();
    let enabled = |cat: &str| all || categories.contains(cat);

    if enabled("document") {
        check_document(&document, &mut issues);
    }
    if enabled("headings") {
        check_headings(&document, &mut issues);
    }
    if enabled("landmarks") {
        check_landmarks(&document, &mut issues);
    }
    if enabled("aria") {
        check_aria(&document, &mut issues);
    }
    if enabled("interactive") {
        check_interactive(&document, &mut issues);
    }
    if enabled("media") {
        check_media(&document, &mut issues);
    }
    if enabled("tables") {
        check_tables(&document, &mut issues);
    }
    if enabled("forms") {
        check_forms(&document, &mut issues);
    }

    issues.retain(|i| severity_rank(&i.severity) >= severity_rank(&config.min_severity));

    if !config.standards.is_empty() {
        let mut allowed: HashSet<u8> = HashSet::new();
        for s in &config.standards {
            for v in standard_wcag_versions(s) {
                allowed.insert(*v);
            }
        }
        let include_non_wcag = config.standards.iter().any(|s| s == "bestpractice");
        issues.retain(|i| {
            if i.wcag.is_empty() {
                return include_non_wcag;
            }
            allowed.contains(&wcag_criterion_version(&i.wcag))
        });
    }

    issues
}

// WCAG version a criterion belongs to: 0 = 2.0, 1 = 2.1, 2 = 2.2
fn wcag_criterion_version(criterion: &str) -> u8 {
    const V21: &[&str] = &[
        "1.3.4", "1.3.5", "1.3.6", "1.4.10", "1.4.11", "1.4.12", "1.4.13", "2.1.1", "2.1.2",
        "2.1.3", "2.1.4", "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5", "4.1.3",
    ];
    const V22: &[&str] = &[
        "2.4.11", "2.4.12", "2.4.13", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8", "3.3.9",
    ];
    if V22.contains(&criterion) {
        2
    } else if V21.contains(&criterion) {
        1
    } else {
        0
    }
}

// WCAG versions each selectable standard is aligned with (conformance is
// cumulative, so wcag22 covers 2.0+2.1+2.2). Section 508 ≈ WCAG 2.0,
// EN 301 549 ≈ WCAG 2.1 AA.
fn standard_wcag_versions(std: &str) -> &'static [u8] {
    match std {
        "wcag20" => &[0],
        "wcag21" | "en301549" => &[0, 1],
        "wcag22" => &[0, 1, 2],
        "section508" => &[0],
        _ => &[],
    }
}

// ─── Severity ───

fn severity_rank(s: &str) -> u8 {
    match s {
        "critical" => 4,
        "serious" => 3,
        "moderate" => 2,
        "minor" => 1,
        _ => 0,
    }
}

fn issue(
    issue_type: &str,
    severity: &str,
    wcag: &str,
    element: &ElementRef,
    message: &str,
) -> A11yIssue {
    A11yIssue {
        issue_type: issue_type.into(),
        element: element.value().name().to_string(),
        selector: css_path(element),
        message: message.into(),
        severity: severity.into(),
        wcag: wcag.into(),
        standards: vec!["wcag".into()],
        help_url: Some(format!("{}/{}", WCAG_DOCS, wcag)),
    }
}

fn issue_raw(
    issue_type: &str,
    severity: &str,
    wcag: &str,
    element: &str,
    selector: &str,
    message: &str,
) -> A11yIssue {
    A11yIssue {
        issue_type: issue_type.into(),
        element: element.into(),
        selector: selector.into(),
        message: message.into(),
        severity: severity.into(),
        wcag: wcag.into(),
        standards: vec!["wcag".into()],
        help_url: Some(format!("{}/{}", WCAG_DOCS, wcag)),
    }
}

fn css_path(el: &ElementRef) -> String {
    let tag = el.value().name();
    if let Some(id) = el.value().attr("id") {
        if !id.is_empty() {
            return format!("{}#{}", tag, id);
        }
    }
    let classes: Vec<&str> = el
        .value()
        .attr("class")
        .map(|c| c.split_whitespace().take(2).collect())
        .unwrap_or_default();
    if classes.is_empty() {
        tag.to_string()
    } else {
        format!("{}.{}", tag, classes.join("."))
    }
}

fn select(_document: &Html, css: &str) -> Option<Selector> {
    Selector::parse(css).ok()
}

fn each<'a>(document: &'a Html, css: &str, mut f: impl FnMut(&ElementRef<'a>)) {
    if let Some(sel) = select(document, css) {
        for el in document.select(&sel) {
            f(&el);
        }
    }
}

// ─── Document ───

fn check_document(document: &Html, issues: &mut Vec<A11yIssue>) {
    if let Some(sel) = select(document, "html") {
        for html in document.select(&sel) {
            match html.value().attr("lang") {
                Some(lang) if lang.len() >= 2 => {}
                _ => issues.push(issue(
                    "missing-lang",
                    "serious",
                    "3.1.1",
                    &html,
                    "<html> element is missing a valid lang attribute",
                )),
            }
        }
    }

    let has_title = select(document, "title")
        .map(|sel| {
            document
                .select(&sel)
                .any(|el| !el.text().collect::<String>().trim().is_empty())
        })
        .unwrap_or(false);
    if !has_title {
        issues.push(issue_raw(
            "missing-title",
            "serious",
            "2.4.2",
            "document",
            "title",
            "Page is missing a <title> element or it is empty",
        ));
    }

    if let Some(sel) = select(document, "meta[name='viewport']") {
        for meta in document.select(&sel) {
            if let Some(content) = meta.value().attr("content") {
                let c = content.to_lowercase().replace(' ', "");
                let zoom_locked = c.contains("user-scalable=no")
                    || c.split(';')
                        .find_map(|p| p.strip_prefix("maximum-scale="))
                        .and_then(|v| v.parse::<f32>().ok())
                        .map(|v| v < 2.0)
                        .unwrap_or(false);
                if zoom_locked {
                    issues.push(issue(
                        "viewport-zoom",
                        "moderate",
                        "1.4.4",
                        &meta,
                        "Viewport meta tag prevents user zoom (user-scalable=no or maximum-scale < 2)",
                    ));
                }
            }
        }
    }

    let has_charset = select(document, "meta[charset]")
        .map(|sel| document.select(&sel).next().is_some())
        .unwrap_or(false)
        || select(document, "meta[http-equiv='content-type' i]")
            .map(|sel| document.select(&sel).next().is_some())
            .unwrap_or(false);
    if !has_charset {
        issues.push(issue_raw(
            "missing-charset",
            "minor",
            "4.1.1",
            "document",
            "head",
            "Document is missing a charset declaration",
        ));
    }

    each(document, "meta[http-equiv='refresh' i]", |meta| {
        issues.push(issue(
            "meta-refresh",
            "moderate",
            "2.2.1",
            meta,
            "Page uses a meta refresh redirect which users cannot control",
        ));
    });

    // <abbr> should expand via title (WCAG 3.1.4)
    each(document, "abbr", |el| {
        if el
            .value()
            .attr("title")
            .map(|t| t.trim().is_empty())
            .unwrap_or(true)
        {
            issues.push(issue(
                "abbr-no-title",
                "minor",
                "3.1.4",
                el,
                "<abbr> has no title attribute expanding the abbreviation",
            ));
        }
    });
}

// ─── Headings ───

fn check_headings(document: &Html, issues: &mut Vec<A11yIssue>) {
    let heading_sel = match Selector::parse("h1,h2,h3,h4,h5,h6") {
        Ok(s) => s,
        Err(_) => return,
    };
    let headings: Vec<ElementRef> = document.select(&heading_sel).collect();

    if headings.is_empty() {
        issues.push(issue_raw(
            "no-headings",
            "minor",
            "1.3.1",
            "body",
            "body",
            "Page has no heading elements (h1–h6)",
        ));
        return;
    }

    let h1_count = headings.iter().filter(|h| h.value().name() == "h1").count();
    if h1_count == 0 {
        issues.push(issue(
            "missing-h1",
            "minor",
            "1.3.1",
            &headings[0],
            "Page has no h1 heading",
        ));
    } else if h1_count > 1 {
        issues.push(issue(
            "multiple-h1",
            "minor",
            "1.3.1",
            &headings[0],
            &format!("Page has {} h1 headings", h1_count),
        ));
    }

    let mut prev_level = 0u8;
    let mut reported_skip = false;
    for h in &headings {
        let level: u8 = h.value().name()[1..].parse().unwrap_or(0);
        if prev_level > 0 && level > prev_level + 1 && !reported_skip {
            issues.push(issue(
                "heading-skip",
                "moderate",
                "1.3.1",
                h,
                &format!("Heading level jumps from h{} to h{}", prev_level, level),
            ));
            reported_skip = true;
        }
        prev_level = level;
    }
}

// ─── Landmarks ───

fn check_landmarks(document: &Html, issues: &mut Vec<A11yIssue>) {
    let has_main = select(document, "main,[role='main']")
        .map(|sel| document.select(&sel).next().is_some())
        .unwrap_or(false);
    if !has_main {
        issues.push(issue_raw(
            "missing-main",
            "moderate",
            "1.3.1",
            "body",
            "body",
            "Page has no <main> landmark or role=\"main\" element",
        ));
    }

    let has_skip_link = select(document, "a[href^='#']")
        .map(|sel| {
            document.select(&sel).any(|a| {
                a.value().attr("href").map(|h| h.len() > 1).unwrap_or(false)
                    && a.text().collect::<String>().to_lowercase().contains("skip")
            })
        })
        .unwrap_or(false);
    if !has_skip_link {
        issues.push(issue_raw(
            "missing-skip-link",
            "moderate",
            "2.4.1",
            "body",
            "body",
            "Page has no skip-navigation link",
        ));
    }

    let has_nav = select(document, "nav,[role='navigation']")
        .map(|sel| document.select(&sel).next().is_some())
        .unwrap_or(false);
    if !has_nav {
        issues.push(issue_raw(
            "missing-navigation",
            "minor",
            "1.3.1",
            "body",
            "body",
            "Page has no navigation landmark",
        ));
    }

    let has_contentinfo = select(document, "footer,[role='contentinfo']")
        .map(|sel| document.select(&sel).next().is_some())
        .unwrap_or(false);
    if !has_contentinfo {
        issues.push(issue_raw(
            "missing-contentinfo",
            "minor",
            "1.3.1",
            "body",
            "body",
            "Page has no contentinfo (footer) landmark",
        ));
    }

    let mut id_counts: HashMap<&str, usize> = HashMap::new();
    each(document, "[id]", |el| {
        if let Some(id) = el.value().attr("id") {
            *id_counts.entry(id).or_default() += 1;
        }
    });
    let mut reported_dupes = HashSet::new();
    for (id, count) in &id_counts {
        if *count > 1 && reported_dupes.insert(*id) {
            issues.push(issue_raw(
                "duplicate-id",
                "moderate",
                "4.1.1",
                "document",
                &format!("#{}", id),
                &format!("id \"{}\" is used {} times", id, count),
            ));
        }
    }
}

// ─── ARIA ───

fn check_aria(document: &Html, issues: &mut Vec<A11yIssue>) {
    let mut all_ids: HashSet<String> = HashSet::new();
    each(document, "[id]", |el| {
        if let Some(id) = el.value().attr("id") {
            all_ids.insert(id.to_string());
        }
    });

    for attr in [
        "aria-labelledby",
        "aria-describedby",
        "aria-controls",
        "aria-owns",
        "aria-details",
        "aria-errormessage",
    ] {
        if let Some(sel) = select(document, &format!("[{}]", attr)) {
            for el in document.select(&sel) {
                if let Some(refs) = el.value().attr(attr) {
                    for r in refs.split_whitespace() {
                        if !all_ids.contains(r) {
                            issues.push(issue(
                                "broken-aria-ref",
                                "serious",
                                "4.1.2",
                                &el,
                                &format!("{} references non-existent id \"{}\"", attr, r),
                            ));
                        }
                    }
                }
            }
        }
    }

    if let Some(sel) = select(document, "[role]") {
        for el in document.select(&sel) {
            if let Some(role) = el.value().attr("role") {
                let first = role.split_whitespace().next().unwrap_or("");
                if !VALID_ROLES.contains(&first) {
                    issues.push(issue(
                        "invalid-role",
                        "moderate",
                        "4.1.2",
                        &el,
                        &format!("Invalid ARIA role \"{}\"", role),
                    ));
                }
            }
        }
    }

    // aria-hidden="true" must not hide focusable content
    if let Some(sel) = select(document, "[aria-hidden='true']") {
        let focusable_desc = Selector::parse(
            "a[href],button,input:not([type='hidden']),select,textarea,[tabindex]:not([tabindex='-1']),[contenteditable]",
        )
        .ok();
        for el in document.select(&sel) {
            let descendant_focusable = focusable_desc
                .as_ref()
                .map(|s| el.select(s).next().is_some())
                .unwrap_or(false);
            if is_focusable(&el) || descendant_focusable {
                issues.push(issue(
                    "aria-hidden-focusable",
                    "serious",
                    "4.1.2",
                    &el,
                    "aria-hidden=\"true\" element contains or is focusable content",
                ));
            }
        }
    }

    // aria-expanded should be paired with aria-controls pointing at the
    // expanded region (heuristic — some valid patterns omit it)
    each(document, "[aria-expanded]", |el| {
        if el.value().attr("aria-controls").is_none() {
            issues.push(issue(
                "aria-expanded-no-controls",
                "minor",
                "4.1.2",
                el,
                "aria-expanded is set without aria-controls referencing the controlled region",
            ));
        }
    });
}

fn is_focusable(el: &ElementRef) -> bool {
    let tag = el.value().name();
    if matches!(
        tag,
        "a" | "button" | "input" | "select" | "textarea" | "summary" | "iframe"
    ) {
        if tag == "a" && el.value().attr("href").is_none() {
            // <a> without href isn't focusable
        } else {
            return true;
        }
    }
    if let Some(t) = el.value().attr("tabindex") {
        if t.trim() != "-1" {
            return true;
        }
    }
    el.value().attr("contenteditable").is_some()
}

// ─── Interactive ───

fn check_interactive(document: &Html, issues: &mut Vec<A11yIssue>) {
    // Images without usable alt text
    each(document, "img", |img| match img.value().attr("alt") {
        None => issues.push(issue(
            "missing-alt",
            "critical",
            "1.1.1",
            img,
            "Image is missing alt text",
        )),
        Some("") => issues.push(issue(
            "empty-alt",
            "minor",
            "1.1.1",
            img,
            "Image has empty alt text (ok only if decorative)",
        )),
        _ => {}
    });

    // Links
    each(document, "a", |a| {
        let href = a.value().attr("href").unwrap_or("");
        if href.is_empty() {
            issues.push(issue(
                "empty-link",
                "serious",
                "2.4.4",
                a,
                "Link has no href or empty href",
            ));
        } else if href == "#" || href.starts_with("javascript:") {
            issues.push(issue(
                "placeholder-link",
                "moderate",
                "2.4.4",
                a,
                &format!("Link href is a placeholder (\"{}\")", href),
            ));
        }
    });

    // Buttons without accessible name
    each(document, "button", |btn| {
        if accessible_name(btn).is_none() {
            issues.push(issue(
                "missing-label",
                "serious",
                "4.1.2",
                btn,
                "Button has no accessible name (no aria-label, aria-labelledby, title, or text content)",
            ));
        }
    });

    // Positive tabindex
    each(document, "[tabindex]", |el| {
        if let Some(v) = el.value().attr("tabindex") {
            if v.parse::<i32>().map(|n| n > 0).unwrap_or(false) {
                issues.push(issue(
                    "positive-tabindex",
                    "moderate",
                    "2.4.3",
                    el,
                    &format!(
                        "Element has tabindex=\"{}\" which disrupts natural tab order",
                        v
                    ),
                ));
            }
        }
    });

    // Autofocus
    each(document, "[autofocus]", |el| {
        issues.push(issue(
            "autofocus",
            "minor",
            "3.2.1",
            el,
            "Element uses autofocus which can disorient screen-reader users",
        ));
    });

    // Nested interactive elements (a/button inside a/button)
    if let Ok(sel) = Selector::parse("a,button") {
        for el in document.select(&sel) {
            if let Ok(inner) = Selector::parse("a[href],button") {
                if el.select(&inner).next().is_some() {
                    issues.push(issue(
                        "nested-interactive",
                        "serious",
                        "4.1.2",
                        &el,
                        "Interactive element contains another interactive element",
                    ));
                }
            }
        }
    }

    // target="_blank" without rel="noopener"
    each(document, "a[target='_blank']", |a| {
        let safe = a
            .value()
            .attr("rel")
            .map(|r| {
                r.split_whitespace()
                    .any(|t| t.eq_ignore_ascii_case("noopener"))
            })
            .unwrap_or(false);
        if !safe {
            issues.push(issue(
                "target-blank-noopener",
                "minor",
                "3.2.5",
                a,
                "Link opens in a new tab without rel=\"noopener\"",
            ));
        }
    });

    // onclick on non-interactive elements without role/tabindex
    each(document, "[onclick]", |el| {
        let tag = el.value().name();
        if matches!(
            tag,
            "a" | "button" | "input" | "select" | "textarea" | "label" | "summary"
        ) {
            return;
        }
        if el.value().attr("role").is_some() || el.value().attr("tabindex").is_some() {
            return;
        }
        issues.push(issue(
            "onclick-noninteractive",
            "moderate",
            "2.1.1",
            el,
            &format!(
                "<{}> has an onclick handler but is not keyboard-accessible (no role or tabindex)",
                tag
            ),
        ));
    });

    // tabindex="-1" removes naturally focusable elements from tab order
    each(document, "[tabindex='-1']", |el| {
        let tag = el.value().name();
        let naturally_focusable = match tag {
            "button" | "select" | "textarea" => true,
            "a" => el.value().attr("href").is_some(),
            "input" => el
                .value()
                .attr("type")
                .map(|t| t != "hidden")
                .unwrap_or(true),
            _ => false,
        };
        if naturally_focusable {
            issues.push(issue(
                "tabindex-neg-focusable",
                "moderate",
                "2.1.1",
                el,
                &format!(
                    "<{}> is naturally focusable but tabindex=\"-1\" removes it from tab order",
                    tag
                ),
            ));
        }
    });

    // input[type=image] and area[href] are images and need alt text
    each(document, "input[type='image'],area[href]", |el| {
        if el.value().attr("alt").is_none() {
            issues.push(issue(
                "missing-alt",
                "critical",
                "1.1.1",
                el,
                &format!("<{}> is missing alt text", el.value().name()),
            ));
        }
    });
}

// ─── Media ───

fn check_media(document: &Html, issues: &mut Vec<A11yIssue>) {
    for tag in ["video", "audio"] {
        if let Some(sel) = select(document, tag) {
            for el in document.select(&sel) {
                // Check descendant <track kind="captions">
                let has_track = el.select(&Selector::parse("track").unwrap()).any(|t| {
                    t.value()
                        .attr("kind")
                        .map(|k| k == "captions" || k == "subtitles")
                        .unwrap_or(false)
                });
                if !has_track {
                    issues.push(issue(
                        "missing-captions",
                        "serious",
                        "1.2.2",
                        &el,
                        &format!("<{}> has no captions/subtitles track", tag),
                    ));
                }
            }
        }
    }

    each(document, "marquee,blink", |el| {
        issues.push(issue(
            "marquee-blink",
            "moderate",
            "2.2.2",
            el,
            &format!(
                "<{}> creates moving/blinking content users cannot pause",
                el.value().name()
            ),
        ));
    });

    // Autoplaying media without controls can't be paused by the user (WCAG 2.2.2)
    each(document, "video[autoplay],audio[autoplay]", |el| {
        if el.value().attr("controls").is_none() {
            issues.push(issue(
                "media-autoplay-no-controls",
                "moderate",
                "2.2.2",
                el,
                &format!(
                    "<{} autoplay> has no controls attribute — users cannot pause it",
                    el.value().name()
                ),
            ));
        }
    });

    each(document, "iframe", |iframe| {
        let titled = iframe
            .value()
            .attr("title")
            .map(|t| !t.trim().is_empty())
            .unwrap_or(false)
            || iframe
                .value()
                .attr("aria-label")
                .map(|t| !t.trim().is_empty())
                .unwrap_or(false);
        if !titled {
            issues.push(issue(
                "iframe-no-title",
                "serious",
                "4.1.2",
                iframe,
                "<iframe> is missing a title attribute",
            ));
        }
    });
}

// ─── Tables ───

fn check_tables(document: &Html, issues: &mut Vec<A11yIssue>) {
    each(document, "table", |table| {
        let has_th = table
            .select(&Selector::parse("th").unwrap())
            .next()
            .is_some();
        if !has_th {
            return;
        }
        for th in table.select(&Selector::parse("th").unwrap()) {
            if th.value().attr("scope").is_none()
                && th.value().attr("headers").is_none()
                && th.value().attr("id").is_none()
            {
                issues.push(issue(
                    "th-no-scope",
                    "minor",
                    "1.3.1",
                    &th,
                    "<th> has no scope, headers, or id attribute",
                ));
            }
        }
    });
}

// ─── Forms ───

fn check_forms(document: &Html, issues: &mut Vec<A11yIssue>) {
    let mut labelled_ids: HashSet<String> = HashSet::new();
    each(document, "label[for]", |label| {
        if let Some(for_id) = label.value().attr("for") {
            labelled_ids.insert(for_id.to_string());
        }
    });

    for css in [
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='image']):not([type='reset'])",
        "select",
        "textarea",
    ] {
        if let Some(sel) = select(document, css) {
            for el in document.select(&sel) {
                let tag = el.value().name().to_string();
                let input_type = el.value().attr("type").unwrap_or("");
                let element_desc = if tag == "input" && !input_type.is_empty() {
                    format!("input[type={}]", input_type)
                } else {
                    tag.clone()
                };

                if accessible_name(&el).is_some() {
                    continue;
                }

                // Check label[for=id] or wrapping <label>
                let has_assoc_label = el
                    .value()
                    .attr("id")
                    .map(|id| labelled_ids.contains(id))
                    .unwrap_or(false)
                    || el
                        .ancestors()
                        .filter_map(ElementRef::wrap)
                        .any(|a| a.value().name() == "label");
                if has_assoc_label {
                    continue;
                }

                if el.value().attr("placeholder").is_some() {
                    issues.push(issue(
                        "placeholder-label",
                        "serious",
                        "3.3.2",
                        &el,
                        &format!("{} uses placeholder as its only label", element_desc),
                    ));
                } else {
                    issues.push(issue(
                        "missing-label",
                        "critical",
                        "3.3.2",
                        &el,
                        &format!("{} has no associated label", element_desc),
                    ));
                }
            }
        }
    }

    // Inputs that collect user data should declare autocomplete tokens (WCAG 1.3.5)
    if let Ok(sel) = Selector::parse("input[type='email'],input[type='tel'],input[type='url']") {
        for el in document.select(&sel) {
            if el.value().attr("autocomplete").is_none() {
                let t = el.value().attr("type").unwrap_or("");
                issues.push(issue(
                    "missing-autocomplete",
                    "minor",
                    "1.3.5",
                    &el,
                    &format!("input[type={}] is missing an autocomplete attribute", t),
                ));
            }
        }
    }

    // Radio groups should be wrapped in fieldset/legend
    if let Ok(sel) = Selector::parse("input[type='radio'][name]") {
        let radios: Vec<ElementRef> = document.select(&sel).collect();
        let mut groups: HashMap<&str, Vec<&ElementRef>> = HashMap::new();
        for r in &radios {
            if let Some(name) = r.value().attr("name") {
                groups.entry(name).or_default().push(r);
            }
        }
        for (name, members) in groups {
            if members.len() < 2 {
                continue;
            }
            let has_fieldset = members.iter().any(|m| {
                m.ancestors()
                    .filter_map(ElementRef::wrap)
                    .any(|a| a.value().name() == "fieldset")
            });
            if !has_fieldset {
                issues.push(issue(
                    "radio-no-legend",
                    "minor",
                    "1.3.1",
                    members[0],
                    &format!(
                        "Radio group \"{}\" is not grouped in a <fieldset> with <legend>",
                        name
                    ),
                ));
            }
        }
    }
}

// ─── Helpers ───

fn accessible_name(el: &ElementRef) -> Option<String> {
    if let Some(v) = el.value().attr("aria-label") {
        if !v.trim().is_empty() {
            return Some(v.trim().to_string());
        }
    }
    if let Some(v) = el.value().attr("title") {
        if !v.trim().is_empty() {
            return Some(v.trim().to_string());
        }
    }
    // aria-labelledby → resolve referenced text (best effort: any ids present)
    if let Some(refs) = el.value().attr("aria-labelledby") {
        let non_empty = refs.split_whitespace().any(|r| !r.is_empty());
        if non_empty {
            return Some(refs.to_string());
        }
    }
    let text: String = el.text().collect::<Vec<_>>().join(" ");
    let text = text.trim();
    if !text.is_empty() {
        return Some(text.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::A11yCheckConfig;

    fn config() -> A11yCheckConfig {
        A11yCheckConfig::default()
    }

    fn types(issues: &[A11yIssue]) -> Vec<&str> {
        issues.iter().map(|i| i.issue_type.as_str()).collect()
    }

    #[test]
    fn clean_page_has_no_issues() {
        let html = r##"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title><meta name="viewport" content="width=device-width"></head><body><a href="#main" class="skip">Skip to content</a><nav><a href="/n">N</a></nav><main><h1>Hi</h1><h2>Sub</h2><img src="a.png" alt="A"><p>text</p></main><footer>f</footer></body></html>"##;
        let issues = run_a11y_scan(html, &config());
        // missing-skip-link won't fire (skip link exists); expect only maybe none
        assert!(issues.is_empty(), "unexpected issues: {:?}", types(&issues));
    }

    #[test]
    fn document_issues() {
        let html = r#"<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        assert!(t.contains(&"missing-lang"));
        assert!(t.contains(&"missing-title"));
        assert!(t.contains(&"viewport-zoom"));
        assert!(t.contains(&"missing-charset"));
    }

    #[test]
    fn heading_issues() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><h1>a</h1><h3>b</h3><h1>c</h1></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        assert!(t.contains(&"heading-skip"));
        assert!(t.contains(&"multiple-h1"));
    }

    #[test]
    fn no_h1_and_no_headings() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><p>x</p></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        assert!(types(&issues).contains(&"no-headings"));
    }

    #[test]
    fn landmark_issues() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><div id="a"></div><div id="a"></div></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        assert!(t.contains(&"missing-main"));
        assert!(t.contains(&"missing-skip-link"));
        assert!(t.contains(&"duplicate-id"));
    }

    #[test]
    fn aria_issues() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><div aria-labelledby="nope" role="bogus"></div></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        assert!(t.contains(&"broken-aria-ref"));
        assert!(t.contains(&"invalid-role"));
    }

    #[test]
    fn interactive_issues() {
        let html = r##"<html lang="en"><head><title>t</title></head><body><img src="x.png"><a>no href</a><a href="#">hash</a><button></button><div tabindex="3"></div><input autofocus></body></html>"##;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        assert!(t.contains(&"missing-alt"));
        assert!(t.contains(&"empty-link"));
        assert!(t.contains(&"placeholder-link"));
        assert!(t.contains(&"missing-label")); // button
        assert!(t.contains(&"positive-tabindex"));
        assert!(t.contains(&"autofocus"));
        assert!(t.contains(&"missing-label")); // input too
    }

    #[test]
    fn media_issues() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><video src="v.mp4"></video><iframe src="x"></iframe></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        assert!(t.contains(&"missing-captions"));
        assert!(t.contains(&"iframe-no-title"));
    }

    #[test]
    fn table_issues() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><table><tr><th>Name</th></tr><tr><td>x</td></tr></table></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        assert!(types(&issues).contains(&"th-no-scope"));
    }

    #[test]
    fn form_label_issues() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><input type="text"><input type="text" placeholder="name"><label for="ok">L</label><input id="ok" type="text"><select></select><textarea></textarea></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        assert!(t.iter().filter(|x| **x == "missing-label").count() >= 2); // input + select + textarea = 3
        assert!(t.contains(&"placeholder-label"));
    }

    #[test]
    fn severity_filter() {
        let html = r#"<html><head></head><body><img src="x.png"></body></html>"#;
        let mut cfg = config();
        cfg.min_severity = "serious".into();
        let issues = run_a11y_scan(html, &cfg);
        // missing-alt is critical -> kept; missing-charset minor -> dropped
        let t = types(&issues);
        assert!(t.contains(&"missing-alt"));
        assert!(!t.contains(&"missing-charset"));
    }

    #[test]
    fn category_filter() {
        let html = r#"<html><head></head><body><img src="x.png"></body></html>"#;
        let mut cfg = config();
        cfg.categories = vec!["document".into()];
        let issues = run_a11y_scan(html, &cfg);
        assert!(!types(&issues).contains(&"missing-alt"));
    }

    #[test]
    fn phase_e_new_rules() {
        let html = r##"<html lang="en"><head><title>t</title><meta http-equiv="refresh" content="0;url=/x"></head><body>
            <a href="#"><button>nested</button></a>
            <a href="https://x.com" target="_blank">ext</a>
            <div onclick="go()">clicky</div>
            <div aria-hidden="true"><a href="/h">hidden link</a></div>
            <div aria-controls="missing">ctrl</div>
            <input type="email">
            <fieldset></fieldset>
            <input type="radio" name="r" value="1"><input type="radio" name="r" value="2">
            <marquee>move</marquee>
        </body></html>"##;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        for expected in [
            "meta-refresh",
            "nested-interactive",
            "target-blank-noopener",
            "onclick-noninteractive",
            "aria-hidden-focusable",
            "broken-aria-ref",
            "missing-autocomplete",
            "radio-no-legend",
            "marquee-blink",
        ] {
            assert!(t.contains(&expected), "missing {} in {:?}", expected, t);
        }
        // email input with no label should also flag missing-label
        assert!(t.contains(&"missing-label"));
        // standards metadata populated
        assert!(issues
            .iter()
            .all(|i| i.standards.contains(&"wcag".to_string())));
    }

    #[test]
    fn aria_hidden_clean_case() {
        // aria-hidden on non-focusable decorative content is fine
        let html = r#"<html lang="en"><head><title>t</title></head><body><div aria-hidden="true"><span>decor</span></div></body></html>"#;
        let issues = run_a11y_scan(html, &config());
        assert!(!types(&issues).contains(&"aria-hidden-focusable"));
        // dangling aria-controls on non-hidden element still flagged via broken-aria-ref
        let html2 = r#"<html lang="en"><head><title>t</title></head><body><div aria-controls="nope"></div></body></html>"#;
        assert!(types(&run_a11y_scan(html2, &config())).contains(&"broken-aria-ref"));
    }

    #[test]
    fn phase_e_batch2_rules() {
        let html = r##"<html lang="en"><head><title>t</title></head><body>
            <button aria-expanded="true">exp</button>
            <a href="/x" tabindex="-1">removed from tab order</a>
            <input type="image" src="btn.png">
            <map name="m"><area href="/a"></map>
            <abbr>WCAG</abbr>
            <video autoplay src="v.mp4"></video>
        </body></html>"##;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        for expected in [
            "aria-expanded-no-controls",
            "tabindex-neg-focusable",
            "missing-alt", // input[type=image] + area[href]
            "abbr-no-title",
            "media-autoplay-no-controls",
            "missing-captions", // video has no track
            "missing-navigation",
            "missing-contentinfo",
        ] {
            assert!(t.contains(&expected), "missing {} in {:?}", expected, t);
        }
        // input[type=image]/area missing-alt are critical
        assert!(
            issues
                .iter()
                .filter(|i| i.issue_type == "missing-alt" && i.severity == "critical")
                .count()
                >= 2
        );
    }

    #[test]
    fn standards_filter() {
        let html = r##"<html lang="en"><head><title>t</title><meta http-equiv="refresh" content="0;url=/x"></head><body><abbr>HTML</abbr><input type="email"></body></html>"##;
        // meta-refresh=2.2.1 & abbr-no-title=3.1.4 are WCAG 2.0 criteria;
        // missing-autocomplete=1.3.5 is WCAG 2.1
        let mut cfg = config();
        cfg.standards = vec!["section508".into()]; // WCAG 2.0 only
        let issues = run_a11y_scan(html, &cfg);
        let t = types(&issues);
        assert!(t.contains(&"abbr-no-title"));
        assert!(t.contains(&"meta-refresh"));
        assert!(!t.contains(&"missing-autocomplete"));

        cfg.standards = vec!["wcag21".into()];
        let issues = run_a11y_scan(html, &cfg);
        let t = types(&issues);
        assert!(t.contains(&"meta-refresh"));
        assert!(t.contains(&"missing-autocomplete"));
        assert!(t.contains(&"abbr-no-title"));

        // bestpractice only -> static engine emits no non-WCAG issues
        cfg.standards = vec!["bestpractice".into()];
        assert!(run_a11y_scan(html, &cfg).is_empty());
    }
}
