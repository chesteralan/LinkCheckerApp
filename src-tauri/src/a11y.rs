use std::collections::{HashMap, HashSet};

use scraper::{ElementRef, Html, Selector};

use crate::models::{A11yCheckConfig, A11yIssue};

const WCAG_DOCS: &str = "https://www.w3.org/WAI/WCAG22/Understanding";

/// Marker passed as the `wcag` argument for heuristic rules that are not
/// WCAG success-criterion failures. Such issues carry an empty `wcag` field and
/// the `best-practice` standard tag (same tag axe-core uses), so the
/// "bestpractice" standard selection can include/exclude them.
const BEST_PRACTICE: &str = "";
const BEST_PRACTICE_TAG: &str = "best-practice";

// WAI-ARIA 1.2 roles (plus the Graphics ARIA module). Abstract roles are
// intentionally excluded since authors must not use them.
const VALID_ROLES: &[&str] = &[
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "blockquote",
    "button",
    "caption",
    "cell",
    "checkbox",
    "code",
    "columnheader",
    "combobox",
    "comment",
    "complementary",
    "contentinfo",
    "definition",
    "deletion",
    "dialog",
    "directory",
    "document",
    "emphasis",
    "feed",
    "figure",
    "form",
    "generic",
    "graphics-document",
    "graphics-object",
    "graphics-symbol",
    "grid",
    "gridcell",
    "group",
    "heading",
    "image",
    "img",
    "insertion",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "mark",
    "marquee",
    "math",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "meter",
    "navigation",
    "none",
    "note",
    "option",
    "paragraph",
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
    "strong",
    "subscript",
    "suggestion",
    "superscript",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "time",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem",
];

// DPUB-ARIA 1.1 roles
const DPUB_ROLES: &[&str] = &[
    "doc-abstract",
    "doc-acknowledgments",
    "doc-afterword",
    "doc-appendix",
    "doc-backlink",
    "doc-biblioentry",
    "doc-bibliography",
    "doc-biblioref",
    "doc-chapter",
    "doc-colophon",
    "doc-conclusion",
    "doc-cover",
    "doc-credit",
    "doc-credits",
    "doc-dedication",
    "doc-endnote",
    "doc-endnotes",
    "doc-epigraph",
    "doc-epilogue",
    "doc-errata",
    "doc-example",
    "doc-footnote",
    "doc-foreword",
    "doc-glossary",
    "doc-glossref",
    "doc-index",
    "doc-introduction",
    "doc-noteref",
    "doc-notice",
    "doc-pagebreak",
    "doc-pagefooter",
    "doc-pageheader",
    "doc-pagelist",
    "doc-part",
    "doc-preface",
    "doc-prologue",
    "doc-pullquote",
    "doc-qna",
    "doc-subtitle",
    "doc-tip",
    "doc-toc",
];

fn is_valid_role(token: &str) -> bool {
    let t = token.to_ascii_lowercase();
    VALID_ROLES.contains(&t.as_str()) || DPUB_ROLES.contains(&t.as_str())
}

/// A role attribute is a space-separated fallback list; the browser uses the
/// first token it recognises, so it is only invalid when no token is valid.
/// An empty/whitespace-only attribute is ignored.
fn role_attr_is_invalid(role: &str) -> bool {
    let mut tokens = role.split_whitespace().peekable();
    tokens.peek().is_some() && !tokens.any(is_valid_role)
}

/// True when the viewport meta `content` blocks pinch-zoom (WCAG 1.4.4):
/// `user-scalable=no|0` or `maximum-scale` < 2. Viewport properties are
/// comma-separated, though `;` is accepted too since it appears in the wild.
fn viewport_blocks_zoom(content: &str) -> bool {
    let c = content.to_lowercase().replace(char::is_whitespace, "");
    c.split([',', ';']).any(|part| {
        let Some((key, value)) = part.split_once('=') else {
            return false;
        };
        match key {
            "user-scalable" => matches!(value, "no" | "0"),
            "maximum-scale" => value.parse::<f32>().map(|v| v < 2.0).unwrap_or(false),
            _ => false,
        }
    })
}

/// WCAG Understanding document slug for a success criterion.
fn understanding_slug(sc: &str) -> Option<&'static str> {
    Some(match sc {
        "1.1.1" => "non-text-content",
        "1.2.2" => "captions-prerecorded",
        "1.3.1" => "info-and-relationships",
        "1.3.5" => "identify-input-purpose",
        "1.4.4" => "resize-text",
        "2.1.1" => "keyboard",
        "2.2.1" => "timing-adjustable",
        "2.2.2" => "pause-stop-hide",
        "2.4.1" => "bypass-blocks",
        "2.4.2" => "page-titled",
        "2.4.3" => "focus-order",
        "2.4.4" => "link-purpose-in-context",
        "3.1.1" => "language-of-page",
        "3.1.4" => "abbreviations",
        "3.2.1" => "on-focus",
        "3.2.5" => "change-on-request",
        "3.3.2" => "labels-or-instructions",
        "4.1.1" => "parsing",
        "4.1.2" => "name-role-value",
        _ => return None,
    })
}

