use image::ImageFormat;
use std::path::Path;

/// Try to shrink/convert an image to WebP. Fallback = original bytes.
pub(super) fn compress_if_image(filename: &str, bytes: &[u8]) -> (Vec<u8>, String) {
    if !is_image(filename) {
        return (bytes.to_vec(), filename.to_string());
    }

    let Ok(img) = image::load_from_memory(bytes) else {
        return (bytes.to_vec(), filename.to_string());
    };

    const MAX_WIDTH: u32 = 1600;
    let resized = if img.width() > MAX_WIDTH {
        let ratio = MAX_WIDTH as f32 / img.width() as f32;
        let new_height = (img.height() as f32 * ratio) as u32;
        img.resize(MAX_WIDTH, new_height, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let mut out: Vec<u8> = Vec::new();
    let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut out);
    if resized.write_with_encoder(encoder).is_ok() {
        let new_name = Path::new(filename)
            .with_extension("webp")
            .to_string_lossy()
            .into_owned();
        return (out, new_name);
    }

    (bytes.to_vec(), filename.to_string())
}

fn is_image(filename: &str) -> bool {
    matches!(
        ImageFormat::from_path(filename),
        Ok(ImageFormat::Png
            | ImageFormat::Jpeg
            | ImageFormat::Gif
            | ImageFormat::Bmp
            | ImageFormat::WebP
            | ImageFormat::Tiff)
    )
}
