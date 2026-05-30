"""Wave 219: generate downloadable PDFs for the 4 new reference documents.

Reads each doc's index.html, strips masthead/nav/footer/site scripts,
applies print-safe CSS (system fonts only, no Google Fonts to avoid CDN
delay/failure during render), and produces a single-file PDF next to the
source HTML.
"""
from pathlib import Path
from weasyprint import HTML, CSS
import re

ROOT = Path(__file__).resolve().parent.parent
DOCS = [
    ('about/documents/personnel-file', 'personnel-file.pdf', 'The Personnel File', 'Selected Grievances, Senior Cataloguer'),
    ('about/documents/amendment-1991-08', 'amendment-1991-08.pdf', 'Amendment 1991-08', 'Adoption of the Silhouette Test'),
    ('about/documents/methodology-memo-1999', 'methodology-memo-1999.pdf', 'The Methodology Memo', 'On the Catalogue\'s Continued Operation in the Digital Era'),
    ('about/documents/atlantic-giant-2009', 'atlantic-giant-2009.pdf', 'The Atlantic Giant Decision', 'On the Eligibility of Cultivated and Selectively Bred Subjects'),
]

PRINT_CSS = """
@page { size: Letter; margin: 0.9in 0.95in 1.1in 0.95in; }
@page { @bottom-center { content: "Thiccctionary  -  Reference Document  -  Page " counter(page) " of " counter(pages); font-family: 'Courier New', monospace; font-size: 9pt; color: #6b5c4d; letter-spacing: 0.06em; } }
* { box-sizing: border-box; }
body { font-family: 'Georgia', 'Times New Roman', serif; color: #2a221b; background: #fffaf0; font-size: 11.5pt; line-height: 1.6; margin: 0; }
header.masthead, nav, footer.site-footer, .article-meta, .skip-link, script, link[rel=stylesheet] { display: none !important; }
h1 { font-family: 'Georgia', serif; font-size: 26pt; margin: 0 0 0.2em; color: #2a221b; }
h2 { font-family: 'Georgia', serif; font-size: 15pt; margin: 1.5em 0 0.3em; color: #7a1f1f; }
h3 { font-family: 'Georgia', serif; font-size: 12pt; margin: 1.2em 0 0.2em; color: #2a221b; }
p { margin: 0.7em 0; }
em, .tagline { font-style: italic; }
.doc-meta, .article-meta { font-family: 'Courier New', monospace; font-size: 9pt; letter-spacing: 0.07em; color: #6b5c4d; text-transform: uppercase; margin: 1.2em 0 1.5em; padding: 0.4em 0; border-top: 1px solid #c9b89a; border-bottom: 1px solid #c9b89a; text-align: center; }
.doc-stamp { font-family: 'Courier New', monospace; font-size: 8.5pt; letter-spacing: 0.12em; color: #7a1f1f; text-transform: uppercase; border: 1px solid #7a1f1f; display: inline-block; padding: 2pt 6pt; margin: 0.6em 0; }
.doc-body blockquote, blockquote { border-left: 3px solid #7a1f1f; margin: 1em 0; padding: 0.4em 0 0.4em 1em; font-style: italic; color: #5a4d3f; background: #f7eedf; }
.ref, .doc-body .ref { font-family: 'Courier New', monospace; font-size: 8.5pt; color: #6b5c4d; letter-spacing: 0.05em; text-transform: uppercase; margin-top: 1.5em; padding-top: 0.8em; border-top: 1px dashed #c9b89a; }
strong { font-weight: bold; }
a { color: #2a221b; text-decoration: none; }
/* personnel-file specific */
.grievance { border-left: 3px solid #6b5c4d; padding: 0.4em 0 0.4em 1em; margin: 1.4em 0; page-break-inside: avoid; }
.response { background: #f0e8d8; padding: 0.6em 1em; margin: 0.6em 0 0; border-left: 3px solid #7a8d4a; font-size: 10.5pt; }
.status { font-family: 'Courier New', monospace; font-size: 8.5pt; letter-spacing: 0.07em; text-transform: uppercase; color: #6b5c4d; margin-top: 0.4em; }
"""

def strip_for_print(html: str) -> str:
    # Remove the Google Fonts <link>, the styles.min.css <link>, and the masthead/footer/scripts.
    # Inline our print CSS instead.
    out = html
    # Remove masthead block
    out = re.sub(r'<header class="masthead">[\s\S]*?</header>', '', out, count=1)
    out = re.sub(r'<footer class="site-footer">[\s\S]*?</footer>', '', out, count=1)
    out = re.sub(r'<script[\s\S]*?</script>', '', out)
    out = re.sub(r'<link[^>]+stylesheet[^>]*>', '', out)
    out = re.sub(r'<link[^>]+preconnect[^>]*>', '', out)
    # Remove the "← back" article-meta line
    out = re.sub(r'<p class="article-meta">[\s\S]*?</p>', '', out)
    # Inject our print CSS at end of head
    inject = '<style>' + PRINT_CSS + '</style>'
    out = out.replace('</head>', inject + '</head>', 1)
    return out

for rel, pdfname, title, subtitle in DOCS:
    src = ROOT / rel / 'index.html'
    dst = ROOT / rel / pdfname
    raw = src.read_text(encoding='utf-8')
    cleaned = strip_for_print(raw)
    HTML(string=cleaned, base_url=str(ROOT)).write_pdf(target=str(dst))
    size = dst.stat().st_size
    print(f"  {pdfname}  ({size:,} bytes)")
print("OK")