fn help_url_for(wcag: &str) -> Option<String> {
    understanding_slug(wcag).map(|slug| format!("{}/{}.html", WCAG_DOCS, slug))
}

fn standards_for(wcag: &str) -> Vec<String> {
    if wcag.is_empty() {
        vec![BEST_PRACTICE_TAG.into()]
    } else {
        vec!["wcag".into()]
    }
}

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
        // 4.1.1 Parsing was removed in WCAG 2.2 — keep it only when some other
        // selected standard (2.0/2.1/508/EN 301 549) still includes it.
        let include_parsing = config
            .standards
            .iter()
            .any(|s| s != "wcag22" && !standard_wcag_versions(s).is_empty());
        issues.retain(|i| {
            if i.wcag.is_empty() {
                return include_non_wcag;
            }
            if i.wcag == "4.1.1" && !include_parsing {
                return false;
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
        standards: standards_for(wcag),
        help_url: help_url_for(wcag),
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
        standards: standards_for(wcag),
        help_url: help_url_for(wcag),
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
                if viewport_blocks_zoom(content) {
                    issues.push(issue(
                        "viewport-zoom",
                        "moderate",
                        "1.4.4",
                        &meta,
                        "Viewport meta tag prevents user zoom (user-scalable=no/0 or maximum-scale < 2)",
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
            BEST_PRACTICE,
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

    // html lang should be a valid BCP 47-ish tag
    if let Some(html_el) = document.select(&Selector::parse("html").unwrap()).next() {
        if let Some(lang) = html_el.value().attr("lang") {
            let valid = lang.len() >= 2
                && lang.split('-').all(|part| {
                    !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric())
                });
            if !valid {
                issues.push(issue(
                    "invalid-lang",
                    "minor",
                    "3.1.1",
                    &html_el,
                    &format!("lang=\"{}\" is not a valid language tag", lang),
                ));
            }
        }
    }
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
            BEST_PRACTICE,
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
            BEST_PRACTICE,
            &headings[0],
            "Page has no h1 heading",
        ));
    } else if h1_count > 1 {
        issues.push(issue(
            "multiple-h1",
            "minor",
            BEST_PRACTICE,
            &headings[0],
            &format!("Page has {} h1 headings", h1_count),
        ));
    }

    let mut prev_level = 0u8;
    let mut reported_skip = false;
    for h in &headings {
        let level: u8 = h.value().name()[1..].parse().unwrap_or(0);
        if h.text().collect::<String>().trim().is_empty() {
            issues.push(issue(
                "empty-heading",
                "minor",
                BEST_PRACTICE,
                h,
                &format!("<h{}> has no text content", level),
            ));
        }
        if prev_level > 0 && level > prev_level + 1 && !reported_skip {
            issues.push(issue(
                "heading-skip",
                "moderate",
                BEST_PRACTICE,
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
            BEST_PRACTICE,
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
            BEST_PRACTICE,
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
            BEST_PRACTICE,
            "body",
            "body",
            "Page has no contentinfo (footer) landmark",
        ));
    }

    // Multiple nav landmarks should be distinguishable by accessible name
    if let Ok(sel) = Selector::parse("nav,[role='navigation']") {
        let navs: Vec<ElementRef> = document.select(&sel).collect();
        if navs.len() > 1 {
            for nav in &navs {
                let named = nav.value().attr("aria-label").is_some()
                    || nav.value().attr("aria-labelledby").is_some()
                    || nav
                        .value()
                        .attr("title")
                        .map(|t| !t.trim().is_empty())
                        .unwrap_or(false);
                if !named {
                    issues.push(issue(
                        "unnamed-duplicate-landmark",
                        "moderate",
                        BEST_PRACTICE,
                        nav,
                        "Multiple navigation landmarks exist but this one has no accessible name",
                    ));
                }
            }
        }
    }

    // All content should live inside a landmark (axe `region`, IBM
    // "content must reside within an element with a landmark role").
    if let Some(body) = select(document, "body").and_then(|sel| document.select(&sel).next()) {
        let mut outside = Vec::new();
        collect_content_outside_landmarks(&body, false, &mut outside);
        for el in outside.iter().take(MAX_REGION_ISSUES) {
            issues.push(issue(
                "content-outside-landmark",
                "moderate",
                BEST_PRACTICE,
                el,
                "Content is not contained within a landmark (main, nav, header, footer, aside, or a named region)",
            ));
        }
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
    let mut id_counts: HashMap<String, usize> = HashMap::new();
    each(document, "[id]", |el| {
        if let Some(id) = el.value().attr("id") {
            *id_counts.entry(id.to_string()).or_default() += 1;
        }
    });

    for attr in [
        "aria-labelledby",
        "aria-describedby",
        "aria-controls",
        "aria-owns",
        "aria-activedescendant",
        "aria-flowto",
        "aria-details",
        "aria-errormessage",
    ] {
        if let Some(sel) = select(document, &format!("[{}]", attr)) {
            for el in document.select(&sel) {
                let Some(refs) = el.value().attr(attr) else {
                    continue;
                };
                if refs.trim().is_empty() {
                    issues.push(issue(
                        "broken-aria-ref",
                        "serious",
                        "4.1.2",
                        &el,
                        &format!("{} is empty — it must reference an element id", attr),
                    ));
                    continue;
                }
                for r in refs.split_whitespace() {
                    match id_counts.get(r).copied().unwrap_or(0) {
                        0 => issues.push(issue(
                            "broken-aria-ref",
                            "serious",
                            "4.1.2",
                            &el,
                            &format!("{} references non-existent id \"{}\"", attr, r),
                        )),
                        1 => {}
                        n => issues.push(issue(
                            "broken-aria-ref",
                            "serious",
                            "4.1.2",
                            &el,
                            &format!(
                                "{} references id \"{}\" which is not unique ({} elements)",
                                attr, r, n
                            ),
                        )),
                    }
                }
            }
        }
    }

    if let Some(sel) = select(document, "[role]") {
        for el in document.select(&sel) {
            if let Some(role) = el.value().attr("role") {
                if role_attr_is_invalid(role) {
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
                BEST_PRACTICE,
                el,
                "aria-expanded is set without aria-controls referencing the controlled region",
            ));
        }
    });

    // aria-live must be a valid token
    each(document, "[aria-live]", |el| {
        let valid = el
            .value()
            .attr("aria-live")
            .map(|v| matches!(v.trim(), "off" | "polite" | "assertive"))
            .unwrap_or(false);
        if !valid {
            issues.push(issue(
                "aria-live-invalid",
                "moderate",
                "4.1.2",
                el,
                &format!(
                    "aria-live=\"{}\" is not a valid value (off|polite|assertive)",
                    el.value().attr("aria-live").unwrap_or("")
                ),
            ));
        }
    });

    // aria-label on elements whose implicit role is generic or prohibits
    // naming (no explicit role) is ignored by AT. Elements such as section,
    // table, ul/ol/li, tr/td have roles that support naming, so they are
    // deliberately not listed.
    each(document, "[aria-label]", |el| {
        if el.value().attr("role").is_some() {
            return;
        }
        if matches!(
            el.value().name(),
            "div"
                | "span"
                | "p"
                | "br"
                | "b"
                | "i"
                | "u"
                | "s"
                | "em"
                | "strong"
                | "small"
                | "code"
                | "pre"
                | "sub"
                | "sup"
                | "mark"
                | "del"
                | "ins"
                | "q"
                | "data"
                | "time"
                | "bdi"
                | "bdo"
        ) {
            issues.push(issue(
                "aria-label-generic",
                "minor",
                "4.1.2",
                el,
                &format!(
                    "aria-label on <{}> without a role is ignored by assistive technology",
                    el.value().name()
                ),
            ));
        }
    });

    // role="presentation"/"none" must not hide focusable content (same rule
    // as aria-hidden)
    if let Ok(sel) = Selector::parse("[role='presentation'],[role='none']") {
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
                    "presentation-focusable",
                    "serious",
                    "4.1.2",
                    &el,
                    "role=\"presentation\"/\"none\" element contains or is focusable content",
                ));
            }
        }
    }
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
            BEST_PRACTICE,
            img,
            "Image has empty alt text (ok only if decorative)",
        )),
        _ => {}
    });

    // Links
    each(document, "a", |a| {
        let v = a.value();
        let Some(href) = v.attr("href").map(str::trim) else {
            // <a> without href is a placeholder/named anchor, not a link —
            // only flag it when it is made to behave like one.
            let acts_as_link = v
                .attr("role")
                .map(|r| r.split_whitespace().any(|t| t.eq_ignore_ascii_case("link")))
                .unwrap_or(false)
                || v.attr("onclick").is_some()
                || v.attr("tabindex").is_some();
            if acts_as_link {
                issues.push(issue(
                    "empty-link",
                    "serious",
                    "2.4.4",
                    a,
                    "Element acts as a link (role/onclick/tabindex) but has no href",
                ));
            }
            return;
        };
        if href.is_empty() {
            issues.push(issue(
                "empty-link",
                "serious",
                "2.4.4",
                a,
                "Link has an empty href",
            ));
        } else if href == "#" || href.starts_with("javascript:") {
            issues.push(issue(
                "placeholder-link",
                "moderate",
                BEST_PRACTICE,
                a,
                &format!("Link href is a placeholder (\"{}\")", href),
            ));
        }
        if !is_hidden(a) && !has_accessible_name(document, a) {
            issues.push(issue(
                "link-name",
                "serious",
                "2.4.4",
                a,
                "Link has no accessible name (no text, aria-label, aria-labelledby, title, or image alt)",
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
                    BEST_PRACTICE,
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
            BEST_PRACTICE,
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
                BEST_PRACTICE,
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
                BEST_PRACTICE,
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

    // Elements given interactive widget roles must be keyboard reachable —
    // a div with role="button" but no tabindex can't be tabbed to
    if let Ok(sel) = Selector::parse(
        "[role='button'],[role='link'],[role='tab'],[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio'],[role='checkbox'],[role='switch'],[role='radio'],[role='option'],[role='slider'],[role='spinbutton'],[role='textbox'],[role='combobox'],[role='listbox'],[role='searchbox'],[role='treeitem']",
    ) {
        for el in document.select(&sel) {
            let tag = el.value().name();
            if matches!(tag, "a" | "button" | "input" | "select" | "textarea") {
                continue;
            }
            if el.value().attr("tabindex").is_none() {
                issues.push(issue(
                    "widget-no-tabindex",
                    "moderate",
                    "2.1.1",
                    &el,
                    &format!(
                        "<{} role=\"{}\"> has no tabindex — not reachable by keyboard",
                        tag,
                        el.value().attr("role").unwrap_or("")
                    ),
                ));
            }
        }
    }

    // role duplicating the element's implicit semantics is redundant
    each(document, "[role]", |el| {
        let Some(role) = el.value().attr("role") else {
            return;
        };
        let first = role.split_whitespace().next().unwrap_or("");
        let tag = el.value().name();
        let redundant = match (tag, first) {
            ("nav", "navigation")
            | ("main", "main")
            | ("header", "banner")
            | ("footer", "contentinfo")
            | ("aside", "complementary")
            | ("button", "button")
            | ("table", "table")
            | ("ul" | "ol", "list")
            | ("li", "listitem")
            | ("img", "img") => true,
            ("a", "link") => el.value().attr("href").is_some(),
            ("form", "form") => true,
            _ => false,
        };
        if redundant {
            issues.push(issue(
                "redundant-role",
                "minor",
                BEST_PRACTICE,
                el,
                &format!(
                    "role=\"{}\" duplicates the implicit semantics of <{}>",
                    first, tag
                ),
            ));
        }
    });
}

// ─── Media ───

fn check_media(document: &Html, issues: &mut Vec<A11yIssue>) {
    // Non-decorative SVGs need an accessible name (WCAG 1.1.1). Decorative
    // ones must be hidden with aria-hidden="true" or role="presentation"/"none".
    each(document, "svg", |svg| {
        let nested = svg
            .ancestors()
            .filter_map(ElementRef::wrap)
            .any(|a| a.value().name() == "svg");
        let role = svg
            .value()
            .attr("role")
            .and_then(|r| r.split_whitespace().next())
            .unwrap_or("")
            .to_ascii_lowercase();
        if nested || matches!(role.as_str(), "none" | "presentation") || is_hidden(svg) {
            return;
        }
        if !svg_has_name(document, svg) {
            issues.push(issue(
                "svg-no-name",
                "serious",
                "1.1.1",
                svg,
                "SVG has no accessible name (aria-label, aria-labelledby or <title>); hide it with aria-hidden=\"true\" if decorative",
            ));
        }
    });

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
            let has_td = table
                .select(&Selector::parse("td").unwrap())
                .next()
                .is_some();
            if has_td {
                issues.push(issue(
                    "table-no-headers",
                    "moderate",
                    "1.3.1",
                    table,
                    "<table> contains data cells but no <th> header cells",
                ));
            }
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
                    BEST_PRACTICE,
                    &th,
                    "<th> has no scope, headers, or id attribute",
                ));
            }
        }
    });
}

