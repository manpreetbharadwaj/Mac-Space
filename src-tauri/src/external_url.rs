//! Opens a web link in the user's default browser, but only for URLs we
//! trust. The WebView cannot follow external links itself (Tauri blocks
//! navigation away from the app), so every https link goes through here.

use url::Url;

/// Hosts the app may open. Deliberately tiny: the product website only.
const ALLOWED_HOSTS: &[&str] = &["mac-storage-manager.web.app"];

pub fn validate(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|e| format!("Not a valid URL: {e}"))?;
    if url.scheme() != "https" {
        return Err("Only https links can be opened.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Links containing credentials are not allowed.".to_string());
    }
    if url.port().is_some() {
        return Err("Links with a custom port are not allowed.".to_string());
    }
    let host = url.host_str().ok_or_else(|| "The link has no host.".to_string())?;
    if !ALLOWED_HOSTS.contains(&host) {
        return Err(format!("{host} is not an allowed destination."));
    }
    Ok(url)
}

pub fn open(raw: &str) -> Result<(), String> {
    let url = validate(raw).inspect_err(|e| log::warn!("Refused to open external link: {e}"))?;
    match std::process::Command::new("/usr/bin/open").arg(url.as_str()).status() {
        Ok(status) if status.success() => {
            log::info!("Opened {} in the default browser", url.as_str());
            Ok(())
        }
        Ok(status) => {
            log::error!("/usr/bin/open exited with {status} for {}", url.as_str());
            Err("macOS could not open the link in your default browser.".to_string())
        }
        Err(e) => {
            log::error!("Failed to launch /usr/bin/open for {}: {e}", url.as_str());
            Err(format!("Could not open your default browser: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_product_site() {
        assert!(validate("https://mac-storage-manager.web.app").is_ok());
        assert!(validate("https://mac-storage-manager.web.app/download#how-to-open").is_ok());
        assert!(validate("  https://mac-storage-manager.web.app/faq  ").is_ok());
    }

    #[test]
    fn rejects_unsafe_or_unlisted_urls() {
        for bad in [
            "http://mac-storage-manager.web.app/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "x-apple.systempreferences:com.apple.preference.security",
            "https://evil.example/phish",
            "https://mac-storage-manager.web.app.evil.example/",
            "https://mac-storage-manager.web.app@evil.example/",
            "https://user:pw@mac-storage-manager.web.app/",
            "https://mac-storage-manager.web.app:8443/",
            "-a Calculator",
            "",
            "not a url",
        ] {
            assert!(validate(bad).is_err(), "should have rejected {bad:?}");
        }
    }
}
