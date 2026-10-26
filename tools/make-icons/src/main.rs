//! Renders the "SA" monogram (`sa.svg`, Inter 800) into the icon assets and
//! writes `web/public/favicon.svg` with the text converted to paths.
//!
//! Usage: make-icons <sa.svg> <font.otf> <out-dir> <favicon-out>
//! Writes arkyo.ico, arkyo-1024.png, arkyo-macos-1024.png,
//! uninstall-macos-1024.png, installer-background.png, tray-template-44.rgba,
//! tray-color-64.rgba and an `arkyo.iconset/` folder (for `iconutil`).

use resvg::{tiny_skia, usvg};
use std::path::Path;

/// The monogram's drawing in its 100x100 space, taken from the favicon:
/// everything between the `<svg ...>` tag and `</svg>`.
fn monogram(svg: &str) -> &str {
    let start = svg.find('>').expect("svg tag") + 1;
    let end = svg.rfind("</svg>").expect("svg end");
    &svg[start..end]
}

/// usvg drops the `viewBox`; put it back on the root tag so the favicon scales.
fn with_view_box(svg: &str, tree: &usvg::Tree) -> String {
    if svg.contains("viewBox=") {
        return svg.to_string();
    }
    let vb = format!(r#"<svg viewBox="0 0 {} {}""#, tree.size().width(), tree.size().height());
    svg.replacen("<svg", &vb, 1)
}

thread_local! {
    static FONT: std::cell::RefCell<Option<std::path::PathBuf>> = const { std::cell::RefCell::new(None) };
}

/// usvg options whose font database holds only the bundled Inter font.
fn options() -> usvg::Options<'static> {
    let mut opt = usvg::Options::default();
    let path = FONT.with(|f| f.borrow().clone()).expect("font set");
    opt.fontdb_mut().load_font_file(&path).expect("load font");
    opt.font_family = "Inter".into();
    opt
}

/// Draws `svg` (a full document) at its own size.
fn render(svg: &str, w: u32, h: u32) -> tiny_skia::Pixmap {
    let tree = usvg::Tree::from_str(svg, &options()).expect("valid svg");
    let mut pm = tiny_skia::Pixmap::new(w, h).unwrap();
    let sx = w as f32 / tree.size().width();
    let sy = h as f32 / tree.size().height();
    resvg::render(&tree, tiny_skia::Transform::from_scale(sx, sy), &mut pm.as_mut());
    pm
}

/// The monogram alone, `size` px square (full-bleed rounded square).
fn plain(svg: &str, size: u32) -> tiny_skia::Pixmap {
    render(
        &format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{size}" height="{size}">{}</svg>"#,
            monogram(svg)
        ),
        size,
        size,
    )
}

/// macOS style: the artwork inset on the Big Sur grid (824px in 1024) with a
/// soft shadow, plus an optional badge (uninstaller).
fn macos(svg: &str, badge: bool) -> tiny_skia::Pixmap {
    let badge = if badge {
        r##"<circle cx="828" cy="828" r="120" fill="#fff"/>
  <circle cx="828" cy="828" r="102" fill="#E5383B"/>
  <rect x="768" y="812" width="120" height="32" rx="16" fill="#fff"/>"##
    } else {
        ""
    };
    render(
        &format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><filter id="s" x="-10%" y="-10%" width="120%" height="125%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="10"/><feOffset dy="10"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <g filter="url(#s)"><g transform="translate(100 100) scale(8.24)">{}</g></g>
  {badge}
</svg>"##,
            monogram(svg)
        ),
        1024,
        1024,
    )
}

fn installer_background(svg: &str) -> tiny_skia::Pixmap {
    render(
        &format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="620" height="418" viewBox="0 0 620 418">
  <rect width="620" height="418" fill="#f4f5f9"/>
  <g transform="translate(34 264) scale(1.22)">{}</g>
</svg>"##,
            monogram(svg)
        ),
        620,
        418,
    )
}

/// macOS template image: "SA" in solid black on transparent, no tile.
fn tray_template(svg: &str) -> tiny_skia::Pixmap {
    let glyph: String = monogram(svg)
        .lines()
        .filter(|l| !l.contains("<rect"))
        .collect::<Vec<_>>()
        .join("\n")
        .replace("#ffffff", "#000000")
        .replace("#8fa3ff", "#000000");
    render(
        &format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="12 12 76 76" width="44" height="44">{glyph}</svg>"#
        ),
        44,
        44,
    )
}