// ─── Forms ───

fn check_forms(document: &Html, issues: &mut Vec<A11yIssue>) {
    // fieldset should have a legend naming the group
    each(document, "fieldset", |fs| {
        let has_legend = fs
            .select(&Selector::parse("legend").unwrap())
            .next()
            .is_some();
        if !has_legend {
            issues.push(issue(
                "fieldset-no-legend",
                "moderate",
                "1.3.1",
                fs,
                "<fieldset> has no <legend> describing the group",
            ));
        }
    });

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
                    BEST_PRACTICE,
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

/// Cap on `content-outside-landmark` issues per page — one badly structured
/// template can otherwise produce hundreds.
const MAX_REGION_ISSUES: usize = 10;

fn attr_non_empty(el: &ElementRef, name: &str) -> bool {
    el.value()
        .attr(name)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Hidden from assistive technology via aria-hidden / hidden on the element
/// or an ancestor (static approximation — CSS isn't evaluated).
fn is_hidden(el: &ElementRef) -> bool {
    std::iter::once(*el)
        .chain(el.ancestors().filter_map(ElementRef::wrap))
        .any(|e| {
            e.value().attr("hidden").is_some()
                || e.value()
                    .attr("aria-hidden")
                    .map(|v| v.trim().eq_ignore_ascii_case("true"))
                    .unwrap_or(false)
        })
}

/// True when `aria-labelledby` references at least one existing element
/// with non-empty text.
fn labelledby_resolves(document: &Html, el: &ElementRef) -> bool {
    let Some(refs) = el.value().attr("aria-labelledby") else {
        return false;
    };
    refs.split_whitespace().any(|id| {
        Selector::parse(&format!("[id=\"{}\"]", id.replace('"', "\\\"")))
            .ok()
            .and_then(|sel| document.select(&sel).next())
            .map(|t| !t.text().collect::<String>().trim().is_empty())
            .unwrap_or(false)
    })
}

fn svg_has_name(document: &Html, svg: &ElementRef) -> bool {
    attr_non_empty(svg, "aria-label")
        || labelledby_resolves(document, svg)
        || attr_non_empty(svg, "title")
        || svg
            .children()
            .filter_map(ElementRef::wrap)
            .any(|c| c.value().name() == "title" && !c.text().collect::<String>().trim().is_empty())
}

/// Accessible name from content (text, img alt, named svg), skipping
/// aria-hidden subtrees.
fn content_has_name(document: &Html, el: &ElementRef) -> bool {
    for child in el.children() {
        if let Some(text) = child.value().as_text() {
            if !text.trim().is_empty() {
                return true;
            }
            continue;
        }
        let Some(c) = ElementRef::wrap(child) else {
            continue;
        };
        let hidden = c
            .value()
            .attr("aria-hidden")
            .map(|v| v.trim().eq_ignore_ascii_case("true"))
            .unwrap_or(false)
            || c.value().attr("hidden").is_some();
        if hidden {
            continue;
        }
        let named = match c.value().name() {
            "img" | "area" => attr_non_empty(&c, "alt") || attr_non_empty(&c, "aria-label"),
            "input" => attr_non_empty(&c, "alt") || attr_non_empty(&c, "value"),
            "svg" => svg_has_name(document, &c),
            "script" | "style" | "template" | "noscript" => false,
            _ => {
                attr_non_empty(&c, "aria-label")
                    || labelledby_resolves(document, &c)
                    || content_has_name(document, &c)
            }
        };
        if named {
            return true;
        }
    }
    false
}

fn has_accessible_name(document: &Html, el: &ElementRef) -> bool {
    attr_non_empty(el, "aria-label")
        || labelledby_resolves(document, el)
        || attr_non_empty(el, "title")
        || content_has_name(document, el)
}

const LANDMARK_ROLES: &[&str] = &[
    "banner",
    "complementary",
    "contentinfo",
    "form",
    "main",
    "navigation",
    "region",
    "search",
];

fn is_landmark(el: &ElementRef, in_sectioning: bool) -> bool {
    if let Some(role) = el.value().attr("role") {
        if let Some(first) = role.split_whitespace().next() {
            let first = first.to_ascii_lowercase();
            if LANDMARK_ROLES.contains(&first.as_str()) {
                return true;
            }
            // An explicit non-landmark role overrides the element's own.
            if is_valid_role(&first) {
                return false;
            }
        }
    }
    let named = attr_non_empty(el, "aria-label") || attr_non_empty(el, "aria-labelledby");
    match el.value().name() {
        "main" | "nav" | "aside" | "search" => true,
        // header/footer are only banner/contentinfo when scoped to the body
        "header" | "footer" => !in_sectioning,
        "section" | "form" => named,
        _ => false,
    }
}

fn is_perceivable_leaf(el: &ElementRef) -> bool {
    matches!(
        el.value().name(),
        "img"
            | "svg"
            | "input"
            | "select"
            | "textarea"
            | "button"
            | "video"
            | "audio"
            | "iframe"
            | "canvas"
            | "object"
            | "embed"
    )
}

/// Walk the body and collect the outermost elements whose content sits
/// outside every landmark. Skip links and hidden/non-rendered nodes are
/// ignored.
fn collect_content_outside_landmarks<'a>(
    el: &ElementRef<'a>,
    in_sectioning: bool,
    out: &mut Vec<ElementRef<'a>>,
) {
    for child in el.children() {
        if let Some(text) = child.value().as_text() {
            if !text.trim().is_empty() && el.value().name() != "body" {
                out.push(*el);
                return;
            }
            continue;
        }
        let Some(c) = ElementRef::wrap(child) else {
            continue;
        };
        let tag = c.value().name();
        if matches!(
            tag,
            "script" | "style" | "template" | "noscript" | "link" | "meta" | "dialog"
        ) || c.value().attr("hidden").is_some()
            || c.value()
                .attr("aria-hidden")
                .map(|v| v.trim().eq_ignore_ascii_case("true"))
                .unwrap_or(false)
            || (tag == "input" && c.value().attr("type") == Some("hidden"))
        {
            continue;
        }
        if is_landmark(&c, in_sectioning) {
            continue;
        }
        // Skip links legitimately precede the landmarks.
        if tag == "a"
            && c.value()
                .attr("href")
                .map(|h| h.starts_with('#') && h.len() > 1)
                .unwrap_or(false)
        {
            continue;
        }
        let has_text = !c.text().collect::<String>().trim().is_empty();
        let has_leaf = c
            .descendants()
            .filter_map(ElementRef::wrap)
            .any(|d| is_perceivable_leaf(&d))
            || is_perceivable_leaf(&c);
        if !has_text && !has_leaf {
            continue;
        }
        let contains_landmark = c
            .descendants()
            .skip(1)
            .filter_map(ElementRef::wrap)
            .any(|d| is_landmark(&d, true) || matches!(d.value().name(), "header" | "footer"));
        if contains_landmark {
            let sectioning = in_sectioning || matches!(tag, "article" | "section");
            collect_content_outside_landmarks(&c, sectioning, out);
        } else {
            out.push(c);
        }
    }
}

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
        let html = r##"<html lang="en"><head><title>t</title></head><body><img src="x.png"><a href="">empty</a><a href="#">hash</a><button></button><div tabindex="3"></div><input autofocus></body></html>"##;
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
        // standards metadata populated: WCAG rules carry an SC + "wcag",
        // heuristic rules carry no SC + "best-practice"
        assert!(issues.iter().all(|i| {
            if i.wcag.is_empty() {
                i.standards == vec!["best-practice".to_string()] && i.help_url.is_none()
            } else {
                i.standards == vec!["wcag".to_string()]
                    && i.help_url
                        .as_deref()
                        .map(|u| {
                            u.starts_with("https://www.w3.org/WAI/WCAG22/Understanding/")
                                && u.ends_with(".html")
                        })
                        .unwrap_or(false)
            }
        }));
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

        // bestpractice only -> only heuristic (non-WCAG) rules
        cfg.standards = vec!["bestpractice".into()];
        let issues = run_a11y_scan(html, &cfg);
        assert!(!issues.is_empty());
        assert!(issues.iter().all(|i| i.wcag.is_empty()));
        let t = types(&issues);
        assert!(t.contains(&"missing-main"));
        assert!(t.contains(&"no-headings"));
        assert!(!t.contains(&"meta-refresh"));

        // WCAG-only selections exclude best-practice rules
        cfg.standards = vec!["wcag21".into()];
        assert!(run_a11y_scan(html, &cfg).iter().all(|i| !i.wcag.is_empty()));
    }

    #[test]
    fn phase_e_batch3_rules() {
        let html = r##"<html lang="english!!"><head><title>t</title></head><body>
            <h2></h2>
            <div role="button">not keyboard reachable</div>
            <nav><a href="/a">A</a></nav><nav><a href="/b">B</a></nav>
            <div aria-live="shout">live</div>
            <span aria-label="ignored">x</span>
            <table><tr><td>1</td></tr></table>
            <fieldset><input type="checkbox"></fieldset>
            <nav role="navigation"><a href="/c">C</a></nav>
        </body></html>"##;
        let issues = run_a11y_scan(html, &config());
        let t = types(&issues);
        for expected in [
            "invalid-lang",
            "empty-heading",
            "widget-no-tabindex",
            "unnamed-duplicate-landmark",
            "aria-live-invalid",
            "aria-label-generic",
            "table-no-headers",
            "fieldset-no-legend",
            "redundant-role",
        ] {
            assert!(t.contains(&expected), "missing {} in {:?}", expected, t);
        }
    }

    #[test]
    fn presentation_focusable() {
        let html = r#"<html lang="en"><head><title>t</title></head><body><div role="none"><a href="/x">link</a></div></body></html>"#;
        assert!(types(&run_a11y_scan(html, &config())).contains(&"presentation-focusable"));
        // non-focusable presentation is fine
        let html2 = r#"<html lang="en"><head><title>t</title></head><body><div role="presentation"><span>decor</span></div></body></html>"#;
        assert!(!types(&run_a11y_scan(html2, &config())).contains(&"presentation-focusable"));
    }

    #[test]
    fn viewport_zoom_detection() {
        // A-13: comma-separated maximum-scale must be detected
        assert!(viewport_blocks_zoom("width=device-width,maximum-scale=1"));
        assert!(viewport_blocks_zoom(
            "width=device-width, initial-scale=1, maximum-scale=1.0"
        ));
        assert!(viewport_blocks_zoom("width=device-width; maximum-scale=1"));
        assert!(viewport_blocks_zoom("width=device-width, user-scalable=no"));
        assert!(viewport_blocks_zoom("width=device-width, user-scalable=0"));
        assert!(!viewport_blocks_zoom("width=device-width, initial-scale=1"));
        assert!(!viewport_blocks_zoom("width=device-width, maximum-scale=5"));
        assert!(!viewport_blocks_zoom(
            "width=device-width, user-scalable=yes"
        ));

        let html = r#"<html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width,maximum-scale=1"></head><body></body></html>"#;
        assert!(types(&run_a11y_scan(html, &config())).contains(&"viewport-zoom"));
    }

    #[test]
    fn aria_label_generic_only_on_generic_elements() {
        // A-47: elements whose roles support naming must not be flagged
        let html = r#"<html lang="en"><head><title>t</title></head><body>
            <section aria-label="s">x</section>
            <table aria-label="t"><tr aria-label="r"><td aria-label="c">1</td></tr></table>
            <ul aria-label="u"><li aria-label="l">x</li></ul>
            <ol aria-label="o"><li>x</li></ol>
        </body></html>"#;
        assert!(!types(&run_a11y_scan(html, &config())).contains(&"aria-label-generic"));

        let html2 = r#"<html lang="en"><head><title>t</title></head><body><div aria-label="d">x</div><p aria-label="p">y</p></body></html>"#;
        let issues = run_a11y_scan(html2, &config());
        assert_eq!(
            issues
                .iter()
                .filter(|i| i.issue_type == "aria-label-generic")
                .count(),
            2
        );
    }

    #[test]
    fn roles_aria12_dpub_and_fallback_lists() {
        // A-48
        let ok = r#"<html lang="en"><head><title>t</title></head><body>
            <div role="generic">a</div><div role="meter">b</div><div role="paragraph">c</div>
            <div role="time">d</div><section role="doc-chapter">e</section>
            <div role="doc-toc">f</div><div role="bogus region">g</div>
            <div role="  ">h</div><div role="Button" tabindex="0">i</div>
        </body></html>"#;
        assert!(!types(&run_a11y_scan(ok, &config())).contains(&"invalid-role"));

        let bad = r#"<html lang="en"><head><title>t</title></head><body><div role="bogus nonsense">x</div><div role="doc-nope">y</div></body></html>"#;
        let issues = run_a11y_scan(bad, &config());
        assert_eq!(
            issues
                .iter()
                .filter(|i| i.issue_type == "invalid-role")
                .count(),
            2
        );
    }

    #[test]
    fn empty_link_ignores_named_anchors() {
        // A-49
        let html = r#"<html lang="en"><head><title>t</title></head><body><a name="top"></a><a id="x">anchor</a></body></html>"#;
        assert!(!types(&run_a11y_scan(html, &config())).contains(&"empty-link"));

        for markup in [
            r#"<a href="">e</a>"#,
            r#"<a href="  ">e</a>"#,
            r#"<a role="link">e</a>"#,
            r#"<a onclick="go()">e</a>"#,
            r#"<a tabindex="0">e</a>"#,
        ] {
            let html = format!(
                r#"<html lang="en"><head><title>t</title></head><body>{}</body></html>"#,
                markup
            );
            assert!(
                types(&run_a11y_scan(&html, &config())).contains(&"empty-link"),
                "expected empty-link for {}",
                markup
            );
        }
    }

    #[test]
    fn best_practice_classification_and_help_urls() {
        // A-51
        let html = r##"<html lang="en"><head><title>t</title></head><body>
            <h2>no h1</h2>
            <a href="https://x.com" target="_blank">ext</a>
            <nav role="navigation"><a href="/a">A</a></nav>
            <img src="a.png">
        </body></html>"##;
        let issues = run_a11y_scan(html, &config());
        for bp in ["missing-h1", "target-blank-noopener", "redundant-role"] {
            let i = issues
                .iter()
                .find(|i| i.issue_type == bp)
                .unwrap_or_else(|| panic!("missing {}", bp));
            assert!(i.wcag.is_empty(), "{} should not carry a WCAG SC", bp);
            assert_eq!(i.standards, vec!["best-practice".to_string()]);
        }
        let alt = issues
            .iter()
            .find(|i| i.issue_type == "missing-alt")
            .unwrap();
        assert_eq!(alt.wcag, "1.1.1");
        assert_eq!(
            alt.help_url.as_deref(),
            Some("https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html")
        );
    }

    #[test]
    fn parsing_criterion_dropped_for_wcag22_only() {
        // A-51: 4.1.1 was removed in WCAG 2.2
        let html = r#"<html lang="en"><head><title>t</title></head><body><div id="a"></div><div id="a"></div></body></html>"#;
        let mut cfg = config();
        cfg.standards = vec!["wcag22".into()];
        assert!(!types(&run_a11y_scan(html, &cfg)).contains(&"duplicate-id"));
        cfg.standards = vec!["wcag21".into()];
        assert!(types(&run_a11y_scan(html, &cfg)).contains(&"duplicate-id"));
        cfg.standards = vec!["wcag22".into(), "section508".into()];
        assert!(types(&run_a11y_scan(html, &cfg)).contains(&"duplicate-id"));
    }

    fn count(issues: &[A11yIssue], t: &str) -> usize {
        issues.iter().filter(|i| i.issue_type == t).count()
    }

    #[test]
    fn svg_without_name_is_flagged() {
        let html = r##"<html lang="en"><head><title>t</title></head><body><main>
            <svg id="bad"><path d="M0 0"/></svg>
            <svg aria-hidden="true"><path/></svg>
            <svg role="presentation"><path/></svg>
            <svg aria-label="Cart"><path/></svg>
            <svg><title>Logo</title><g><svg><path/></svg></g></svg>
            <span id="lbl">Search</span><svg aria-labelledby="lbl"><path/></svg>
            <button aria-label="Close"><svg class="icon"><path/></svg></button>
        </main></body></html>"##;
        let issues = run_a11y_scan(html, &config());
        // #bad and the icon inside the button (decorative but not hidden)
        assert_eq!(count(&issues, "svg-no-name"), 2, "{:?}", types(&issues));
    }

    #[test]
    fn aria_idref_empty_missing_and_duplicate() {
        let html = r##"<html lang="en"><head><title>t</title></head><body><main>
            <div id="d">x</div><div id="d">y</div><p id="ok">ok</p>
            <button aria-describedby="">a</button>
            <button aria-describedby="nope">b</button>
            <button aria-labelledby="d">c</button>
            <input aria-activedescendant="gone" aria-label="i">
            <button aria-describedby="ok">fine</button>
        </main></body></html>"##;
        let issues = run_a11y_scan(html, &config());
        let msgs: Vec<&str> = issues
            .iter()
            .filter(|i| i.issue_type == "broken-aria-ref")
            .map(|i| i.message.as_str())
            .collect();
        assert_eq!(msgs.len(), 4, "{:?}", msgs);
        assert!(msgs.iter().any(|m| m.contains("is empty")));
        assert!(msgs.iter().any(|m| m.contains("not unique")));
        assert!(msgs.iter().any(|m| m.contains("aria-activedescendant")));
    }

    #[test]
    fn link_without_accessible_name() {
        let html = r##"<html lang="en"><head><title>t</title></head><body><main>
            <a href="/a" id="bad1"><svg><path/></svg></a>
            <a href="/b" id="bad2"><img src="x.png" alt=""></a>
            <a href="/c" id="bad3"><span aria-hidden="true">x</span></a>
            <a href="/d">Text</a>
            <a href="/e" aria-label="E"><svg><path/></svg></a>
            <a href="/f"><img src="f.png" alt="F"></a>
            <a href="/g"><svg><title>G</title></svg></a>
            <a href="/h" title="H"></a>
        </main></body></html>"##;
        let issues = run_a11y_scan(html, &config());
        let sels: Vec<&str> = issues
            .iter()
            .filter(|i| i.issue_type == "link-name")
            .map(|i| i.selector.as_str())
            .collect();
        assert_eq!(sels, vec!["a#bad1", "a#bad2", "a#bad3"]);
    }

    #[test]
    fn content_outside_landmarks() {
        let html = r##"<html lang="en"><head><title>t</title></head><body>
            <a href="#main">Skip to content</a>
            <div class="wrap">
                <header>Site</header>
                <div class="promo">Free shipping!</div>
                <main id="main"><section><header>Article head</header><p>p</p></section></main>
            </div>
            <footer>f</footer>
            <div class="cookie">Cookie banner</div>
            <div id="root"></div>
            <script>var x = 1;</script>
        </body></html>"##;
        let issues = run_a11y_scan(html, &config());
        let sels: Vec<&str> = issues
            .iter()
            .filter(|i| i.issue_type == "content-outside-landmark")
            .map(|i| i.selector.as_str())
            .collect();
        assert_eq!(sels, vec!["div.promo", "div.cookie"]);
    }
}