fn save_png(pm: &tiny_skia::Pixmap, path: &Path) {
    pm.save_png(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

/// Raw RGBA bytes, straight (non-premultiplied) alpha, row by row.
fn save_rgba(pm: &tiny_skia::Pixmap, path: &Path) {
    let mut out = Vec::with_capacity(pm.data().len());
    for p in pm.pixels() {
        let c = p.demultiply();
        out.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    std::fs::write(path, out).unwrap();
}

fn main() {
    let mut args = std::env::args().skip(1);
    let usage = "usage: make-icons <sa.svg> <font.otf> <out-dir> <favicon-out>";
    let src = args.next().expect(usage);
    let font = args.next().expect(usage);
    let out = args.next().expect(usage);
    let favicon = args.next().expect(usage);
    run(Path::new(&src), Path::new(&font), Path::new(&out), Path::new(&favicon));
}

fn run(src: &Path, font: &Path, out: &Path, favicon: &Path) {
    FONT.with(|f| *f.borrow_mut() = Some(font.to_path_buf()));
    let svg = std::fs::read_to_string(src).expect("read svg");
    let out = out.to_path_buf();
    // Favicon: the same drawing with text converted to paths.
    let tree = usvg::Tree::from_str(&svg, &options()).expect("valid svg");
    std::fs::write(favicon, with_view_box(&tree.to_string(&usvg::WriteOptions::default()), &tree)).unwrap();
    std::fs::create_dir_all(&out).unwrap();

    // Windows icon: PNG-in-ICO, 16 to 256.
    let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
    for size in [16u32, 24, 32, 48, 64, 128, 256] {
        let pm = plain(&svg, size);
        let mut rgba = Vec::new();
        for p in pm.pixels() {
            let c = p.demultiply();
            rgba.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
        }
        let img = ico::IconImage::from_rgba_data(size, size, rgba);
        dir.add_entry(ico::IconDirEntry::encode(&img).unwrap());
    }
    dir.write(std::fs::File::create(out.join("arkyo.ico")).unwrap()).unwrap();

    save_png(&plain(&svg, 1024), &out.join("arkyo-1024.png"));
    let mac = macos(&svg, false);
    save_png(&mac, &out.join("arkyo-macos-1024.png"));
    save_png(&macos(&svg, true), &out.join("uninstall-macos-1024.png"));
    save_png(&installer_background(&svg), &out.join("installer-background.png"));
    save_rgba(&tray_template(&svg), &out.join("tray-template-44.rgba"));
    save_rgba(&plain(&svg, 64), &out.join("tray-color-64.rgba"));

    // iconset for `iconutil -c icns` (macOS style artwork).
    let set = out.join("arkyo.iconset");
    std::fs::create_dir_all(&set).unwrap();
    for (name, size) in [
        ("icon_16x16", 16u32),
        ("icon_16x16@2x", 32),
        ("icon_32x32", 32),
        ("icon_32x32@2x", 64),
        ("icon_128x128", 128),
        ("icon_128x128@2x", 256),
        ("icon_256x256", 256),
        ("icon_256x256@2x", 512),
        ("icon_512x512", 512),
        ("icon_512x512@2x", 1024),
    ] {
        let svg_mac = macos_sized(&mac, size);
        save_png(&svg_mac, &set.join(format!("{name}.png")));
    }
}

/// The 1024 macOS artwork scaled down to `size`.
fn macos_sized(src: &tiny_skia::Pixmap, size: u32) -> tiny_skia::Pixmap {
    if size == 1024 {
        return src.clone();
    }
    let mut pm = tiny_skia::Pixmap::new(size, size).unwrap();
    let s = size as f32 / 1024.0;
    pm.draw_pixmap(
        0,
        0,
        src.as_ref(),
        &tiny_skia::PixmapPaint {
            quality: tiny_skia::FilterQuality::Bicubic,
            ..Default::default()
        },
        tiny_skia::Transform::from_scale(s, s),
        None,
    );
    pm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_all_outputs_with_expected_sizes() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let tmp = std::env::temp_dir().join(format!("make-icons-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let fav = tmp.join("favicon.svg");
        std::fs::create_dir_all(&tmp).unwrap();
        run(&root.join("sa.svg"), &root.join("fonts/Inter-ExtraBold.otf"), &tmp, &fav);

        let dims = |n: &str| {
            let d = image_dims(&std::fs::read(tmp.join(n)).unwrap());
            d
        };
        assert_eq!(dims("arkyo-1024.png"), (1024, 1024));
        assert_eq!(dims("arkyo-macos-1024.png"), (1024, 1024));
        assert_eq!(dims("uninstall-macos-1024.png"), (1024, 1024));
        assert_eq!(dims("installer-background.png"), (620, 418));

        let icon = ico::IconDir::read(std::fs::File::open(tmp.join("arkyo.ico")).unwrap()).unwrap();
        assert_eq!(icon.entries().len(), 7);

        let tray = std::fs::read(tmp.join("tray-template-44.rgba")).unwrap();
        assert_eq!(tray.len(), 44 * 44 * 4);
        let mut opaque = 0;
        for px in tray.chunks(4) {
            if px[3] != 0 {
                assert_eq!(&px[..3], &[0, 0, 0], "non-black tray pixel");
                opaque += 1;
            }
        }
        assert!(opaque > 100, "tray glyph is empty");
        assert_eq!(std::fs::read(tmp.join("tray-color-64.rgba")).unwrap().len(), 64 * 64 * 4);

        let svg = std::fs::read_to_string(&fav).unwrap();
        assert!(!svg.contains("<text"), "favicon still has text");
        assert!(svg.contains("<path"), "favicon has no paths");
        assert!(svg.contains(r#"viewBox="0 0 100 100""#), "favicon has no viewBox");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Width and height from a PNG header.
    fn image_dims(b: &[u8]) -> (u32, u32) {
        let r = |i: usize| u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
        (r(16), r(20))
    }
}
